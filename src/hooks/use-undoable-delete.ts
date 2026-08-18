"use client";

import { useRef, useEffect, useCallback } from "react";
import { useToast } from "@/components/ui/toast";

type UndoableDeleteOpts = {
  /** Async function that performs the actual deletion (API call). */
  onDelete: () => Promise<void>;
  /** Callback to restore the item to the UI if the user clicks Undo. */
  onRestore: () => void;
  /** Short label for the toast message, e.g. item name. */
  label: string;
};

/**
 * Returns a function that performs an "undoable delete":
 * 1. Caller removes the item from UI optimistically before calling this.
 * 2. A toast appears with an "Undo" button for 5 seconds.
 * 3. If Undo is clicked → item is restored to UI, API call is skipped.
 * 4. If 5 seconds elapse → the API delete executes.
 *
 * Pending deletes are executed if the component unmounts.
 */
export function useUndoableDelete() {
  const { toast } = useToast();
  const pendingRef = useRef<
    Map<number, { timer: ReturnType<typeof setTimeout>; onDelete: () => Promise<void> }>
  >(new Map());

  // On unmount, execute all remaining pending deletes
  useEffect(() => {
    const pending = pendingRef.current;
    return () => {
      for (const [, entry] of pending) {
        clearTimeout(entry.timer);
        entry.onDelete().catch(() => {});
      }
      pending.clear();
    };
  }, []);

  const undoableDelete = useCallback(
    ({ onDelete, onRestore, label }: UndoableDeleteOpts) => {
      const id = Date.now() + Math.random();

      const timer = setTimeout(() => {
        pendingRef.current.delete(id);
        onDelete().catch(() => {});
      }, 5000);

      pendingRef.current.set(id, { timer, onDelete });

      toast(`Deleted "${label}"`, {
        durationMs: 5000,
        action: {
          label: "Undo",
          onClick: () => {
            const entry = pendingRef.current.get(id);
            if (entry) {
              clearTimeout(entry.timer);
              pendingRef.current.delete(id);
            }
            onRestore();
          },
        },
      });
    },
    [toast],
  );

  return undoableDelete;
}
