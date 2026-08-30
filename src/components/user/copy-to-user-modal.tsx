"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useUser, type UserDTO } from "./user-provider";
import { UserAvatar } from "./user-switcher";

type CopyToUserModalProps = {
  /** What kind of entity is being copied */
  entityType: "trip" | "list";
  /** Display name of the entity */
  entityName: string;
  /** Called with the selected target user ID */
  onCopy: (targetUserId: number) => Promise<void>;
  onClose: () => void;
};

export function CopyToUserModal({
  entityType,
  entityName,
  onCopy,
  onClose,
}: CopyToUserModalProps) {
  const { users, activeUser } = useUser();
  const [copying, setCopying] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Other users (exclude active)
  const otherUsers = users.filter((u) => u.id !== activeUser?.id);

  async function handleCopy() {
    if (!selectedId) return;
    setCopying(true);
    try {
      await onCopy(selectedId);
      onClose();
    } catch {
      /* ignore */
    } finally {
      setCopying(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Copy ${entityType}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        role="document"
        className="w-full max-w-sm rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Copy {entityType}</h2>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
          Copy <span className="font-medium text-[hsl(var(--foreground))]">&ldquo;{entityName}&rdquo;</span> to another user
        </p>

        {otherUsers.length === 0 ? (
          <div className="mt-4 rounded-lg border border-dashed border-[hsl(var(--border))] p-4 text-center text-sm text-[hsl(var(--muted-foreground))]">
            No other users to copy to. Create another user first.
          </div>
        ) : (
          <div className="mt-4 space-y-1.5">
            {otherUsers.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setSelectedId(u.id)}
                className={`flex w-full items-center gap-3 rounded-lg border p-3 text-sm transition-colors ${
                  selectedId === u.id
                    ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.05)]"
                    : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                }`}
              >
                <UserAvatar user={u} size="md" />
                <span className="font-medium">{u.name}</span>
                {selectedId === u.id && (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="ml-auto h-4 w-4 text-[hsl(var(--primary))]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {otherUsers.length > 0 && (
            <Button
              size="sm"
              disabled={!selectedId || copying}
              onClick={handleCopy}
            >
              {copying ? "Copying..." : "Copy"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
