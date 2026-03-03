"""Recipe 3: Tool-Calling Assistant -- define tools, handle REQUIRES_ACTION, loop."""

import asyncio
import json
from _common import get_client, get_or_create_assistant


# --- Tool definitions (OpenAI function-calling format) ---

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "Get current weather for a city",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "City name"},
                    "units": {
                        "type": "string",
                        "enum": ["celsius", "fahrenheit"],
                        "description": "Temperature units",
                    },
                },
                "required": ["city"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_population",
            "description": "Get the population of a city",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {"type": "string", "description": "City name"},
                },
                "required": ["city"],
            },
        },
    },
]


# --- Tool handler: executes tools and returns results ---

def handle_tool_call(name: str, args: dict) -> str:
    """Dispatch a tool call to the appropriate handler. Returns JSON string."""
    if name == "get_weather":
        return json.dumps({
            "city": args["city"],
            "temperature": 72,
            "units": args.get("units", "fahrenheit"),
            "condition": "sunny",
        })
    elif name == "get_population":
        return json.dumps({
            "city": args["city"],
            "population": 884_363,
        })
    else:
        return json.dumps({"error": f"Unknown tool: {name}"})


async def main():
    client = get_client()

    assistant_id = await get_or_create_assistant(
        client,
        name="Cookbook Tools",
        system_prompt="You help users look up city information. Use the available tools.",
        tools=TOOLS,
    )

    thread = await client.create_thread(assistant_id)

    # Send a message that should trigger tool calls
    response = await client.add_message(
        thread_id=thread.thread_id,
        content="What's the weather and population of San Francisco?",
        stream=False,
    )

    # --- The tool-calling loop ---
    # Keep going while the assistant wants to call tools.
    while response.status == "REQUIRES_ACTION" and response.tool_calls:
        print(f"Assistant wants to call {len(response.tool_calls)} tool(s)")

        tool_outputs = []
        for tc in response.tool_calls:
            args = tc.function.parsed_arguments
            print(f"  Calling {tc.function.name}({args})")

            result = handle_tool_call(tc.function.name, args)
            tool_outputs.append({
                "tool_call_id": tc.id,
                "output": result,
            })

        # Submit tool outputs back to continue the conversation
        response = await client.submit_tool_outputs(
            thread_id=thread.thread_id,
            run_id=response.run_id,
            tool_outputs=tool_outputs,
        )

    print(f"\nFinal response: {response.content}")


if __name__ == "__main__":
    asyncio.run(main())
