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
    <Button variant="destructive" onClick={onDelete} disabled={deleting}>
      {deleting ? "Deleting…" : "Delete trip"}
    </Button>
  );
}
