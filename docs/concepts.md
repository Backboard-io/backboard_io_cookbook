<p align="right"><img src="../assets/logo.png" alt="Backboard" height="40"></p>

# Concepts

Short reference for every Backboard concept. Use this when you need a bit more than the [README table](../README.md#concepts-quick-reference) but not the full recipe.

---

## Assistant

An **assistant** is the AI agent your app talks to. It has a name, an optional system prompt, optional tools, and LLM configuration. All threads and memories are scoped to an assistant: you create a thread on an assistant, and memories created with `memory="Auto"` are stored on that assistant.

**API:** `create_assistant()`, `list_assistants()`. Never hardcode assistant IDs — use a **get-or-create by name** pattern so the same logical assistant is reused across restarts. In multi-user apps, use one assistant per user so memories don’t leak between users.

See [Recipe 1: Hello Backboard](01-hello-backboard.md), [Recipe 12: Per-User Isolation](12-ts-per-user-isolation.md), and [Pitfall 1](00-pitfalls.md#1-per-user-assistant-isolation-is-mandatory).

---

## Thread

A **thread** is a conversation session attached to a single assistant. You create a thread with `create_thread(assistant_id)`. All messages in that thread are part of one conversation; the LLM sees the thread’s message history when it replies. Threads are independent: thread A’s messages are not visible in thread B unless you use memory or documents shared at the assistant level.

**API:** `create_thread(assistant_id)`. Returns a `thread_id` that you use for `add_message()` and `submit_tool_outputs()`. In production, reuse the same thread for an ongoing conversation and create a new thread for a new session.

See [Recipe 1: Hello Backboard](01-hello-backboard.md) and [Recipe 8: Cross-Thread Memory](08-cross-thread-memory.md).

---

## Message

A **message** is a single turn in a thread: user content, assistant content, or a tool result. You send user content with `add_message(thread_id, content, ...)`. The API runs the LLM, optionally uses memory and documents, and returns the assistant’s response (or a `REQUIRES_ACTION` status with tool calls). Messages can be sent with `stream=True` for SSE chunking or `stream=False` for a single response. The `memory` parameter controls whether this turn reads/writes semantic memory (`"Auto"`, `"Readonly"`, or `"Off"`).

**API:** `add_message(thread_id, content, stream=..., memory=...)`. Response includes `content`, `status`, `run_id`, and optionally `memory_operation_id` and `tool_calls`. Use `run_id` when submitting tool outputs.

See [Recipe 1: Hello Backboard](01-hello-backboard.md), [Recipe 4: Streaming Chat](04-streaming-chat.md), and [Recipe 8: Cross-Thread Memory](08-cross-thread-memory.md).

---

## Memory

**Memory** is semantic, long-term storage attached to an assistant. It persists across threads: facts saved in one thread can be recalled in another. Backboard extracts and stores facts when you send a message with `memory="Auto"`; it also searches existing memories to add context for the LLM. You can also use memory as a schemaless store by calling `add_memory()` and `get_memories()` directly and filtering by `metadata.type`.

Memories live on the **assistant**, not the thread. A shared assistant means shared memories — so for user-specific data you must use a per-user assistant. Memory writes are **asynchronous**: after a message with `memory="Auto"`, poll `memory_operation_id` until the operation completes before relying on that memory in a new thread.

**API:** `add_memory()`, `get_memories()`, `delete_memory()`, and `get_memory_operation_status(operation_id)`. Always filter `get_memories()` by `metadata.type` when using memory as storage.

See [Recipe 2: Memory as Storage](02-memory-as-storage.md), [Recipe 8: Cross-Thread Memory](08-cross-thread-memory.md), [Recipe 10: Storage Abstraction](10-ts-storage-abstraction.md), and [Pitfalls 1–3](00-pitfalls.md).

---

## Document

A **document** is a file you upload to an assistant. Backboard chunks and indexes it for RAG: when you send a message on a thread under that assistant, the API can search the document content and inject relevant chunks into the LLM context. Good for handbooks, knowledge bases, and PDFs.

**API:** `upload_document_to_assistant(assistant_id, filename, file_content)`. Poll `get_document_status(document_id)` until status is `"indexed"` before relying on it in queries.

See [Recipe 5: Document RAG](05-document-rag.md).

---

## Tool

**Tools** are functions the assistant can call. You define them in OpenAI function-calling format and pass them to `create_assistant(tools=[...])`. When the LLM decides to call a tool, the message response has `status="REQUIRES_ACTION"` and `tool_calls`. Your app executes each call (e.g. call an API, run a query), then sends the results back with `submit_tool_outputs(thread_id, run_id, tool_outputs)`. You may need to loop: the LLM can return more tool calls or a final text response.

**API:** `submit_tool_outputs(thread_id, run_id, tool_outputs)`. Use the `run_id` from the message response that contained the tool calls.

See [Recipe 3: Tool Calling](03-tool-calling.md).

---

## Run

A **run** is one LLM execution triggered by a message. It’s identified by `run_id` in the message response. You need the run ID when submitting tool outputs: `submit_tool_outputs(thread_id, run_id, tool_outputs)`. One message can start one run; if the run requires action (tool calls), you submit outputs for that run and get a new message/run in response.

See [Recipe 3: Tool Calling](03-tool-calling.md).

<p align="center" style="padding-top: 2em; padding-bottom: 2em;"><img src="../assets/brand.png" alt="Backboard.io" width="300"></p>
