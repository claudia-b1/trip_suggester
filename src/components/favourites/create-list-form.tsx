"use client";

import { useState } from "react";
import { useFavourites } from "./favourites-provider";
import { useToast } from "@/components/ui/toast";

export function CreateListForm({
  parentId,
  onDone,
}: {
  parentId?: number;
  onDone?: () => void;
}) {
  const { refreshLists } = useFavourites();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/favourites/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), parentId }),
      });
      if (res.ok) {
        setName("");
        toast(`List "${name.trim()}" created!`);
        await refreshLists();
        onDone?.();
      } else {
        const err = await res.json().catch(() => null);
        toast(err?.error ?? "Failed to create list", { variant: "error" });
      }
    } catch {
      toast("Failed to create list", { variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={parentId ? "Sublist name..." : "New list name..."}
        className="flex-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm text-[hsl(var(--foreground))] placeholder:text-[hsl(var(--muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]"
        autoFocus
      />
      <button
        type="submit"
        disabled={!name.trim() || saving}
        className="rounded-md bg-[hsl(var(--primary))] px-3 py-1.5 text-xs font-medium text-[hsl(var(--primary-foreground))] disabled:opacity-50"
      >
        {saving ? "..." : "Add"}
      </button>
    </form>
  );
}
