/**
 * Shared OpenRouter client.
 *
 * Every call site used to hand-roll its own fetch with different timeouts,
 * retry counts and error handling — one of them leaked raw provider JSON to the
 * end user, and only one set a timeout at all. This centralises that.
 *
 * Three shapes, because the call sites genuinely differ:
 *   completeJson   — non-streaming, returns the message text
 *   completeText   — streaming, accumulated server-side (beats OpenRouter's
 *                    queue more often than non-streaming for long generations)
 *   rawStream      — returns the upstream Response for proxying to the browser
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** General-purpose model used for activities, city info, advisor and must-visit. */
export const DEFAULT_MODEL = "inclusionai/ling-3.0-flash-sante:free";
/** Cheaper model used for bulk POI description generation. */
export const DESCRIPTION_MODEL = "nex-agi/nex-n2.5-mini:free";

const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_RETRIES = 2;

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type OpenRouterOptions = {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Retries on 429/5xx/timeout. 0 disables. */
  retries?: number;
  signal?: AbortSignal;
};

export type OpenRouterError = {
  /** Safe to show a user — never contains raw provider payloads. */
  userMessage: string;
  /** Full detail for server logs. */
  detail: string;
  status: number;
  retryable: boolean;
};

export class OpenRouterFailure extends Error {
  readonly info: OpenRouterError;
  constructor(info: OpenRouterError) {
    super(info.detail);
    this.name = "OpenRouterFailure";
    this.info = info;
  }
}

function apiKey(): string | null {
  return process.env.OPENROUTER_API_KEY ?? null;
}

/** Turn an upstream status into something worth showing a user. */
function describe(status: number, detail: string): OpenRouterError {
  if (status === 429) {
    return {
      userMessage: "The AI service is rate-limited right now. Wait a moment and try again.",
      detail, status, retryable: true,
    };
  }
  if (status === 402) {
    return {
      userMessage: "The AI service rejected the request for billing reasons. Check your OpenRouter account.",
      detail, status, retryable: false,
    };
  }
  if (status === 401 || status === 403) {
    return {
      userMessage: "The AI service rejected the API key. Check OPENROUTER_API_KEY.",
      detail, status, retryable: false,
    };
  }
  if (status >= 500) {
    return {
      userMessage: "The AI service is having trouble. Try again shortly.",
      detail, status, retryable: true,
    };
  }
  return {
    userMessage: "The AI request failed. Try again.",
    detail, status, retryable: status === 408,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST to OpenRouter with a timeout, retrying transient failures with backoff.
 * Returns the raw Response — callers decide how to read the body.
 */
export async function rawStream(opts: OpenRouterOptions & { stream?: boolean }): Promise<Response> {
  const key = apiKey();
  if (!key) {
    throw new OpenRouterFailure({
      userMessage: "AI features are not configured on this server.",
      detail: "OPENROUTER_API_KEY is not set",
      status: 500,
      retryable: false,
    });
  }

  const {
    messages, model = DEFAULT_MODEL, maxTokens, temperature,
    timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, stream = false, signal,
  } = opts;

  const body = JSON.stringify({
    model,
    messages,
    ...(maxTokens != null ? { max_tokens: maxTokens } : {}),
    ...(temperature != null ? { temperature } : {}),
    ...(stream ? { stream: true } : {}),
  });

  let last: OpenRouterError | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(2 ** attempt * 500, 8000));

    let res: Response;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          // OpenRouter uses these for attribution on free-tier models.
          "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "http://localhost:3000",
          "X-Title": "Trip Planner",
        },
        body,
        signal: signal ?? AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const aborted = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      last = {
        userMessage: aborted
          ? "The AI request took too long and was cancelled. Try again, or generate fewer sections at once."
          : "Could not reach the AI service. Check your connection.",
        detail: e instanceof Error ? e.message : String(e),
        status: aborted ? 504 : 502,
        // A caller-supplied abort is deliberate — never retry that.
        retryable: aborted && !signal?.aborted,
      };
      if (!last.retryable) throw new OpenRouterFailure(last);
      continue;
    }

    if (res.ok) return res;

    const detail = await res.text().catch(() => "");
    last = describe(res.status, detail.slice(0, 500));
    console.error(`[openrouter] attempt ${attempt + 1}/${retries + 1} — ${res.status}: ${detail.slice(0, 200)}`);
    if (!last.retryable) break;
  }

  throw new OpenRouterFailure(last ?? {
    userMessage: "The AI request failed. Try again.",
    detail: "unknown failure",
    status: 502,
    retryable: false,
  });
}

/** Non-streaming completion. Returns the assistant message text. */
export async function completeJson(opts: OpenRouterOptions): Promise<string> {
  const res = await rawStream({ ...opts, stream: false });

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    error?: { message?: string };
  };

  if (data.error) {
    throw new OpenRouterFailure({
      userMessage: "The AI service returned an error. Try again.",
      detail: data.error.message ?? "unknown provider error",
      status: 502,
      retryable: true,
    });
  }

  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/**
 * Streaming completion accumulated into a single string.
 * Streaming often clears OpenRouter's queue faster than a blocking request.
 */
export async function completeText(opts: OpenRouterOptions): Promise<string> {
  const res = await rawStream({ ...opts, stream: true });

  const reader = res.body?.getReader();
  if (!reader) {
    throw new OpenRouterFailure({
      userMessage: "The AI service returned an empty response. Try again.",
      detail: "no response body",
      status: 502,
      retryable: true,
    });
  }

  const decoder = new TextDecoder();
  let text = "";
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const payload = trimmed.slice(6);
        if (payload === "[DONE]") continue;

        try {
          const parsed = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string } }>;
            error?: { message?: string };
          };
          if (parsed.error) {
            throw new OpenRouterFailure({
              userMessage: "The AI service returned an error mid-response. Try again.",
              detail: parsed.error.message ?? "stream error",
              status: 502,
              retryable: true,
            });
          }
          const chunk = parsed.choices?.[0]?.delta?.content;
          if (chunk) text += chunk;
        } catch (e) {
          if (e instanceof OpenRouterFailure) throw e;
          // Ignore unparseable SSE fragments — partial chunks are normal.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return text;
}
