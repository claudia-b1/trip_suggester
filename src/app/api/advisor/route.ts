/**
 * POST /api/advisor
 *
 * Conversational destination advisor powered by OpenRouter (free model).
 * Accepts the full conversation history and streams the next assistant reply.
 *
 * The system prompt instructs the LLM to:
 *  1. Ask up to 5 clarifying questions (one at a time) with quick-reply options.
 *  2. After gathering enough info, recommend 2-4 destinations with pros/cons.
 *  3. Format recommendations in a parseable JSON block.
 */
import { getActiveUserId } from "@/lib/active-user";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "minimax/minimax-m3:free";

const SYSTEM_PROMPT = `You are a friendly travel advisor. Match the user's language (Dutch → Dutch, English → English, etc.).

CRITICAL RULES — FOLLOW EXACTLY:
- NEVER show your reasoning, thinking, or fact-checking. Only output your final answer.
- NEVER reference the format or structure of your response. Just write naturally.
- Be concise. Short paragraphs, no essays.

PROCESS:
1. User describes what they want. Ask ONE short clarifying question. Max 5 questions total, but usually 2-3 is enough.
2. After each question, add quick-reply suggestions on the LAST line in this exact format:
   [option1 | option2 | option3 | option4]
   Options must be 1-4 words each. Always put this on its own line at the very end.
3. When you have enough info, give 2-4 destination recommendations. For each:
   - Why it fits (1-2 sentences)
   - Pros (2-3 bullet points)
   - Cons (1-2 bullet points, be honest)
   - One practical tip
   Then on the very last line add:
   [RECOMMENDATIONS: City1, Country1; City2, Country2; City3, Country3]

NEVER output JSON, code blocks, or markdown fences. Just plain text with the bracketed lines described above.`;

export async function POST(req: Request) {
  const userId = await getActiveUserId();
  if (!userId) {
    return new Response(JSON.stringify({ error: "No active user" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "OPENROUTER_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { messages } = (await req.json()) as {
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
      ],
      max_tokens: 1500,
      temperature: 0.5,
      stream: true,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return new Response(JSON.stringify({ error: "AI request failed", detail: text }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Stream the response through to the client
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = res.body?.getReader();
      if (!reader) {
        controller.close();
        return;
      }

      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;

            try {
              const parsed = JSON.parse(data) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                controller.enqueue(encoder.encode(content));
              }
            } catch {
              // Skip unparseable chunks
            }
          }
        }
      } finally {
        reader.releaseLock();
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
