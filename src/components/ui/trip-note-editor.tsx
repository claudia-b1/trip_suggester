"use client";

import { useState, useRef, useCallback, useEffect } from "react";

type NoteScope = {
  tripId?: number;
  cityId?: number;
  dayPlanId?: number;
};

type TripNoteData = {
  id: number;
  content: string;
};

export function TripNoteEditor({
  initialNote,
  scope,
  compact,
}: {
  initialNote: TripNoteData | null;
  scope: NoteScope;
  /** Compact mode for daily plan (smaller UI) */
  compact?: boolean;
}) {
  const [noteId, setNoteId] = useState<number | null>(initialNote?.id ?? null);
  const [content, setContent] = useState(initialNote?.content ?? "");
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(initialNote?.content ?? "");

  const save = useCallback(
    async (text: string) => {
      if (text === lastSavedRef.current) return;
      setSaving(true);
      try {
        if (noteId) {
          // Update existing note
          const res = await fetch(`/api/notes/${noteId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: text }),
          });
          if (res.ok) lastSavedRef.current = text;
        } else if (text.trim()) {
          // Create new note
          const res = await fetch("/api/notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...scope, content: text }),
          });
          if (res.ok) {
            const note = await res.json();
            setNoteId(note.id);
            lastSavedRef.current = text;
          }
        }
      } finally {
        setSaving(false);
      }
    },
    [noteId, scope],
  );

  function handleChange(newContent: string) {
    setContent(newContent);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(newContent), 1000);
  }

  // Save on blur
  function handleBlur() {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    save(content);
  }

  // Cleanup: save on unmount if pending
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const hasContent = content.trim().length > 0;
  const preview =
    content.length > 100 ? content.slice(0, 100) + "..." : content;

  if (compact) {
    return (
      <div className="mt-1">
        {expanded ? (
          <div className="relative">
            <textarea
              value={content}
              onChange={(e) => handleChange(e.target.value)}
              onBlur={handleBlur}
              rows={2}
              placeholder="Add a note for this day..."
              className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1 text-xs text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--ring))] resize-y"
              autoFocus
            />
            <div className="mt-0.5 flex items-center justify-between">
              <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
                {saving ? "Saving..." : "Auto-saved"}
              </span>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
              >
                Collapse
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="flex items-center gap-1 text-[10px] text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          >
            {hasContent ? (
              <span className="truncate max-w-[200px]">
                📝 {preview}
              </span>
            ) : (
              <span>📝 Add note...</span>
            )}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-4 py-2.5 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-medium text-[hsl(var(--foreground))]">
          📝 Notes
          {hasContent && !expanded && (
            <span className="text-xs font-normal text-[hsl(var(--muted-foreground))] truncate max-w-xs">
              — {preview}
            </span>
          )}
        </span>
        <span
          className="text-xs text-[hsl(var(--muted-foreground))] transition-transform"
          style={{
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          }}
        >
          ▶
        </span>
      </button>
      {expanded && (
        <div className="border-t border-[hsl(var(--border))] px-4 py-3">
          <textarea
            value={content}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={handleBlur}
            rows={4}
            placeholder="Write your notes, thoughts, or travel journal..."
            className="w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))] resize-y"
            autoFocus
          />
          <p className="mt-1 text-[10px] text-[hsl(var(--muted-foreground))]">
            {saving ? "Saving..." : hasContent ? "Auto-saved" : "Start typing to save"}
          </p>
        </div>
      )}
    </div>
  );
}
