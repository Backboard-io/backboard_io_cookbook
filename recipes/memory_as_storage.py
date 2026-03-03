"""Recipe 2: Memory as App Storage -- use memories as a structured data store."""

import asyncio
import json
from _common import get_client, get_or_create_assistant


async def main():
    client = get_client()

    assistant_id = await get_or_create_assistant(
        client,
        name="Cookbook Storage",
        system_prompt="Storage assistant for cookbook examples.",
    )

    # --- CREATE ---
    # Store a todo item as a memory. Content is JSON, metadata has the type tag.
    todo = {"title": "Buy groceries", "done": False, "priority": "high"}
    result = await client.add_memory(
        assistant_id=assistant_id,
        content=json.dumps(todo),
        metadata={"type": "todo", "title": todo["title"]},
    )
    todo_id = result.id
    print(f"Created todo: {todo_id}")

    # --- READ ---
    # List all memories and filter by metadata.type
    all_memories = await client.get_memories(assistant_id)
    todos = [
        m for m in all_memories.memories
        if (m.metadata or {}).get("type") == "todo"
    ]
    print(f"Found {len(todos)} todo(s)")
    for t in todos:
        data = json.loads(t.content)
        print(f"  [{t.id}] {data['title']} (done={data['done']})")

    # --- UPDATE ---
    # Backboard memories are immutable -- update by deleting and re-creating.
    updated_todo = {"title": "Buy groceries", "done": True, "priority": "high"}
    await client.delete_memory(assistant_id=assistant_id, memory_id=todo_id)
    new_result = await client.add_memory(
        assistant_id=assistant_id,
        content=json.dumps(updated_todo),
        metadata={"type": "todo", "title": updated_todo["title"]},
    )
    print(f"Updated todo: {new_result.id} (done=True)")

    # --- DELETE ---
    await client.delete_memory(assistant_id=assistant_id, memory_id=new_result.id)
    print("Deleted todo")

    # --- FIND BY METADATA ---
    # To find a specific item, filter the memories list by metadata fields.
    await client.add_memory(
        assistant_id=assistant_id,
        content=json.dumps({"title": "Write tests", "done": False}),
        metadata={"type": "todo", "title": "Write tests", "user_id": "user_42"},
    )

    all_memories = await client.get_memories(assistant_id)
    user_todos = [
        m for m in all_memories.memories
        if (m.metadata or {}).get("type") == "todo"
        and (m.metadata or {}).get("user_id") == "user_42"
    ]
    print(f"User 42 has {len(user_todos)} todo(s)")

    # Cleanup
    for t in user_todos:
        await client.delete_memory(assistant_id=assistant_id, memory_id=t.id)


if __name__ == "__main__":
    asyncio.run(main())
