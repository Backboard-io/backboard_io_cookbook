---
name: backboard-app
description: Build applications with the Backboard.io API using proven patterns. Use when creating assistants, threads, messages, memories, documents, tools, streaming, or any Backboard integration in Python or TypeScript.
---

# Building with Backboard

Backboard is an API for AI apps. One API handles LLM routing, vector storage, document processing, and conversation state. SDK: `pip install backboard-sdk`. Auth: `BACKBOARD_API_KEY` env var.

## Core Concepts

| Concept | What | API |
|---------|------|-----|
| Assistant | AI agent with system prompt, tools, LLM config | `create_assistant()`, `list_assistants()` |
| Thread | Conversation session tied to an assistant | `create_thread(assistant_id)` |
| Message | User/assistant/tool message in a thread | `add_message(thread_id, content)` |
| Memory | Semantic facts stored on an assistant, searchable across threads | `add_memory()`, `get_memories()` |
| Document | Uploaded file, chunked and indexed for RAG | `upload_document_to_assistant()` |
| Tool | Function the assistant can call; you execute it and return results | `submit_tool_outputs()` |

## Python Patterns

### Client Init

```python
import os
from backboard import BackboardClient

client = BackboardClient(api_key=os.getenv("BACKBOARD_API_KEY"))
```

### Idempotent Assistant (get or create)

Always use this pattern. Never hardcode assistant IDs.

```python
async def get_or_create_assistant(client, name, system_prompt=None, tools=None):
    assistants = await client.list_assistants()
    for a in assistants:
        if a.name == name:
            return a.assistant_id
    kwargs = {"name": name}
    if system_prompt:
        kwargs["system_prompt"] = system_prompt
    if tools:
        kwargs["tools"] = tools
    assistant = await client.create_assistant(**kwargs)
    return assistant.assistant_id
```

### Send a Message

```python
thread = await client.create_thread(assistant_id)
response = await client.add_message(
    thread_id=thread.thread_id,
    content="Hello!",
    stream=False,
)
print(response.content)
```

### Streaming (SSE)

```python
async for chunk in await client.add_message(
    thread_id=thread.thread_id,
    content="Explain hash tables.",
    stream=True,
):
    if chunk.get("type") == "content_streaming":
        print(chunk.get("content", ""), end="", flush=True)
    elif chunk.get("type") == "run_ended":
        mem_op = chunk.get("memory_operation_id")
```

### Tool Calling Loop

Tools use OpenAI function-calling format. The critical pattern is the while loop:

```python
response = await client.add_message(thread_id=tid, content=msg, stream=False)

while response.status == "REQUIRES_ACTION" and response.tool_calls:
    tool_outputs = []
    for tc in response.tool_calls:
        args = tc.function.parsed_arguments
        result = handle_tool_call(tc.function.name, args)
        tool_outputs.append({"tool_call_id": tc.id, "output": result})

    response = await client.submit_tool_outputs(
        thread_id=tid,
        run_id=response.run_id,
        tool_outputs=tool_outputs,
    )
```

### Memory as Storage (CRUD)

Use memories as a schemaless document store. Tag with `metadata.type` from day one.

```python
import json

# Create
await client.add_memory(
    assistant_id=aid,
    content=json.dumps({"title": "Buy groceries", "done": False}),
    metadata={"type": "todo", "title": "Buy groceries"},
)

# Read (filter by type)
all_memories = await client.get_memories(aid)
todos = [m for m in all_memories.memories if (m.metadata or {}).get("type") == "todo"]

# Update (delete + recreate, memories are immutable)
await client.delete_memory(assistant_id=aid, memory_id=old_id)
await client.add_memory(assistant_id=aid, content=new_json, metadata=new_meta)

# Delete
await client.delete_memory(assistant_id=aid, memory_id=mem_id)
```

### Cross-Thread Memory

Use `memory="Auto"` so the assistant remembers facts across threads.

```python
response = await client.add_message(
    thread_id=tid, content="My name is Alex.", memory="Auto", stream=False
)
if response.memory_operation_id:
    await wait_for_memory(client, response.memory_operation_id)
```

### Document RAG

```python
doc = await client.upload_document_to_assistant(
    assistant_id=aid, filename="handbook.md", file_content=content_bytes
)
# Poll until indexed
while True:
    status = await client.get_document_status(doc.document_id)
    if status.status == "indexed":
        break
    if status.status == "error":
        raise RuntimeError(status.status_message)
    await asyncio.sleep(2)
# Now queries on this assistant automatically search the document
```

## TypeScript Patterns

### Client Init

```typescript
const client = new BackboardClient(
  process.env.BACKBOARD_API_KEY!,
  process.env.BACKBOARD_BASE_URL ?? "https://app.backboard.io/api"
);
```

Auth header: `X-API-Key`. Use `AbortController` for timeouts.

### Storage Abstraction

```typescript
async function listByType(type: string, userId?: string): Promise<StoredItem[]> {
  const response = await client.getMemories(assistantId);
  return response.memories
    .filter((m) => {
      const meta = (m.metadata ?? {}) as Record<string, unknown>;
      if (meta.type !== type) return false;
      if (userId && meta.userId !== userId) return false;
      return true;
    })
    .map((m) => ({ id: m.id, content: m.content, metadata: m.metadata ?? {} }));
}
```

### SSE Streaming

```typescript
async function* streamMessage(threadId: string, content: string) {
  const res = await fetch(url, { method: "POST", headers, body: formData });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim().startsWith("data: ")) continue;
      yield JSON.parse(line.trim().slice(6));
    }
  }
}
```

## Critical Rules

### 1. Per-user assistant isolation is mandatory

Memories are stored on the assistant, not the thread. A shared assistant with `memory="Auto"` leaks every user's facts to every other user.

```python
# WRONG
assistant_id = "asst_shared_for_everyone"

# RIGHT
async def get_user_assistant(client, user_id: str) -> str:
    name = f"myapp-user-{user_id}"
    assistants = await client.list_assistants()
    for a in assistants:
        if a.name == name:
            return a.assistant_id
    assistant = await client.create_assistant(name=name, system_prompt="...")
    return assistant.assistant_id
```

**Rule:** shared assistant = shared data only. User data = per-user assistant, no exceptions.

### 2. `memory="Auto"` is async -- poll before relying on it

After the LLM responds, memory saves happen in the background. Poll `memory_operation_id` before using the memory in a new thread.

```python
async def wait_for_memory(client, operation_id, timeout=30.0):
    import time
    start = time.time()
    while time.time() - start < timeout:
        status = await client.get_memory_operation_status(operation_id)
        if status.status == "COMPLETED":
            return status
        if status.status == "FAILED":
            raise RuntimeError(f"Memory operation {operation_id} failed")
        await asyncio.sleep(1)
    raise TimeoutError(f"Timed out after {timeout}s")
```

### 3. Filter memories by `metadata.type`

`get_memories()` returns everything on the assistant. Always filter:

```python
todos = [m for m in all_memories.memories if (m.metadata or {}).get("type") == "todo"]
```

Establish a type convention on day one: `myapp_convo`, `myapp_msg`, `myapp_setting`.

### 4. Shared vs. per-user assistants

| Assistant type | `memory="Auto"` safe? | Use for |
|---------------|----------------------|---------|
| Per-user (`myapp-user-{id}`) | Yes | Chat, preferences, personal context |
| Shared app (`myapp`) | No | App config, model cache, shared knowledge |
| Shared folder (`myapp-folder-{id}`) | Only if all users should share context |

### 5. Multi-assistant separation of concerns

Split by responsibility, not by feature:

```python
storage_id = await get_or_create_assistant(client, "myapp-storage", "Data storage")
chat_id = await get_or_create_assistant(client, "myapp-chat", "User chat", tools=TOOLS)
```

Storage assistants hold memories. Chat assistants handle conversation and tool calls.
