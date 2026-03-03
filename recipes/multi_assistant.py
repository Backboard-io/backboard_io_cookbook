"""Recipe 6: Multi-Assistant Architecture -- separate assistants for different concerns."""

import asyncio
import json
from _common import get_client, get_or_create_assistant


async def main():
    client = get_client()

    # --- Assistant 1: Chat (handles user conversations with tools) ---
    chat_assistant_id = await get_or_create_assistant(
        client,
        name="Cookbook Chat",
        system_prompt="You are a helpful assistant for a project management app.",
        tools=[{
            "type": "function",
            "function": {
                "name": "list_tasks",
                "description": "List all tasks for the current user",
                "parameters": {
                    "type": "object",
                    "properties": {},
                },
            },
        }],
    )
    print(f"Chat assistant: {chat_assistant_id}")

    # --- Assistant 2: Data Store (holds user/task data as memories) ---
    data_assistant_id = await get_or_create_assistant(
        client,
        name="Cookbook Data Store",
        system_prompt="Data storage assistant.",
    )
    print(f"Data assistant: {data_assistant_id}")

    # --- Assistant 3: Processor (specialized LLM tasks like summarization) ---
    processor_assistant_id = await get_or_create_assistant(
        client,
        name="Cookbook Processor",
        system_prompt=(
            "You are a text processing engine. When given text, produce a concise "
            "one-sentence summary. Return only the summary, nothing else."
        ),
    )
    print(f"Processor assistant: {processor_assistant_id}")

    # --- Store some data on the data assistant ---
    tasks = [
        {"title": "Design API schema", "status": "done", "user_id": "u1"},
        {"title": "Write unit tests", "status": "in_progress", "user_id": "u1"},
        {"title": "Deploy to staging", "status": "todo", "user_id": "u1"},
    ]
    for task in tasks:
        await client.add_memory(
            assistant_id=data_assistant_id,
            content=json.dumps(task),
            metadata={"type": "task", "user_id": task["user_id"]},
        )
    print(f"Stored {len(tasks)} tasks on data assistant")

    # --- Read data from the data assistant ---
    all_memories = await client.get_memories(data_assistant_id)
    user_tasks = [
        json.loads(m.content) for m in all_memories.memories
        if (m.metadata or {}).get("type") == "task"
        and (m.metadata or {}).get("user_id") == "u1"
    ]
    print(f"User u1 has {len(user_tasks)} task(s)")

    # --- Use the processor assistant for a one-off summarization ---
    thread = await client.create_thread(processor_assistant_id)
    task_text = "\n".join(f"- {t['title']} ({t['status']})" for t in user_tasks)
    response = await client.add_message(
        thread_id=thread.thread_id,
        content=f"Summarize these tasks:\n{task_text}",
        stream=False,
    )
    print(f"Summary: {response.content}")

    # --- Cleanup stored tasks ---
    for m in all_memories.memories:
        if (m.metadata or {}).get("type") == "task":
            await client.delete_memory(data_assistant_id, m.id)


if __name__ == "__main__":
    asyncio.run(main())
