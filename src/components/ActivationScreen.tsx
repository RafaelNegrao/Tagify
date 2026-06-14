import { useState } from "react";
import { activateLicense, applyPass, type LicenseStatus } from "../license";
import { ACTIVATION_INFO } from "../activationInfo";
import { useStore } from "../store/useStore";

export default function ActivationScreen({
  machineId,
  trialDaysLeft,
  expired,
  onActivated,
  onClose,
}: {
  machineId: string;
  trialDaysLeft: number;
  expired: boolean;
  onActivated: (status: LicenseStatus) => void;
  onClose?: () => void;
}) {
  const showToast = useStore((s) => s.showToast);
  const [key, setKey] = useState("");
  const [activating, setActivating] = useState(false);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} copiado.`, "success");
    } catch {
      showToast("Não foi possível copiar.", "error");
    }
  };

  const mailtoHref = () => {
    const subject = "Solicitação de chave de ativação - Tagify";
    const body =
      `Olá! Quero ativar o Tagify.\n\n` +
      `ID do computador: ${machineId}\n\n` +
      `(Anexe o comprovante do Pix.)`;
    return `mailto:${ACTIVATION_INFO.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  };

  const onActivate = async () => {
    const value = key.trim();
    if (!value) return;
    setActivating(true);
    try {
      // A pass (timed/lifetime token) contains a "."; a legacy key is plain base64.
      const status = value.includes(".") ? await applyPass(value) : await activateLicense(value);
      showToast("Licença ativada. Obrigado!", "success");
      onActivated(status);
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setActivating(false);
    }
  };

  return (
    <div className="activation-screen">
      <div className="activation-card">
        <h1 className="activation-title">Ativar o Tagify</h1>
        <p className="activation-sub">
          {expired
            ? "Seu período de teste terminou. Ative com sua chave de licença para continuar usando."
            : `Período de teste: ${trialDaysLeft} dia(s) restante(s). Ative quando quiser.`}
        </p>

        <label className="field-label">ID deste computador</label>
        <div className="activation-machine">
          <code className="activation-machine-id">{machineId}</code>
          <button className="btn" onClick={() => copy(machineId, "ID")}>Copiar</button>
        </div>

        <div className="activation-buy">
          <div className="activation-buy-head">
            <span>Como comprar</span>
          </div>
          <p className="muted">1. Pague via Pix:</p>
          <div className="activation-machine">
            <code className="activation-machine-id">{ACTIVATION_INFO.pixKey}</code>
            <button className="btn" onClick={() => copy(ACTIVATION_INFO.pixKey, "Pix")}>Copiar Pix</button>
          </div>
          <p className="muted">Em nome de {ACTIVATION_INFO.pixName}.</p>
          <p className="muted">
            2. Envie um e-mail para{" "}
            <a href={mailtoHref()}>{ACTIVATION_INFO.email}</a> com o <b>ID do computador</b> acima e o
            comprovante. Você receberá a chave de ativação.
          </p>
        </div>

        <label className="field-label mt8">Chave de licença</label>
        <textarea
          className="field-control activation-key"
          rows={3}
          placeholder="Cole aqui a chave recebida"
          value={key}
          onChange={(e) => setKey(e.target.value)}
        />

        <div className="activation-actions">
          <button className="btn btn-primary" disabled={!key.trim() || activating} onClick={onActivate}>
            {activating ? "Ativando…" : "Ativar"}
          </button>
          {!expired && onClose && (
            <button className="btn" onClick={onClose}>
              Continuar no teste
            </button>
          )}
        </div>

        <p className="muted activation-contact">Suporte: {ACTIVATION_INFO.email}</p>
      </div>
    </div>
  );
}
