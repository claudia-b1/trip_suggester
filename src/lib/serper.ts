/**
 * Serper web search client.
 *
 * Provides web search snippets to ground LLM-generated POI descriptions.
 * Free tier: 2,500 queries/month (serper.dev).
 *
 * Currently commented out — uncomment when ready to enable web-grounded descriptions.
 */

// const SERPER_URL = "https://google.serper.dev/search";

export type SerperResult = {
  title: string;
  snippet: string;
  link: string;
};

/**
 * Search the web for a place and return top organic results.
 * Returns empty array on error or if API key is missing.
 */
export async function searchSerper(
  _query: string,
): Promise<SerperResult[]> {
  // ── Serper search is disabled for now ──────────────────────────────────
  // To enable, uncomment the code below and add SERPER_API_KEY to .env.local
  return [];

  /*
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch(SERPER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": apiKey,
      },
      body: JSON.stringify({ q: query, num: 3 }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return [];

    const data = await res.json() as {
      organic?: Array<{ title?: string; snippet?: string; link?: string }>;
    };

    return (data.organic ?? [])
      .filter((r) => r.title && r.snippet)
      .map((r) => ({
        title: r.title!,
        snippet: r.snippet!,
        link: r.link ?? "",
      }));
  } catch {
    return [];
  }
  */
}
