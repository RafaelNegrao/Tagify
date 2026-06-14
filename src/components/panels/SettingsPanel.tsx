import { useEffect, useState } from "react";
import { useStore } from "../../store/useStore";
import { getStoredActivationCode } from "../../license";
import { APP_VERSION, checkUpdate, runUpdate, type UpdateInfo } from "../../updater";

export default function SettingsPanel() {
  const printers = useStore((s) => s.printers);
  const printer = useStore((s) => s.printer);
  const showPrintPreview = useStore((s) => s.showPrintPreview);
  const setPrinter = useStore((s) => s.setPrinter);
  const loadPrinters = useStore((s) => s.loadPrinters);
  const setShowPrintPreview = useStore((s) => s.setShowPrintPreview);
  const openTour = useStore((s) => s.openTour);
  const license = useStore((s) => s.license);
  const openActivation = useStore((s) => s.openActivation);
  const showToast = useStore((s) => s.showToast);

  const [code, setCode] = useState("");
  useEffect(() => {
    getStoredActivationCode().then(setCode);
  }, [license]);

  const version = APP_VERSION;
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [updating, setUpdating] = useState(false);

  const onCheckUpdate = async () => {
    setChecking(true);
    try {
      const info = await checkUpdate();
      setUpdate(info);
      showToast(
        info.available
          ? `Nova versão ${info.version} disponível.`
          : "Você já está na versão mais recente.",
        info.available ? "info" : "success"
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setChecking(false);
    }
  };

  const onRunUpdate = async () => {
    if (!update?.available) return;
    setUpdating(true);
    try {
      showToast("Baixando atualização… o app vai reiniciar.", "info");
      await runUpdate(update.version, update.url);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
      setUpdating(false);
    }
  };

  const licensed = license?.state === "licensed";
  const planLabel = !licensed
    ? "—"
    : license?.plan === "subscription"
      ? "Assinatura"
      : license?.plan && license.plan !== "lifetime"
        ? license.plan.charAt(0).toUpperCase() + license.plan.slice(1)
        : "Vitalícia";
  const statusLabel =
    license?.state === "licensed"
      ? "Ativa"
      : license?.state === "trial"
        ? `Teste · ${license.trialDaysLeft} dia(s)`
        : license?.state === "expired"
          ? "Expirada"
          : "—";
  const expiryLabel = license?.expiresAt
    ? new Date(license.expiresAt * 1000).toLocaleDateString("pt-BR")
    : null;

  const copyMachineId = async () => {
    if (!license?.machineId) return;
    try {
      await navigator.clipboard.writeText(license.machineId);
      showToast("ID do computador copiado.", "success");
    } catch {
      showToast("Não foi possível copiar.", "error");
    }
  };

  return (
    <section className="settings-page">
      <div className="settings-shell">
        <div className="settings-heading">
          <h1>Settings</h1>
        </div>

        <div className="settings-grid">
          <article className="settings-card">
            <h3>Licença</h3>
            <div className="license-row">
              <span className="muted">Situação</span>
              <span className={`license-badge license-${license?.state ?? "none"}`}>{statusLabel}</span>
            </div>
            <div className="license-row">
              <span className="muted">Plano</span>
              <span>{planLabel}</span>
            </div>
            {expiryLabel && (
              <div className="license-row">
                <span className="muted">Válida até</span>
                <span>{expiryLabel}</span>
              </div>
            )}
            {licensed && code && (
              <div className="license-row">
                <span className="muted">Código</span>
                <code className="license-code">{code}</code>
              </div>
            )}
            <div className="license-row">
              <span className="muted">ID do computador</span>
              <code className="license-code" title="Clique para copiar" onClick={copyMachineId}>
                {license?.machineId ?? "—"}
              </code>
            </div>
            <button className="btn mt8" onClick={openActivation}>
              {licensed ? "Inserir outro código" : "Ativar / inserir código"}
            </button>
            {license?.plan === "subscription" && (
              <p className="muted">
                Para alterar ou cancelar a assinatura, acesse sua conta no Mercado Pago.
              </p>
            )}
          </article>

          <article className="settings-card">
            <h3>Atualizações</h3>
            <div className="license-row">
              <span className="muted">Versão atual</span>
              <span>{version || "—"}</span>
            </div>
            {update?.available && (
              <div className="license-row">
                <span className="muted">Nova versão</span>
                <span>{update.version}</span>
              </div>
            )}
            {update?.available ? (
              <button className="btn btn-primary mt8" disabled={updating} onClick={onRunUpdate}>
                {updating ? "Atualizando…" : `Baixar e instalar ${update.version}`}
              </button>
            ) : (
              <button className="btn mt8" disabled={checking} onClick={onCheckUpdate}>
                {checking ? "Verificando…" : "Verificar atualização"}
              </button>
            )}
          </article>

          <article className="settings-card">
            <h3>Impressao</h3>
            <label className="setting-switch">
              <span className="setting-switch-copy">
                <span className="setting-switch-title">Mostrar preview da impressao</span>
                <span className="muted">
                  {showPrintPreview ? "Ligado: abre o preview antes de imprimir." : "Desligado: imprime direto."}
                </span>
              </span>
              <input
                type="checkbox"
                checked={showPrintPreview}
                onChange={(e) => setShowPrintPreview(e.target.checked)}
              />
              <span className="switch-track" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
            </label>
          </article>

          <article className="settings-card">
            <h3>Impressora</h3>
            <div className="printer-row">
              <select
                className="field-control"
                value={printer}
                onChange={(e) => setPrinter(e.target.value)}
              >
                <option value="">Padrao do sistema</option>
                {printer && !printers.includes(printer) && (
                  <option value={printer}>{printer} (salva)</option>
                )}
                {printers.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <button className="icon-btn" title="Atualizar lista" onClick={() => loadPrinters()}>
                &#10227;
              </button>
            </div>
            {printers.length === 0 && (
              <p className="muted">Nenhuma impressora detectada. Clique em atualizar.</p>
            )}
          </article>

          <article className="settings-card">
            <h3>Ajuda</h3>
            <p className="muted" style={{ margin: "0 0 10px" }}>
              Reveja a apresentação das áreas do app.
            </p>
            <button className="btn" onClick={openTour}>
              Rever tour
            </button>
          </article>

          <article className="settings-card about-card">
            <h3>Sobre</h3>
            <p className="muted about-dev-by">Desenvolvido por:</p>
            <p className="about-name">Rafael Negrão de Souza</p>
            <p className="muted">Engenheiro de Produção</p>
            <a className="about-email" href="mailto:rafael.negrao.souza@gmail.com">
              rafael.negrao.souza@gmail.com
            </a>
          </article>
        </div>
      </div>
    </section>
  );
}
