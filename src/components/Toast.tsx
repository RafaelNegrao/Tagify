import { useEffect } from "react";
import { useStore } from "../store/useStore";

const AUTO_DISMISS_MS = 3500;

/** A single, screen-centered toast for all transient feedback messages. */
export default function Toast() {
  const toast = useStore((s) => s.toast);
  const dismissToast = useStore((s) => s.dismissToast);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(dismissToast, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast, dismissToast]);

  if (!toast) return null;

  return (
    <div className="toast-layer">
      <div className={`toast toast-${toast.type}`} role="status" onClick={dismissToast}>
        <span className="toast-icon" aria-hidden="true">
          {toast.type === "success" ? "✓" : toast.type === "error" ? "✕" : "ℹ"}
        </span>
        <span className="toast-message">{toast.message}</span>
      </div>
    </div>
  );
}
