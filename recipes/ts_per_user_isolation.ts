/**
 * Recipe 12: Per-User Data Isolation
 *
 * Creates a dedicated Backboard assistant per user. Each user's data is
 * fully isolated. In-memory cache with debounced flush to Backboard.
 *
 * Distilled from Nash/LibreChat packages/api/src/backboard/userStore.ts
 */

import { BackboardClient, BackboardMemory } from "./ts_client";

// --- Config ---

const FLUSH_DELAY_MS = 3_000;
const MAX_CONTENT_CHARS = 50_000;

// --- Types ---

interface CachedEntry {
  bbId: string; // Backboard memory ID
  data: Record<string, unknown>;
}

interface UserCache {
  items: Map<string, CachedEntry>;
  loaded: boolean;
}

// --- State ---

const userAssistantIds = new Map<string, string>();
const userCaches = new Map<string, UserCache>();
const pendingFlushes = new Map<string, ReturnType<typeof setTimeout>>();

// --- Client ---

let client: BackboardClient | null = null;

function getClient(): BackboardClient {
  if (client) return client;
  const apiKey = process.env.BACKBOARD_API_KEY;
  if (!apiKey) throw new Error("BACKBOARD_API_KEY required");
  client = new BackboardClient(apiKey);
  return client;
}

// --- Per-user assistant management ---

/**
 * Get or create a dedicated assistant for a user.
 * Pattern: "myapp-user-{userId}" naming convention.
 */
async function getUserAssistantId(userId: string): Promise<string> {
  const cached = userAssistantIds.get(userId);
  if (cached) return cached;

  const bb = getClient();
  const name = `myapp-user-${userId}`;
  const assistants = await bb.listAssistants();
  const existing = assistants.find((a) => a.name === name);

  if (existing) {
    userAssistantIds.set(userId, existing.assistant_id);
    return existing.assistant_id;
  }

  const created = await bb.createAssistant(name, `Data store for user ${userId}`);
  userAssistantIds.set(userId, created.assistant_id);
  return created.assistant_id;
}

// --- Cache management ---

function emptyCache(): UserCache {
  return { items: new Map(), loaded: false };
}

/**
 * Load all memories for a user into the in-memory cache.
 * Only hits the API once per user (until invalidated).
 */
async function getUserCache(userId: string): Promise<UserCache> {
  const existing = userCaches.get(userId);
  if (existing?.loaded) return existing;

  const cache = emptyCache();
  const bb = getClient();
  const aid = await getUserAssistantId(userId);
  const response = await bb.getMemories(aid);

  for (const m of response.memories) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const entryId = (meta.entryId as string) ?? "";
    if (!entryId) continue;

    try {
      const data = JSON.parse(m.content) as Record<string, unknown>;
      cache.items.set(entryId, { bbId: m.id, data });
    } catch {
      // skip malformed entries
    }
  }

  cache.loaded = true;
  userCaches.set(userId, cache);
  return cache;
}

function invalidateUserCache(userId: string): void {
  userCaches.delete(userId);
}

// --- Debounced flush ---

/**
 * Truncate content to fit Backboard's memory size limit.
 */
function buildStorableContent(data: Record<string, unknown>): string {
  const raw = JSON.stringify(data);
  if (raw.length <= MAX_CONTENT_CHARS) return raw;
  return raw.slice(0, MAX_CONTENT_CHARS);
}

function cancelPendingFlush(key: string): void {
  const timer = pendingFlushes.get(key);
  if (timer) {
    clearTimeout(timer);
    pendingFlushes.delete(key);
  }
}

/**
 * Schedule a debounced write to Backboard.
 * If the same key is written again within FLUSH_DELAY_MS, the timer resets.
 */
function scheduleFlush(
  userId: string,
  entryId: string,
  type: string
): void {
  const flushKey = `${type}:${userId}:${entryId}`;
  cancelPendingFlush(flushKey);

  const timer = setTimeout(() => {
    pendingFlushes.delete(flushKey);
    flushEntry(userId, entryId, type).catch((err) => {
      console.warn(`Flush failed for ${flushKey}:`, err);
    });
  }, FLUSH_DELAY_MS);

  pendingFlushes.set(flushKey, timer);
}

/**
 * Write a cached entry to Backboard. Deletes the old memory first (if exists),
 * then creates a new one.
 */
async function flushEntry(
  userId: string,
  entryId: string,
  type: string
): Promise<void> {
  const cache = userCaches.get(userId);
  if (!cache) return;

  const entry = cache.items.get(entryId);
  if (!entry) return;

  const bb = getClient();
  const aid = await getUserAssistantId(userId);

  // Delete old memory (safe -- ignore 404)
  if (entry.bbId) {
    try {
      await bb.deleteMemory(aid, entry.bbId);
    } catch {
      // old memory already gone
    }
  }

  // Create new memory
  const content = buildStorableContent(entry.data);
  const result = await bb.addMemory(aid, content, {
    type,
    entryId,
    userId,
    updatedAt: new Date().toISOString(),
  });

  entry.bbId = (result.memory_id ?? result.id ?? "") as string;
}

// --- Public API ---

/**
 * Upsert an item into the user's data store.
 * Writes to cache immediately, flushes to Backboard after a delay.
 */
async function upsertItem(
  userId: string,
  entryId: string,
  type: string,
  data: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const cache = await getUserCache(userId);
  const existing = cache.items.get(entryId);
  const merged = existing ? { ...existing.data, ...data } : data;

  cache.items.set(entryId, { bbId: existing?.bbId ?? "", data: merged });
  scheduleFlush(userId, entryId, type);

  return merged;
}

/**
 * Get an item from the user's data store.
 */
async function getItem(
  userId: string,
  entryId: string
): Promise<Record<string, unknown> | null> {
  const cache = await getUserCache(userId);
  return cache.items.get(entryId)?.data ?? null;
}

/**
 * Delete an item from the user's data store.
 */
async function deleteItem(userId: string, entryId: string): Promise<boolean> {
  const cache = await getUserCache(userId);
  const entry = cache.items.get(entryId);
  if (!entry) return false;

  cancelPendingFlush(`item:${userId}:${entryId}`);
  cache.items.delete(entryId);

  if (entry.bbId) {
    const bb = getClient();
    const aid = await getUserAssistantId(userId);
    try {
      await bb.deleteMemory(aid, entry.bbId);
    } catch {
      // already gone
    }
  }
  return true;
}

/**
 * List all items of a type for a user.
 */
async function listItems(
  userId: string,
  type: string
): Promise<Record<string, unknown>[]> {
  const cache = await getUserCache(userId);
  const results: Record<string, unknown>[] = [];

  for (const entry of cache.items.values()) {
    if (entry.data._type === type) {
      results.push(entry.data);
    }
  }
  return results;
}

export {
  getUserAssistantId,
  getUserCache,
  invalidateUserCache,
  upsertItem,
  getItem,
  deleteItem,
  listItems,
};
