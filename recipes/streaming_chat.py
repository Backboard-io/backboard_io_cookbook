"""Recipe 4: Streaming Chat -- stream tokens via SSE as they arrive."""

import asyncio
from _common import get_client, get_or_create_assistant


async def main():
    client = get_client()

    assistant_id = await get_or_create_assistant(
        client,
        name="Cookbook Streaming",
        system_prompt="You are a helpful assistant. Give detailed answers.",
    )

    thread = await client.create_thread(assistant_id)

    # Stream the response -- add_message with stream=True returns an async iterator
    print("Assistant: ", end="", flush=True)

    async for chunk in await client.add_message(
        thread_id=thread.thread_id,
        content="Explain how a hash table works in 3 paragraphs.",
        stream=True,
    ):
        event_type = chunk.get("type")

        if event_type == "content_streaming":
            # Each chunk has a small piece of the response text
            token = chunk.get("content", "")
            if token:
                print(token, end="", flush=True)

        elif event_type == "run_ended":
            # The run is complete -- metadata is available here
            print()  # newline after streaming
            print(f"\nModel: {chunk.get('model_provider')}/{chunk.get('model_name')}")
            print(f"Tokens: {chunk.get('total_tokens')}")

            # If memory was enabled, you'd get memory_operation_id here
            mem_op = chunk.get("memory_operation_id")
            if mem_op:
                print(f"Memory operation: {mem_op}")

        elif event_type == "error" or event_type == "run_failed":
            print(f"\nError: {chunk.get('error') or chunk.get('message')}")
            break


if __name__ == "__main__":
    asyncio.run(main())
