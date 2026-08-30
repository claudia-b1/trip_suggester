"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUser, type UserDTO } from "./user-provider";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  setDefaultUser,
  getDefaultUserId,
  clearDefaultUser,
} from "@/lib/active-user-client";

const COLOR_PRESETS = [
  "#3B82F6",
  "#8B5CF6",
  "#EC4899",
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#22C55E",
  "#14B8A6",
  "#6366F1",
  "#64748B",
];

const AVATAR_EMOJIS = [
  null,
  "😀", "😎", "🤓", "🧑‍💻", "🧑‍🎨", "🧑‍🔬", "🧑‍🚀",
  "🦊", "🐱", "🐶", "🐻", "🦁", "🐼", "🦄",
  "🌟", "🌈", "🔥", "💎", "🎯", "🚀", "✈️",
];

export function UserManageModal({ onClose }: { onClose: () => void }) {
  const { users, createUser, updateUser, deleteUser, activeUser, switchUser } =
    useUser();
  const confirm = useConfirm();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [addingNew, setAddingNew] = useState(false);

  // Form state for edit/add
  const [formName, setFormName] = useState("");
  const [formColor, setFormColor] = useState(COLOR_PRESETS[0]);
  const [formAvatar, setFormAvatar] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const defaultUserId = typeof window !== "undefined" ? getDefaultUserId() : null;

  function startEdit(user: UserDTO) {
    setEditingId(user.id);
    setAddingNew(false);
    setFormName(user.name);
    setFormColor(user.color);
    setFormAvatar(user.avatar);
  }

  function startAdd() {
    setAddingNew(true);
    setEditingId(null);
    setFormName("");
    setFormColor(COLOR_PRESETS[0]);
    setFormAvatar(null);
  }

  function cancelForm() {
    setEditingId(null);
    setAddingNew(false);
  }

  async function handleSave() {
    if (!formName.trim()) return;
    setSaving(true);
    try {
      if (addingNew) {
        const user = await createUser({
          name: formName.trim(),
          color: formColor,
          avatar: formAvatar,
        });
        switchUser(user.id);
      } else if (editingId) {
        await updateUser(editingId, {
          name: formName.trim(),
          color: formColor,
          avatar: formAvatar,
        });
      }
      cancelForm();
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(user: UserDTO) {
    const ok = await confirm({
      title: `Delete ${user.name}?`,
      message: `All trips, favourites, and ratings for "${user.name}" will be permanently deleted. This cannot be undone.`,
      confirmText: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    try {
      await deleteUser(user.id);
      if (editingId === user.id) cancelForm();
    } catch {
      /* ignore */
    }
  }

  function handleSetDefault(userId: number) {
    setDefaultUser(userId);
    // Force re-render by updating a counter — but we keep it simple
    // The component will re-read on next open
  }

  function handleClearDefault() {
    clearDefaultUser();
  }

  const isEditing = editingId !== null || addingNew;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Manage users"
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div
        role="document"
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--background))] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-6 py-4">
          <h2 className="text-lg font-semibold">Manage Users</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))]"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* User list */}
          <div className="space-y-2">
            {users.map((u) => (
              <div
                key={u.id}
                className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                  editingId === u.id
                    ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.05)]"
                    : "border-[hsl(var(--border))]"
                }`}
              >
                <span
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full font-semibold text-white"
                  style={{ backgroundColor: u.color }}
                >
                  {u.avatar ?? u.name.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{u.name}</span>
                    {u.id === activeUser?.id && (
                      <span className="shrink-0 rounded bg-[hsl(var(--primary)/0.1)] px-1.5 py-0.5 text-[10px] font-semibold text-[hsl(var(--primary))]">
                        Active
                      </span>
                    )}
                    {u.id === defaultUserId && (
                      <span className="shrink-0 rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 text-[10px] font-semibold text-[hsl(var(--muted-foreground))]">
                        Default
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {u.id !== defaultUserId && (
                    <button
                      type="button"
                      onClick={() => handleSetDefault(u.id)}
                      title="Set as default for this device"
                      className="flex h-7 items-center rounded px-2 text-xs text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                    >
                      Set default
                    </button>
                  )}
                  {u.id === defaultUserId && (
                    <button
                      type="button"
                      onClick={handleClearDefault}
                      title="Remove as default"
                      className="flex h-7 items-center rounded px-2 text-xs text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))]"
                    >
                      Unset
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => startEdit(u)}
                    className="flex h-7 w-7 items-center justify-center rounded text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
                    title="Edit"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                  {users.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleDelete(u)}
                      className="flex h-7 w-7 items-center justify-center rounded text-[hsl(var(--muted-foreground))] transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                      title="Delete"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Edit / Add form */}
          {isEditing && (
            <div className="mt-4 space-y-4 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--muted)/0.3)] p-4">
              <h3 className="text-sm font-semibold">
                {addingNew ? "New User" : "Edit User"}
              </h3>

              <div>
                <label
                  htmlFor="manage-name"
                  className="mb-1 block text-xs font-medium"
                >
                  Name
                </label>
                <Input
                  id="manage-name"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Name"
                  autoFocus
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium">Colour</label>
                <div className="flex flex-wrap gap-2">
                  {COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setFormColor(c)}
                      className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                        formColor === c
                          ? "border-[hsl(var(--foreground))] scale-110"
                          : "border-transparent"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium">
                  Avatar
                </label>
                <div className="flex flex-wrap gap-1">
                  {AVATAR_EMOJIS.map((emoji, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setFormAvatar(emoji)}
                      className={`flex h-8 w-8 items-center justify-center rounded-md border text-base transition-colors ${
                        formAvatar === emoji
                          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.1)]"
                          : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
                      }`}
                    >
                      {emoji ?? (
                        <span
                          className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-bold text-white"
                          style={{ backgroundColor: formColor }}
                        >
                          {formName.trim()
                            ? formName.trim().charAt(0).toUpperCase()
                            : "A"}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={cancelForm}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!formName.trim() || saving}
                  onClick={handleSave}
                >
                  {saving ? "Saving..." : addingNew ? "Create" : "Save"}
                </Button>
              </div>
            </div>
          )}

          {/* Add user button */}
          {!addingNew && (
            <button
              type="button"
              onClick={startAdd}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[hsl(var(--border))] p-3 text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:border-[hsl(var(--primary))] hover:text-[hsl(var(--primary))]"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Add user
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-[hsl(var(--border))] px-6 py-3">
          <Button variant="outline" size="sm" onClick={onClose} className="w-full">
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
