/**
 * Recipe 10: Storage Abstraction
 *
 * Use memories as a schemaless document store. One assistant = one database.
 * Filter by metadata.type to separate entity types.
 *
 * Distilled from Nash/LibreChat packages/api/src/backboard/storage.ts
 */

import { BackboardClient, BackboardMemory } from "./ts_client";

// --- Storage layer ---

let client: BackboardClient | null = null;
let assistantId: string | null = null;

function getClient(): BackboardClient {
  if (client) return client;

  const apiKey = process.env.BACKBOARD_API_KEY;
  if (!apiKey) throw new Error("BACKBOARD_API_KEY is required");

  const baseUrl = process.env.BACKBOARD_BASE_URL ?? "https://app.backboard.io/api";
  client = new BackboardClient(apiKey, baseUrl);
  return client;
}

/**
 * Find or create the app's storage assistant. Cached after first call.
 */
async function getAssistantId(): Promise<string> {
  if (assistantId) return assistantId;

  const bb = getClient();
  const assistants = await bb.listAssistants();
  const existing = assistants.find((a) => a.name === "MyApp");

  if (existing) {
    assistantId = existing.assistant_id;
    return assistantId;
  }

  const created = await bb.createAssistant("MyApp", "Application data store");
  assistantId = created.assistant_id;
  return assistantId;
}

// --- StoredItem interface ---

interface StoredItem {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

// --- CRUD operations ---

/**
 * List all items of a given type, optionally filtered by userId.
 */
async function listByType(type: string, userId?: string): Promise<StoredItem[]> {
  const bb = getClient();
  const aid = await getAssistantId();
  const response = await bb.getMemories(aid);

  return response.memories
    .filter((m) => {
      const meta = (m.metadata ?? {}) as Record<string, unknown>;
      if (meta.type !== type) return false;
      if (userId && meta.userId !== userId) return false;
      return true;
    })
    .map((m) => ({
      id: m.id,
      content: m.content,
      metadata: (m.metadata ?? {}) as Record<string, unknown>,
      created_at: m.created_at ?? undefined,
      updated_at: m.updated_at ?? undefined,
    }));
}

/**
 * Create a new item with typed metadata.
 */
async function createItem(
  content: string,
  metadata: Record<string, unknown>
): Promise<StoredItem> {
  const bb = getClient();
  const aid = await getAssistantId();
  const result = await bb.addMemory(aid, content, metadata);
  const memoryId = (result.memory_id ?? result.id ?? "") as string;

  return {
    id: memoryId,
    content,
    metadata,
    created_at: new Date().toISOString(),
  };
}

/**
 * Delete an item by memory ID.
 */
async function deleteItem(memoryId: string): Promise<boolean> {
  const bb = getClient();
  const aid = await getAssistantId();
  try {
    await bb.deleteMemory(aid, memoryId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find a single item by metadata key/value within a type.
 */
async function findByMetadata(
  type: string,
  key: string,
  value: string,
  userId?: string
): Promise<StoredItem | undefined> {
  const items = await listByType(type, userId);
  return items.find((item) => item.metadata[key] === value);
}

// --- Export as a singleton ---

export const backboardStorage = {
  getClient,
  getAssistantId,
  listByType,
  createItem,
  deleteItem,
  findByMetadata,
};

// --- Usage example ---

async function example() {
  // Store a user
  await backboardStorage.createItem(
    JSON.stringify({ email: "alex@acme.com", role: "admin" }),
    { type: "user", userId: "u1" }
  );

  // List all users
  const users = await backboardStorage.listByType("user");
  console.log(`Found ${users.length} user(s)`);

  // Find by email
  const alex = await backboardStorage.findByMetadata("user", "userId", "u1");
  if (alex) {
    const data = JSON.parse(alex.content);
    console.log(`Found: ${data.email}`);
  }

  // Store a different entity type on the same assistant
  await backboardStorage.createItem(
    JSON.stringify({ name: "Project Atlas", status: "active" }),
    { type: "project", ownerId: "u1" }
  );

  // List only projects
  const projects = await backboardStorage.listByType("project");
  console.log(`Found ${projects.length} project(s)`);
}
