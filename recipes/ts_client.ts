/**
 * Recipe 9: Custom HTTP Client
 *
 * A typed Backboard client built from scratch with fetch.
 * Shows: auth headers, timeout/abort, generic request<T>, SSE streaming.
 *
 * Distilled from Nash/LibreChat packages/api/src/backboard/client.ts
 */

// --- Types ---

export interface BackboardAssistant {
  assistant_id: string;
  name: string;
  description?: string;
  created_at: string;
}

export interface BackboardThread {
  thread_id: string;
  created_at: string;
  messages: BackboardMessage[];
}

export interface BackboardMessage {
  message_id: string;
  role: "user" | "assistant" | "system";
  content?: string;
  created_at: string;
  status?: string;
}

export interface BackboardMemory {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface BackboardStreamEvent {
  type: string;
  content?: string;
  error?: string;
  message?: string;
  run_id?: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: { name: string; arguments: string };
  }>;
  model_provider?: string;
  model_name?: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  memory_operation_id?: string;
}

// --- Client ---

const DEFAULT_BASE_URL = "https://app.backboard.io/api";
const DEFAULT_TIMEOUT_MS = 60_000;

export class BackboardClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(
    apiKey: string,
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.timeoutMs = timeoutMs;
  }

  private headers(): Record<string, string> {
    return {
      "X-API-Key": this.apiKey,
      "User-Agent": "my-app/1.0",
    };
  }

  /**
   * Generic request method -- handles JSON and form data, timeout via AbortController.
   */
  private async request<T>(
    method: string,
    endpoint: string,
    options?: {
      json?: Record<string, unknown>;
      formData?: Record<string, string>;
      params?: Record<string, string | number>;
    }
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/${endpoint.replace(/^\//, "")}`);
    if (options?.params) {
      for (const [key, val] of Object.entries(options.params)) {
        url.searchParams.set(key, String(val));
      }
    }

    const headers: Record<string, string> = { ...this.headers() };
    let body: string | FormData | undefined;

    if (options?.json) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    } else if (options?.formData) {
      const fd = new FormData();
      for (const [key, val] of Object.entries(options.formData)) {
        fd.append(key, val);
      }
      body = fd as unknown as string;
    }

    // Abort after timeout
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method,
        headers: options?.formData ? this.headers() : headers,
        body,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "<no body>");
        throw new Error(`Backboard API ${res.status}: ${text}`);
      }

      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Stream a message response via SSE.
   * Returns an AsyncGenerator that yields parsed events.
   */
  async *streamMessage(
    threadId: string,
    content: string,
    options?: {
      llmProvider?: string;
      modelName?: string;
      memory?: string;
    }
  ): AsyncGenerator<BackboardStreamEvent> {
    const url = new URL(`${this.baseUrl}/threads/${threadId}/messages`);

    const formData = new FormData();
    formData.append("content", content);
    formData.append("stream", "true");
    if (options?.llmProvider) formData.append("llm_provider", options.llmProvider);
    if (options?.modelName) formData.append("model_name", options.modelName);
    if (options?.memory) formData.append("memory", options.memory);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs * 3);

    try {
      const res = await fetch(url.toString(), {
        method: "POST",
        headers: this.headers(),
        body: formData,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "<no body>");
        throw new Error(`Backboard streaming ${res.status}: ${text}`);
      }

      if (!res.body) throw new Error("No response body for streaming");

      // Read the SSE stream line by line
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data: ")) continue;

          try {
            const payload = JSON.parse(trimmed.slice(6)) as BackboardStreamEvent;
            if (payload.type === "error" || payload.type === "run_failed") {
              throw new Error(payload.error ?? payload.message ?? "Streaming error");
            }
            yield payload;
          } catch (e) {
            if (e instanceof SyntaxError) continue; // skip malformed lines
            throw e;
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // --- Convenience methods ---

  async createAssistant(name: string, description?: string): Promise<BackboardAssistant> {
    const data: Record<string, unknown> = { name };
    if (description) data.description = description;
    return this.request<BackboardAssistant>("POST", "/assistants", { json: data });
  }

  async listAssistants(skip = 0, limit = 100): Promise<BackboardAssistant[]> {
    return this.request<BackboardAssistant[]>("GET", "/assistants", {
      params: { skip, limit },
    });
  }

  async createThread(assistantId: string): Promise<BackboardThread> {
    return this.request<BackboardThread>("POST", `/assistants/${assistantId}/threads`, {
      json: {},
    });
  }

  async addMemory(
    assistantId: string,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = { content };
    if (metadata) data.metadata = metadata;
    return this.request("POST", `/assistants/${assistantId}/memories`, { json: data });
  }

  async getMemories(
    assistantId: string
  ): Promise<{ memories: BackboardMemory[]; total_count: number }> {
    return this.request("GET", `/assistants/${assistantId}/memories`);
  }

  async deleteMemory(assistantId: string, memoryId: string): Promise<void> {
    await this.request("DELETE", `/assistants/${assistantId}/memories/${memoryId}`);
  }
}
