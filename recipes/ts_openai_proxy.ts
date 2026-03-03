/**
 * Recipe 11: OpenAI-Compatible Proxy
 *
 * Translates OpenAI POST /chat/completions into Backboard thread + message calls.
 * Handles streaming SSE translation and model routing.
 *
 * Distilled from Nash/LibreChat packages/api/src/backboard/proxy.ts
 */

import { v4 as uuidv4 } from "uuid";
import { BackboardClient, BackboardStreamEvent } from "./ts_client";

// --- OpenAI types ---

interface OpenAIChatMessage {
  role: "system" | "user" | "assistant";
  content: string | null;
}

interface ChatCompletionRequest {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
}

interface ChatCompletionChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
}

interface ChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// --- Helpers ---

/**
 * Parse "anthropic/claude-sonnet-4-20250514" into { provider: "anthropic", modelName: "claude-sonnet-4-20250514" }.
 */
function parseModelSpec(model: string): { provider?: string; modelName: string } {
  if (model.includes("/")) {
    const [provider, ...rest] = model.split("/");
    return { provider, modelName: rest.join("/") };
  }
  return { modelName: model };
}

/**
 * Flatten an OpenAI messages array into a single prompt string for Backboard.
 *
 * System messages become [System Instructions].
 * Prior messages become [Conversation History].
 * The last message becomes [Current Message].
 */
function buildPromptFromMessages(messages: OpenAIChatMessage[]): string {
  if (messages.length === 0) return "";
  if (messages.length === 1) return messages[0].content ?? "";

  const systemMessages = messages.filter((m) => m.role === "system");
  const conversationMessages = messages.filter((m) => m.role !== "system");
  const parts: string[] = [];

  if (systemMessages.length > 0) {
    const systemContent = systemMessages
      .map((m) => m.content)
      .filter(Boolean)
      .join("\n");
    parts.push(`[System Instructions]\n${systemContent}`);
  }

  if (conversationMessages.length > 1) {
    const history = conversationMessages.slice(0, -1);
    const historyLines = history
      .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content ?? ""}`)
      .join("\n");
    parts.push(`[Conversation History]\n${historyLines}`);
  }

  const lastMessage = conversationMessages[conversationMessages.length - 1];
  if (lastMessage) {
    parts.push(`[Current Message]\n${lastMessage.content ?? ""}`);
  }

  return parts.join("\n\n");
}

// --- Request handler ---

/**
 * Handle an OpenAI-format chat completion request using Backboard.
 *
 * This is the core of the proxy: it creates a thread, sends the prompt,
 * and either streams SSE chunks or returns a complete response.
 */
async function handleChatCompletions(
  client: BackboardClient,
  assistantId: string,
  body: ChatCompletionRequest
): Promise<ChatCompletionResponse | AsyncGenerator<string>> {
  const { messages, model, stream } = body;
  const { provider, modelName } = parseModelSpec(model ?? "gpt-4o");

  // Create a fresh thread for this request
  const thread = await client.createThread(assistantId);
  const prompt = buildPromptFromMessages(messages);

  if (stream) {
    return streamResponse(client, thread.thread_id, prompt, modelName, provider);
  }

  return nonStreamResponse(client, thread.thread_id, prompt, model, modelName, provider);
}

/**
 * Stream: translate Backboard SSE events into OpenAI-format SSE chunks.
 */
async function* streamResponse(
  client: BackboardClient,
  threadId: string,
  prompt: string,
  modelName: string,
  provider?: string
): AsyncGenerator<string> {
  const completionId = `chatcmpl-bb-${uuidv4().slice(0, 12)}`;
  const created = Math.floor(Date.now() / 1000);

  // Send the role chunk first (OpenAI convention)
  const roleChunk: ChatCompletionChunk = {
    id: completionId,
    object: "chat.completion.chunk",
    created,
    model: modelName,
    choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
  };
  yield `data: ${JSON.stringify(roleChunk)}\n\n`;

  // Stream content chunks
  for await (const event of client.streamMessage(threadId, prompt, {
    llmProvider: provider,
    modelName,
    memory: "Auto",
  })) {
    if (event.type === "content_streaming" && event.content) {
      const chunk: ChatCompletionChunk = {
        id: completionId,
        object: "chat.completion.chunk",
        created,
        model: modelName,
        choices: [{ index: 0, delta: { content: event.content }, finish_reason: null }],
      };
      yield `data: ${JSON.stringify(chunk)}\n\n`;
    }
  }

  // Send the stop chunk
  const stopChunk: ChatCompletionChunk = {
    id: completionId,
    object: "chat.completion.chunk",
    created,
    model: modelName,
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
  };
  yield `data: ${JSON.stringify(stopChunk)}\n\n`;
  yield "data: [DONE]\n\n";
}

/**
 * Non-stream: collect all content, return a single ChatCompletionResponse.
 */
async function nonStreamResponse(
  client: BackboardClient,
  threadId: string,
  prompt: string,
  model: string,
  modelName: string,
  provider?: string
): Promise<ChatCompletionResponse> {
  const contentParts: string[] = [];

  for await (const event of client.streamMessage(threadId, prompt, {
    llmProvider: provider,
    modelName,
    memory: "Auto",
  })) {
    if (event.type === "content_streaming" && event.content) {
      contentParts.push(event.content);
    }
  }

  return {
    id: `chatcmpl-bb-${uuidv4().slice(0, 12)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model ?? modelName,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: contentParts.join("") },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

// --- Model listing ---

let cachedModels: Array<{ id: string; object: string; owned_by: string }> | null = null;
let cacheExpiry = 0;

/**
 * Fetch available models from Backboard and format as OpenAI model list.
 * Cached for 1 hour.
 */
async function fetchModels(
  apiKey: string,
  baseUrl = "https://app.backboard.io/api"
): Promise<Array<{ id: string; object: string; owned_by: string }>> {
  if (cachedModels && Date.now() < cacheExpiry) return cachedModels;

  const headers = { "X-API-Key": apiKey };

  // Get providers
  const providersRes = await fetch(`${baseUrl}/models/providers`, { headers });
  const { providers = [] } = (await providersRes.json()) as { providers: string[] };

  // Get models per provider, format as "provider/model_name"
  const models: Array<{ id: string; object: string; owned_by: string }> = [];
  for (const provider of providers) {
    const res = await fetch(`${baseUrl}/models?provider=${encodeURIComponent(provider)}`, {
      headers,
    });
    const data = (await res.json()) as {
      models: Array<{ name: string; model_type: string; provider: string }>;
    };

    for (const m of data.models ?? []) {
      if (m.model_type !== "llm") continue;
      models.push({
        id: `${m.provider}/${m.name}`,
        object: "model",
        owned_by: m.provider,
      });
    }
  }

  cachedModels = models;
  cacheExpiry = Date.now() + 3_600_000; // 1 hour
  return models;
}

export {
  handleChatCompletions,
  fetchModels,
  buildPromptFromMessages,
  parseModelSpec,
};
