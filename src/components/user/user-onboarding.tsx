"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUser } from "./user-provider";
import { setDefaultUser } from "@/lib/active-user-client";

const COLOR_PRESETS = [
  "#4F46E5", // blue
  "#8B5CF6", // purple
  "#EC4899", // pink
  "#EF4444", // red
  "#F97316", // orange
  "#EAB308", // yellow
  "#22C55E", // green
  "#14B8A6", // teal
  "#6366F1", // indigo
  "#64748B", // slate
];

const AVATAR_EMOJIS = [
  null, // "no emoji" option — uses first letter
  "😀", "😎", "🤓", "🧑‍💻", "🧑‍🎨", "🧑‍🔬", "🧑‍🚀",
  "🦊", "🐱", "🐶", "🐻", "🦁", "🐼", "🦄",
  "🌟", "🌈", "🔥", "💎", "🎯", "🚀", "✈️",
];

export function UserOnboarding() {
  const { createUser, needsOnboarding, loading } = useUser();
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLOR_PRESETS[0]);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!needsOnboarding || loading) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      const user = await createUser({ name: name.trim(), color, avatar });
      setDefaultUser(user.id);
    } catch {
      /* toast would be nice, but keep simple */
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-8 shadow-2xl">
        <div className="mb-6 text-center">
          <div className="mb-3 text-4xl">✈️</div>
          <h1 className="text-2xl font-bold">Welcome to Trip Planner</h1>
          <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
            Create your profile to get started
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div>
            <label
              htmlFor="onboard-name"
              className="mb-1.5 block text-sm font-medium"
            >
              Your name
            </label>
            <Input
              id="onboard-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Alex"
              autoFocus
              required
            />
          </div>

          {/* Colour picker */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Pick a colour
            </label>
            <div className="flex flex-wrap gap-2">
              {COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`h-8 w-8 rounded-full border-2 transition-transform hover:scale-110 ${
                    color === c
                      ? "border-[hsl(var(--foreground))] scale-110"
                      : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Avatar emoji */}
          <div>
            <label className="mb-1.5 block text-sm font-medium">
              Avatar (optional)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {AVATAR_EMOJIS.map((emoji, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setAvatar(emoji)}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-colors ${
                    avatar === emoji
                      ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]"
                      : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                  }`}
                >
                  {emoji ?? (
                    <span
                      className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {name.trim() ? name.trim().charAt(0).toUpperCase() : "A"}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div className="flex items-center gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.5)] p-3">
            <span
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-lg font-semibold text-white"
              style={{ backgroundColor: color }}
            >
              {avatar ??
                (name.trim()
                  ? name.trim().charAt(0).toUpperCase()
                  : "?")}
            </span>
            <div>
              <div className="font-medium">
                {name.trim() || "Your name"}
              </div>
              <div className="text-xs text-[hsl(var(--muted-foreground))]">
                Preview
              </div>
            </div>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={!name.trim() || saving}
          >
            {saving ? "Creating..." : "Get started"}
          </Button>
        </form>
      </div>
    </div>
  );
}
