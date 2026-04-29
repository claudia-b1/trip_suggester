"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { Button } from "./button";

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
};

type ConfirmContextType = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = createContext<ConfirmContextType | null>(null);

type Pending = ConfirmOptions & { resolve: (v: boolean) => void };

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  function close(value: boolean) {
    if (pending) pending.resolve(value);
    setPending(null);
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={pending.title ?? "Confirm"}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => close(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") close(false);
          }}
        >
          <div
            role="document"
            data-testid="confirm-dialog"
            className="w-full max-w-md rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {pending.title && (
              <h2 className="text-lg font-semibold">{pending.title}</h2>
            )}
            <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
              {pending.message}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => close(false)}
                data-testid="confirm-cancel"
              >
                {pending.cancelText ?? "Cancel"}
              </Button>
              <Button
                variant={
                  pending.variant === "destructive" ? "destructive" : "default"
                }
                onClick={() => close(true)}
                data-testid="confirm-ok"
                autoFocus
              >
                {pending.confirmText ?? "Confirm"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx.confirm;
}
