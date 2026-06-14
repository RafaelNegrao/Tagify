import { useStore } from "../store/useStore";

/** Dropdown to pick the system printer. The choice is persisted across restarts. */
export default function PrinterSelector() {
  const printers = useStore((s) => s.printers);
  const printer = useStore((s) => s.printer);
  const setPrinter = useStore((s) => s.setPrinter);
  const loadPrinters = useStore((s) => s.loadPrinters);

  return (
    <div>
      <label className="field-label">Impressora</label>
      <div className="printer-row">
        <select
          className="field-control"
          value={printer}
          onChange={(e) => setPrinter(e.target.value)}
        >
          <option value="">Padrão do sistema</option>
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
          ⟳
        </button>
      </div>
      {printers.length === 0 && (
        <p className="muted">Nenhuma impressora detectada. Clique em ⟳ para atualizar.</p>
      )}
    </div>
  );
}
