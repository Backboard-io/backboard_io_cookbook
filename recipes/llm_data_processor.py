"""Recipe 7: LLM Data Processor -- use throwaway threads for structured extraction."""

import asyncio
import json
from _common import get_client, get_or_create_assistant


SAMPLE_ARTICLES = [
    {
        "id": "a1",
        "title": "New Python 3.13 Release Focuses on Performance",
        "body": "The Python Software Foundation announced Python 3.13 with significant "
                "performance improvements including a faster JIT compiler...",
    },
    {
        "id": "a2",
        "title": "Fed Holds Interest Rates Steady",
        "body": "The Federal Reserve decided to maintain current interest rates, "
                "citing stable inflation and moderate economic growth...",
    },
    {
        "id": "a3",
        "title": "Lakers Win Championship in Overtime Thriller",
        "body": "The Los Angeles Lakers secured the NBA championship with a dramatic "
                "overtime victory in Game 7...",
    },
]


async def classify_article(client, assistant_id: str, article: dict) -> dict:
    """Classify a single article using a throwaway thread."""
    thread = await client.create_thread(assistant_id)

    response = await client.add_message(
        thread_id=thread.thread_id,
        content=(
            f"Classify this article. Return ONLY valid JSON with keys: "
            f"category (one of: tech, business, sports, politics, science), "
            f"sentiment (positive, negative, neutral), and "
            f"tags (list of 2-3 keyword strings).\n\n"
            f"Title: {article['title']}\n"
            f"Body: {article['body']}"
        ),
        stream=False,
    )

    # Parse JSON from the LLM response
    text = response.content.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()

    result = json.loads(text)
    return {
        "article_id": article["id"],
        "title": article["title"],
        **result,
    }


async def main():
    client = get_client()

    assistant_id = await get_or_create_assistant(
        client,
        name="Cookbook Classifier",
        system_prompt=(
            "You are a data classification engine. You receive articles and return "
            "structured JSON classifications. Return ONLY valid JSON, no explanation."
        ),
    )

    print("Classifying articles...\n")

    for article in SAMPLE_ARTICLES:
        try:
            result = classify_article(client, assistant_id, article)
            print(f"  {result['title']}")
            print(f"    Category: {result.get('category')}")
            print(f"    Sentiment: {result.get('sentiment')}")
            print(f"    Tags: {result.get('tags')}")
            print()
        except json.JSONDecodeError as e:
            print(f"  Failed to parse JSON for '{article['title']}': {e}")


if __name__ == "__main__":
    asyncio.run(main())
