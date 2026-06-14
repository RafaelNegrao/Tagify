import { useState } from "react";
import { runUpdate, type UpdateInfo } from "../updater";
import { useStore } from "../store/useStore";

/** Startup screen shown when a newer release exists: Atualizar / Cancelar. */
export default function UpdateGate({
  info,
  onCancel,
}: {
  info: UpdateInfo;
  onCancel: () => void;
}) {
  const showToast = useStore((s) => s.showToast);
  const [downloading, setDownloading] = useState(false);

  const onUpdate = async () => {
    setDownloading(true);
    try {
      // Downloads the new exe and relaunches; this process then exits.
      await runUpdate(info.version, info.url);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
      setDownloading(false);
    }
  };

  return (
    <div className="update-gate">
      <div className="update-card">
        {downloading ? (
          <>
            <div className="update-spinner" aria-hidden="true" />
            <h1 className="update-title">Baixando atualização…</h1>
            <p className="update-sub">O Tagify vai reiniciar automaticamente quando terminar.</p>
            <div className="update-bar" aria-hidden="true">
              <span />
            </div>
          </>
        ) : (
          <>
            <div className="update-badge" aria-hidden="true">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path className="update-badge-arrow" d="M12 4v10M7 11l5 5 5-5" />
                <path d="M5 20h14" />
              </svg>
            </div>
            <h1 className="update-title">Atualização disponível</h1>
            <p className="update-sub">
              Versão <b>{info.version}</b>
              {info.current ? ` (atual ${info.current})` : ""}.
            </p>
            <div className="update-actions">
              <button className="btn btn-primary" onClick={onUpdate}>
                Atualizar
              </button>
              <button className="btn" onClick={onCancel}>
                Cancelar
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
