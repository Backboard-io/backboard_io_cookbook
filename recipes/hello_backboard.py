"""Recipe 1: Hello Backboard -- send your first message and get a response."""

import asyncio
from _common import get_client, get_or_create_assistant


async def main():
    client = get_client()

    # Step 1: Create (or reuse) an assistant
    assistant_id = await get_or_create_assistant(
        client,
        name="Cookbook Hello",
        system_prompt="You are a helpful assistant. Keep answers brief.",
    )
    print(f"Assistant: {assistant_id}")

    # Step 2: Create a thread (a conversation session)
    thread = await client.create_thread(assistant_id)
    print(f"Thread: {thread.thread_id}")

    # Step 3: Send a message and get a response
    response = await client.add_message(
        thread_id=thread.thread_id,
        content="What are three things every developer should know?",
        stream=False,
    )

    print(f"Status: {response.status}")
    print(f"Response: {response.content}")
    print(f"Model: {response.model_provider}/{response.model_name}")
    print(f"Tokens: {response.total_tokens}")


if __name__ == "__main__":
    asyncio.run(main())
