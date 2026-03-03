/**
 * Shared helpers for Backboard cookbook TypeScript recipes.
 *
 * Use getClient(), getOrCreateAssistant(), and waitForMemory() so recipes
 * stay consistent with the patterns in docs/00-pitfalls.md.
 */

import {
  BackboardClient,
  BackboardMemoryOperationStatus,
} from "./ts_client";

const DEFAULT_BASE_URL = "https://app.backboard.io/api";

/**
 * Create a BackboardClient from BACKBOARD_API_KEY and optional BACKBOARD_BASE_URL.
 */
export function getClient(): BackboardClient {
  const apiKey = process.env.BACKBOARD_API_KEY;
  if (!apiKey) {
    throw new Error("Set BACKBOARD_API_KEY environment variable");
  }
  const baseUrl = process.env.BACKBOARD_BASE_URL ?? DEFAULT_BASE_URL;
  return new BackboardClient(apiKey, baseUrl);
}

/**
 * Find an existing assistant by name, or create one. Returns assistant_id.
 * Idempotent — safe to call on every request.
 */
export async function getOrCreateAssistant(
  client: BackboardClient,
  name: string,
  options?: { systemPrompt?: string; description?: string }
): Promise<string> {
  const assistants = await client.listAssistants();
  const existing = assistants.find((a) => a.name === name);
  if (existing) {
    return existing.assistant_id;
  }

  const description = options?.description ?? "";
  const systemPrompt = options?.systemPrompt;
  const created = await client.createAssistant(name, description, systemPrompt);
  return created.assistant_id;
}

/**
 * Poll until a memory operation completes. Throws on failure or timeout.
 *
 * Use after addMessage(..., { memory: "Auto" }) when you need the memory
 * to be available before the next request (e.g. a follow-up in a new thread).
 */
export async function waitForMemory(
  client: BackboardClient,
  operationId: string,
  options?: { timeoutMs?: number; pollIntervalMs?: number }
): Promise<BackboardMemoryOperationStatus> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const pollIntervalMs = options?.pollIntervalMs ?? 1_000;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const status = await client.getMemoryOperationStatus(operationId);
    if (status.status === "COMPLETED") {
      return status;
    }
    if (status.status === "FAILED") {
      throw new Error(`Memory operation ${operationId} failed`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Memory operation ${operationId} timed out after ${timeoutMs}ms`
  );
}
