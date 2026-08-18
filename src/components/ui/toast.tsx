"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  useRef,
  type ReactNode,
} from "react";

type ToastVariant = "default" | "error";

type ToastAction = {
  label: string;
  onClick: () => void;
};

type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
  durationMs: number;
};

type ToastContextType = {
  toast: (
    message: string,
    opts?: {
      variant?: ToastVariant;
      action?: ToastAction;
      durationMs?: number;
    },
  ) => { dismiss: () => void };
};

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(
    new Map(),
  );

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (
      message: string,
      opts?: {
        variant?: ToastVariant;
        action?: ToastAction;
        durationMs?: number;
      },
    ) => {
      const id = Date.now() + Math.random();
      const durationMs = opts?.durationMs ?? 4000;

      setToasts((prev) => [
        ...prev,
        {
          id,
          message,
          variant: opts?.variant ?? "default",
          action: opts?.action,
          durationMs,
        },
      ]);

      const timer = setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
        timersRef.current.delete(id);
      }, durationMs);

      timersRef.current.set(id, timer);

      return {
        dismiss: () => dismiss(id),
      };
    },
    [dismiss],
  );

  function handleAction(t: Toast) {
    if (t.action) {
      t.action.onClick();
    }
    dismiss(t.id);
  }

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.variant === "error" ? "alert" : "status"}
            data-testid="toast"
            data-variant={t.variant}
            className={`pointer-events-auto toast-enter relative overflow-hidden rounded-lg border p-3 text-sm shadow-lg backdrop-blur-sm ${
              t.variant === "error"
                ? "border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
                : "border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--foreground))]"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex-1">{t.message}</span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => handleAction(t)}
                  className="shrink-0 rounded px-2 py-0.5 text-xs font-bold text-[hsl(var(--primary))] hover:bg-[hsl(var(--primary))]/10 transition-colors"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            {/* Progress bar for timed toasts with actions (undo indicator) */}
            {t.action && (
              <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[hsl(var(--muted))]">
                <div
                  className="h-full bg-[hsl(var(--primary))] toast-progress"
                  style={
                    {
                      "--toast-duration": `${t.durationMs}ms`,
                    } as React.CSSProperties
                  }
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
