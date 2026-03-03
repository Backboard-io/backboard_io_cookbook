"""Recipe 5: Document RAG -- upload a document, wait for indexing, query it."""

import asyncio
import time
from _common import get_client, get_or_create_assistant


SAMPLE_DOCUMENT = """
# Acme Corp Employee Handbook

## Remote Work Policy
Employees may work remotely up to 3 days per week. Remote days must be
coordinated with your team lead. All-hands meetings on Tuesdays and
Thursdays require in-office attendance.

## PTO Policy
Full-time employees receive 20 days of PTO per year. PTO accrues at
1.67 days per month. Unused PTO carries over up to a maximum of 5 days.

## Equipment
Acme provides a laptop and monitor for all employees. Additional equipment
requests go through the IT portal. The annual equipment budget is $1,500
per employee.
"""


async def main():
    client = get_client()

    assistant_id = await get_or_create_assistant(
        client,
        name="Cookbook RAG",
        system_prompt="You answer questions about uploaded documents. Be specific and cite the document.",
    )

    # Step 1: Upload a document to the assistant
    doc = await client.upload_document_to_assistant(
        assistant_id=assistant_id,
        filename="handbook.md",
        file_content=SAMPLE_DOCUMENT.encode("utf-8"),
    )
    print(f"Uploaded: {doc.document_id} (status={doc.status})")

    # Step 2: Poll until the document is indexed
    while True:
        status = await client.get_document_status(doc.document_id)
        print(f"  Document status: {status.status}")
        if status.status == "indexed":
            break
        if status.status == "error":
            print(f"  Error: {status.status_message}")
            return
        time.sleep(2)

    # Step 3: Ask a question -- the assistant automatically searches the document
    thread = await client.create_thread(assistant_id)
    response = await client.add_message(
        thread_id=thread.thread_id,
        content="How many PTO days do employees get? Does unused PTO carry over?",
        stream=False,
    )

    print(f"\nQuestion: How many PTO days do employees get?")
    print(f"Answer: {response.content}")

    # Ask another question
    response2 = await client.add_message(
        thread_id=thread.thread_id,
        content="What is the annual equipment budget?",
        stream=False,
    )
    print(f"\nQuestion: What is the annual equipment budget?")
    print(f"Answer: {response2.content}")


if __name__ == "__main__":
    asyncio.run(main())
