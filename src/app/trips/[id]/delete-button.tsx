"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useConfirm } from "@/components/ui/confirm-dialog";

export function DeleteTripButton({ id }: { id: number }) {
  const router = useRouter();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [deleting, setDeleting] = useState(false);

  async function onDelete() {
    const ok = await confirm({
      title: "Delete trip?",
      message:
        "This removes the trip and everything inside it (cities, POIs, day plans). This cannot be undone.",
      confirmText: "Delete",
      variant: "destructive",
    });
    if (!ok) return;
    setDeleting(true);
    const res = await fetch(`/api/trips/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setDeleting(false);
      toast("Failed to delete trip", { variant: "error" });
      return;
    }
    router.push("/");
    router.refresh();
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onDelete}
      disabled={deleting}
      className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 hover:border-red-300"
    >
      {deleting ? (
        "Deleting…"
      ) : (
        <>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
            <path d="M9 6V4h6v2" />
          </svg>
          Delete trip
        </>
      )}
    </Button>
  );
}
