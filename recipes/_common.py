"""Shared helpers for Backboard cookbook recipes."""

import asyncio
import os
import threading
from typing import Optional

from backboard import BackboardClient


def get_client() -> BackboardClient:
    """Create a BackboardClient from the BACKBOARD_API_KEY env var."""
    api_key = os.getenv("BACKBOARD_API_KEY")
    if not api_key:
        raise ValueError("Set BACKBOARD_API_KEY environment variable")
    return BackboardClient(api_key=api_key)


async def get_or_create_assistant(
    client: BackboardClient,
    name: str,
    system_prompt: Optional[str] = None,
    tools: Optional[list] = None,
) -> str:
    """Find an existing assistant by name, or create one. Returns assistant_id."""
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


async def wait_for_memory(
    client: BackboardClient,
    operation_id: str,
    timeout: float = 30.0,
    poll_interval: float = 1.0,
):
    """Poll until a memory operation completes. Raise on failure or timeout.

    Use this after add_message(..., memory="Auto") when you need the memory
    to be available before the next request (e.g., a follow-up thread).
    """
    import time
    start = time.time()
    while time.time() - start < timeout:
        status = await client.get_memory_operation_status(operation_id)
        if status.status == "COMPLETED":
            return status
        if status.status == "FAILED":
            raise RuntimeError(f"Memory operation {operation_id} failed")
        await asyncio.sleep(poll_interval)
    raise TimeoutError(f"Memory operation {operation_id} timed out after {timeout}s")


def run_async(coro):
    """Run an async coroutine from synchronous context.

    Handles the case where an event loop is already running (e.g. Jupyter)
    by spinning up a background thread.
    """
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)

    result = None
    exc = None

    def _run():
        nonlocal result, exc
        try:
            result = asyncio.run(coro)
        except Exception as e:
            exc = e

    t = threading.Thread(target=_run)
    t.start()
    t.join()

    if exc:
        raise exc
    return result
