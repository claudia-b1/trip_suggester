"use client";

import { useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { fileToDataUri } from "@/lib/file-to-data-uri";

export type AttachmentMeta = {
  id: number;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

type AttachmentsSectionProps = {
  entityType: "poi" | "favourite";
  entityId: number;
  attachments: AttachmentMeta[];
  onChanged: () => void;
  readOnly?: boolean;
};

const MAX_ATTACHMENTS = 5;
const MAX_SIZE_BYTES = 5 * 1024 * 1024;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(mimeType: string): string {
  if (mimeType.startsWith("image/")) return "\u{1F5BC}️";
  if (mimeType === "application/pdf") return "\u{1F4C4}";
  return "\u{1F4CE}";
}

export function AttachmentsSection({
  entityType,
  entityId,
  attachments,
  onChanged,
  readOnly = false,
}: AttachmentsSectionProps) {
  const [expanded, setExpanded] = useState(attachments.length > 0);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const uploadUrl =
    entityType === "poi"
      ? `/api/pois/${entityId}/attachments`
      : `/api/favourites/items/${entityId}/attachments`;

  const handleUpload = useCallback(
    async (file: File) => {
      if (file.size > MAX_SIZE_BYTES) {
        toast(`File too large (max ${MAX_SIZE_BYTES / 1024 / 1024}MB)`, { variant: "error" });
        return;
      }
      if (attachments.length >= MAX_ATTACHMENTS) {
        toast(`Maximum ${MAX_ATTACHMENTS} attachments`, { variant: "error" });
        return;
      }

      setUploading(true);
      try {
        const dataUri = await fileToDataUri(file);
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: file.name,
            mimeType: file.type || "application/octet-stream",
            data: dataUri,
          }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Upload failed" }));
          throw new Error(err.error || "Upload failed");
        }
        toast(`Uploaded ${file.name}`);
        onChanged();
      } catch (err) {
        toast(err instanceof Error ? err.message : "Upload failed", { variant: "error" });
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [attachments.length, onChanged, toast, uploadUrl],
  );

  const handleDelete = useCallback(
    async (id: number) => {
      setDeletingId(id);
      try {
        const res = await fetch(`/api/attachments/${id}`, { method: "DELETE" });
        if (!res.ok && res.status !== 204) {
          throw new Error("Delete failed");
        }
        onChanged();
      } catch {
        toast("Delete failed", { variant: "error" });
      } finally {
        setDeletingId(null);
      }
    },
    [onChanged, toast],
  );

  return (
    <div className="space-y-1">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-sm font-medium text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors"
      >
        <span className="text-xs transition-transform" style={{ transform: expanded ? "rotate(90deg)" : "none" }}>
          &#9654;
        </span>
        Attachments{attachments.length > 0 ? ` (${attachments.length})` : ""}
      </button>

      {expanded && (
        <div className="pl-4 space-y-1.5">
          {attachments.length === 0 && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] italic">No attachments</p>
          )}

          {attachments.map((att) => (
            <div key={att.id} className="flex items-center gap-2 text-sm group">
              <span className="shrink-0">{fileIcon(att.mimeType)}</span>
              <a
                href={`/api/attachments/${att.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-[hsl(var(--primary))] hover:underline max-w-[200px]"
                title={att.filename}
              >
                {att.filename}
              </a>
              <span className="text-xs text-[hsl(var(--muted-foreground))] shrink-0">
                {formatFileSize(att.sizeBytes)}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => handleDelete(att.id)}
                  disabled={deletingId === att.id}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive))]/80 text-xs ml-auto shrink-0"
                  title="Delete attachment"
                >
                  {deletingId === att.id ? "..." : "×"}
                </button>
              )}
            </div>
          ))}

          {!readOnly && attachments.length < MAX_ATTACHMENTS && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleUpload(file);
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? "Uploading..." : "+ Add file"}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
