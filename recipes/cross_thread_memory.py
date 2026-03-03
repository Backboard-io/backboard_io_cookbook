"""Recipe 8: Cross-Thread Memory -- persist facts across conversations.

WARNING: In multi-user apps, you MUST use a per-user assistant.
Memories are stored on the assistant, not the thread. A shared assistant
with memory="Auto" leaks every user's facts to every other user.
See docs/00-pitfalls.md and Recipe 12 (per-user isolation).
"""

import asyncio
from _common import get_client, get_or_create_assistant


async def wait_for_memory(client, operation_id: str, timeout: float = 30.0):
    """Poll until a memory operation completes. Raise on failure or timeout."""
    import time
    start = time.time()
    while time.time() - start < timeout:
        status = await client.get_memory_operation_status(operation_id)
        if status.status == "COMPLETED":
            print(f"  Memory operation {operation_id}: COMPLETED")
            return status
        if status.status == "FAILED":
            raise RuntimeError(f"Memory operation {operation_id} failed")
        await asyncio.sleep(1)
    raise TimeoutError(f"Memory operation {operation_id} timed out after {timeout}s")


async def main():
    client = get_client()

    # NOTE: In a real multi-user app, use a per-user assistant here:
    #   assistant_id = await get_user_assistant(client, current_user.id)
    # This demo uses a shared assistant for simplicity.
    assistant_id = await get_or_create_assistant(
        client,
        name="Cookbook Memory",
        system_prompt="You are a helpful assistant with persistent memory.",
    )

    # --- Thread 1: Share some personal info ---
    thread1 = await client.create_thread(assistant_id)
    print("Thread 1: Sharing information...")

    response1 = await client.add_message(
        thread_id=thread1.thread_id,
        content=(
            "Hi! My name is Alex. I'm a backend engineer at Acme Corp. "
            "I prefer Python and my favorite framework is FastAPI. "
            "I'm working on a project called Project Atlas."
        ),
        memory="Auto",
        stream=False,
    )
    print(f"  Assistant: {response1.content[:100]}...")

    # Wait for the memory save to finish before using it in a new thread
    if response1.memory_operation_id:
        await wait_for_memory(client, response1.memory_operation_id)

    # --- Thread 2: Ask what the assistant remembers ---
    thread2 = await client.create_thread(assistant_id)
    print("\nThread 2: Testing recall (completely new conversation)...")

    response2 = await client.add_message(
        thread_id=thread2.thread_id,
        content="What do you know about me? What am I working on?",
        memory="Auto",
        stream=False,
    )
    print(f"  Assistant: {response2.content}")

    # --- Thread 3: Update a fact ---
    thread3 = await client.create_thread(assistant_id)
    print("\nThread 3: Updating information...")

    response3 = await client.add_message(
        thread_id=thread3.thread_id,
        content="Actually, I switched to using Django instead of FastAPI.",
        memory="Auto",
        stream=False,
    )
    print(f"  Assistant: {response3.content[:100]}...")

    if response3.memory_operation_id:
        await wait_for_memory(client, response3.memory_operation_id)

    # --- Thread 4: Verify the update ---
    thread4 = await client.create_thread(assistant_id)
    print("\nThread 4: Verifying update...")

    response4 = await client.add_message(
        thread_id=thread4.thread_id,
        content="What framework do I use?",
        memory="Auto",
        stream=False,
    )
    print(f"  Assistant: {response4.content}")


if __name__ == "__main__":
    asyncio.run(main())
