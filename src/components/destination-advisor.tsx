"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

type Message = {
  role: "user" | "assistant";
  content: string;
};

type Recommendation = {
  name: string;
  country: string;
};

/** Extract [option1 | option2 | ...] from the last line */
function parseOptions(text: string): string[] | null {
  // Match a bracketed pipe-separated list on its own line (not RECOMMENDATIONS)
  const match = text.match(/\n?\[(?!RECOMMENDATIONS:)([^\]]{3,})\]\s*$/);
  if (!match) return null;
  const parts = match[1].split("|").map((s) => s.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

/** Extract [RECOMMENDATIONS: City1, Country1; City2, Country2; ...] */
function parseRecommendations(text: string): Recommendation[] | null {
  const match = text.match(/\[RECOMMENDATIONS:\s*(.*?)\]\s*$/);
  if (!match) return null;
  const entries = match[1].split(";").map((s) => s.trim()).filter(Boolean);
  const recs: Recommendation[] = [];
  for (const entry of entries) {
    const parts = entry.split(",").map((s) => s.trim());
    if (parts.length >= 2) {
      recs.push({ name: parts[0], country: parts.slice(1).join(", ") });
    }
  }
  return recs.length > 0 ? recs : null;
}

/** Strip the bracketed control lines from visible text */
function cleanContent(text: string): string {
  return text
    // Remove [RECOMMENDATIONS: ...] line
    .replace(/\n?\[RECOMMENDATIONS:.*?\]\s*$/g, "")
    // Remove [option | option | ...] line (but not other bracketed text)
    .replace(/\n?\[(?!RECOMMENDATIONS:)([^\]]{3,})\]\s*$/g, "")
    .trim();
}

function AssistantBubble({
  content,
  isStreaming,
  onCreateTrip,
}: {
  content: string;
  isStreaming?: boolean;
  onCreateTrip?: (rec: Recommendation) => void;
}) {
  const cleaned = cleanContent(content);
  const recommendations = parseRecommendations(content);

  return (
    <div className="flex gap-3">
      <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))]/10 text-sm">
        🧭
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <div className="rounded-2xl rounded-tl-md bg-[hsl(var(--muted))] px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
          {cleaned}
          {isStreaming && (
            <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse rounded-sm bg-[hsl(var(--foreground))]/40" />
          )}
        </div>
        {recommendations && recommendations.length > 0 && !isStreaming && (
          <div className="flex flex-wrap gap-2">
            {recommendations.map((rec) => (
              <button
                key={`${rec.name}-${rec.country}`}
                type="button"
                onClick={() => onCreateTrip?.(rec)}
                className="flex items-center gap-1.5 rounded-full border border-[hsl(var(--primary))]/30 bg-[hsl(var(--primary))]/5 px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Create trip to {rec.name}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-2xl rounded-tr-md bg-[hsl(var(--primary))] px-4 py-3 text-sm leading-relaxed text-[hsl(var(--primary-foreground))]">
        {content}
      </div>
    </div>
  );
}

const STARTER_PROMPTS = [
  { label: "I know the area but not the exact spot", emoji: "📍" },
  { label: "I want a beach holiday but don't know where", emoji: "🏖️" },
  { label: "Best road trip routes in Europe?", emoji: "🚗" },
  { label: "Best city trip for a weekend?", emoji: "🏙️" },
  { label: "Other question", emoji: "💬" },
];

export function DestinationAdvisor() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [showInput, setShowInput] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom on new messages / streaming content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingContent]);

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim() || isLoading) return;

      const userMsg: Message = { role: "user", content: content.trim() };
      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      setInput("");
      setIsLoading(true);
      setStreamingContent("");

      try {
        const res = await fetch("/api/advisor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: updatedMessages }),
        });

        if (!res.ok) throw new Error("Request failed");

        const reader = res.body?.getReader();
        if (!reader) throw new Error("No stream");

        const decoder = new TextDecoder();
        let full = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          full += chunk;
          setStreamingContent(full);
        }

        setMessages((prev) => [...prev, { role: "assistant", content: full }]);
        setStreamingContent("");
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Sorry, something went wrong. Please try again." },
        ]);
        setStreamingContent("");
      } finally {
        setIsLoading(false);
        // Focus input after response
        setTimeout(() => inputRef.current?.focus(), 100);
      }
    },
    [messages, isLoading],
  );

  const handleCreateTrip = useCallback(
    async (rec: Recommendation) => {
      try {
        // Create a trip with generous date range (2 weeks from now, 1 week duration)
        const start = new Date();
        start.setDate(start.getDate() + 14);
        const end = new Date(start);
        end.setDate(end.getDate() + 7);

        const tripName = `${rec.name}, ${rec.country}`;

        const res = await fetch("/api/trips", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: tripName,
            startDate: start.toISOString(),
            endDate: end.toISOString(),
          }),
        });

        if (!res.ok) throw new Error("Failed to create trip");
        const trip = await res.json();
        router.push(`/trips/${trip.id}`);
      } catch {
        // Silently fail — the user can create manually
      }
    },
    [router],
  );

  const handleReset = useCallback(() => {
    setMessages([]);
    setStreamingContent("");
    setInput("");
    setIsLoading(false);
    setShowInput(false);
  }, []);

  // Get quick-reply options from the last assistant message
  const lastAssistant = messages.filter((m) => m.role === "assistant").at(-1);
  const quickOptions =
    !isLoading && lastAssistant ? parseOptions(lastAssistant.content) : null;

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="w-full rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 flex items-center gap-4 text-left hover:border-[hsl(var(--primary))]/30 hover:bg-[hsl(var(--primary))]/[0.02] transition-colors"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))]/10 text-lg">
          🧭
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Destination Advisor</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            Tell me roughly what you&apos;re looking for and I&apos;ll help you find the perfect spot.
          </p>
        </div>
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 shrink-0 text-[hsl(var(--muted-foreground))]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    );
  }

  const hasConversation = messages.length > 0;

  return (
    <div className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">🧭</span>
          <h3 className="text-sm font-semibold">Destination Advisor</h3>
        </div>
        <div className="flex items-center gap-1">
          {hasConversation && (
            <button
              type="button"
              onClick={handleReset}
              className="rounded-lg px-2 py-1 text-xs text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
              title="Start over"
            >
              Start over
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="rounded-lg p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))] transition-colors"
            title="Minimize"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
          </button>
        </div>
      </div>

      {/* Chat area */}
      <div ref={scrollRef} className="flex flex-col gap-4 overflow-y-auto px-4 py-4" style={{ maxHeight: "28rem" }}>
        {!hasConversation && !isLoading && (
          <div className="space-y-4">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Tell me roughly what you&apos;re looking for and I&apos;ll help you find the perfect destination!
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {STARTER_PROMPTS.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => {
                    if (s.label === "Other question") {
                      setShowInput(true);
                      setTimeout(() => inputRef.current?.focus(), 100);
                    } else {
                      sendMessage(s.label);
                    }
                  }}
                  className="flex items-center gap-2 rounded-xl border border-[hsl(var(--border))] px-3 py-2.5 text-left text-xs hover:bg-[hsl(var(--muted))] transition-colors"
                >
                  <span className="text-base">{s.emoji}</span>
                  <span className="leading-snug">{s.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) =>
          msg.role === "user" ? (
            <UserBubble key={i} content={msg.content} />
          ) : (
            <AssistantBubble
              key={i}
              content={msg.content}
              onCreateTrip={handleCreateTrip}
            />
          ),
        )}

        {streamingContent && (
          <AssistantBubble content={streamingContent} isStreaming />
        )}

        {isLoading && !streamingContent && (
          <div className="flex gap-3">
            <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary))]/10 text-sm">
              🧭
            </div>
            <div className="rounded-2xl rounded-tl-md bg-[hsl(var(--muted))] px-4 py-3">
              <div className="flex gap-1">
                <span className="h-2 w-2 rounded-full bg-[hsl(var(--foreground))]/30 animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="h-2 w-2 rounded-full bg-[hsl(var(--foreground))]/30 animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="h-2 w-2 rounded-full bg-[hsl(var(--foreground))]/30 animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick-reply options */}
      {quickOptions && quickOptions.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-[hsl(var(--border))]/50 px-4 py-2">
          {quickOptions.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => sendMessage(opt)}
              className="rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-xs font-medium hover:bg-[hsl(var(--muted))] transition-colors"
            >
              {opt}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      {(hasConversation || showInput) && (
        <div className="border-t border-[hsl(var(--border))] p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage(input);
            }}
            className="flex gap-2"
          >
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={hasConversation ? "Type your answer..." : "Describe what you're looking for..."}
              disabled={isLoading}
              className="flex-1 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm placeholder:text-[hsl(var(--muted-foreground))]/60 focus:outline-none focus:ring-2 focus:ring-[hsl(var(--primary))]/30 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="rounded-xl bg-[hsl(var(--primary))] px-4 py-2 text-sm font-medium text-[hsl(var(--primary-foreground))] hover:opacity-90 transition-opacity disabled:opacity-40"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
