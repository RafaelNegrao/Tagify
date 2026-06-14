import { useRef, useState } from "react";
import { useStore, type LoteItem } from "../../store/useStore";
import { printLabels, type PrintJobItem } from "../../print";
import { collectFields, productToLabel } from "../../render";
import PrinterSelector from "../PrinterSelector";
import { parseOrderSpreadsheet } from "../../orderImport";
import {
  EXPIRATION_DATE_FIELD,
  MANUFACTURE_DATE_FIELD,
  STORE_FIELD,
  applyDateConstraint,
  isDateFieldKey,
} from "../../fields";

export default function LotePanel() {
  const templates = useStore((s) => s.templates);
  const products = useStore((s) => s.products);
  const lote = useStore((s) => s.lote);
  const selectedTemplateId = useStore((s) => s.selectedTemplateId);
  const addLoteRow = useStore((s) => s.addLoteRow);
  const updateLoteRow = useStore((s) => s.updateLoteRow);
  const removeLoteRow = useStore((s) => s.removeLoteRow);
  const clearLote = useStore((s) => s.clearLote);
  const recordPrintItem = useStore((s) => s.recordPrintItem);
  const loadPrintHistory = useStore((s) => s.loadPrintHistory);
  const importLoteRows = useStore((s) => s.importLoteRows);
  const setSelectedTemplate = useStore((s) => s.setSelectedTemplate);
  const setSelectedProduct = useStore((s) => s.setSelectedProduct);
  const setSelectedLoteRow = useStore((s) => s.setSelectedLoteRow);
  const loteUseSharedDates = useStore((s) => s.loteUseSharedDates);
  const setLoteUseSharedDates = useStore((s) => s.setLoteUseSharedDates);
  const loteSharedValues = useStore((s) => s.loteSharedValues);
  const setLoteSharedValues = useStore((s) => s.setLoteSharedValues);
  const printer = useStore((s) => s.printer);
  const showPrintPreview = useStore((s) => s.showPrintPreview);

  const showToast = useStore((s) => s.showToast);
  const [printing, setPrinting] = useState(false);
  const [printProgress, setPrintProgress] = useState<{ done: number; total: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const template = templates.find((t) => t.id === selectedTemplateId) ?? null;
  const productField =
    template?.productField && !isDateFieldKey(template.productField)
      ? template.productField
      : undefined;
  const individualFields = template ? collectFields(template.design).individual : [];
  const rowFields = individualFields.filter((f) => f.key !== productField);
  // Fabricação always comes first, regardless of the order in the template design.
  const dateFields = rowFields
    .filter((f) => isDateFieldKey(f.key))
    .sort(
      (a, b) =>
        (a.key === MANUFACTURE_DATE_FIELD ? 0 : 1) - (b.key === MANUFACTURE_DATE_FIELD ? 0 : 1)
    );
  const rowInputFields = loteUseSharedDates
    ? rowFields.filter((f) => !isDateFieldKey(f.key))
    : rowFields;
  const loteHasStores = lote.some((row) => (row.values?.[STORE_FIELD] ?? "").trim());
  const visibleRowInputFields = rowInputFields.filter((f) => f.key !== STORE_FIELD);
  const loteGroups = groupLoteByStore(lote, loteHasStores);
  const hasStoreField = individualFields.some((f) => f.key === STORE_FIELD);

  const total = lote.reduce(
    (sum, r) => sum + (selectedTemplateId && r.productId ? Math.max(0, r.quantity) : 0),
    0
  );

  const preview = (rowId: string, productId: string | null) => {
    setSelectedLoteRow(rowId);
    setSelectedTemplate(selectedTemplateId);
    setSelectedProduct(productId);
  };

  const updateRowValue = (
    rowId: string,
    values: Record<string, string>,
    key: string,
    value: string
  ) => {
    updateLoteRow(rowId, {
      values: isDateFieldKey(key)
        ? applyDateConstraint(values, key, value)
        : { ...values, [key]: value },
    });
  };

  const updateSharedDateValue = (key: string, value: string) => {
    setLoteSharedValues(applyDateConstraint(loteSharedValues, key, value));
  };

  const onTemplateChange = (templateId: string | null) => {
    setSelectedTemplate(templateId);
    const firstRow = lote[0];
    if (firstRow) {
      setSelectedLoteRow(firstRow.rowId);
      setSelectedProduct(firstRow.productId);
    }
  };

  const onPrint = async () => {
    if (!template) return;

    const items: PrintJobItem[] = [];
    for (const row of lote) {
      if (!row.productId || row.quantity < 1) continue;
      const product = products.find((p) => p.id === row.productId);
      if (!product) continue;
      const values = loteUseSharedDates
        ? { ...(row.values ?? {}), ...loteSharedValues }
        : row.values ?? {};
      // Block printing when the label has date fields but none of them are filled.
      if (dateFields.length > 0 && dateFields.every((f) => !(values[f.key] ?? "").trim())) {
        showToast("Preencha a data de fabricação ou validade antes de imprimir.", "error");
        return;
      }
      items.push({
        template,
        label: productToLabel(template, product, values),
        quantity: row.quantity,
      });
    }

    if (items.length === 0) return;

    const totalUnits = items.reduce((sum, it) => sum + Math.max(1, it.quantity), 0);
    setPrinting(true);
    setPrintProgress({ done: 0, total: totalUnits });
    try {
      const message = await printLabels(
        items,
        { printer, showPreview: showPrintPreview, directPageOrder: "reverse" },
        (done, total) => setPrintProgress({ done, total }),
        // Record each item to the timeline as it's sent (preview mode never calls this,
        // so previews aren't counted). A mid-batch failure keeps what already printed.
        (copies) => recordPrintItem(copies)
      );
      showToast(message, "success");
    } catch (err) {
      showToast(`Erro ao imprimir: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setPrinting(false);
      setPrintProgress(null);
      // Refresh the timeline once, after all the per-item inserts.
      void loadPrintHistory();
    }
  };

  const onImportClick = () => {
    if (!template || !selectedTemplateId) {
      showToast("Selecione um template antes de importar a planilha.", "error");
      return;
    }
    importInputRef.current?.click();
  };

  const onImportFile = async (file: File | undefined) => {
    if (!file || !selectedTemplateId) return;
    setImporting(true);
    try {
      const preview = await parseOrderSpreadsheet(file);
      const result = await importLoteRows(preview.rows, selectedTemplateId);
      const added = result.addedProducts > 0 ? ` ${result.addedProducts} peixe(s) cadastrado(s).` : "";
      const addedClients = result.addedClients > 0 ? ` ${result.addedClients} cliente(s) cadastrado(s).` : "";
      const inactive =
        result.skippedStores > 0 ? ` ${result.skippedStores} loja(s) desativada(s) ignorada(s).` : "";
      const skipped = preview.skippedRows > 0 ? ` ${preview.skippedRows} linha(s) ignorada(s).` : "";
      const storeWarning = hasStoreField ? "" : " O template selecionado nao tem a variavel Loja.";
      showToast(
        `Importacao concluida: ${result.importedRows} item(ns).${added}${addedClients}${inactive}${skipped}${storeWarning}`,
        result.importedRows > 0 && hasStoreField ? "success" : "info"
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="panel lote-panel">
      <div className="panel-section lote-template-section">
        <h3>Configuração</h3>
        <label className="field-label">Template</label>
        <select
          className="field-control"
          value={selectedTemplateId ?? ""}
          onChange={(e) => onTemplateChange(e.target.value || null)}
        >
          <option value="">Selecione um template...</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name || "(sem nome)"}
            </option>
          ))}
        </select>
        <div className="mt8">
          <PrinterSelector />
        </div>
      </div>

      {dateFields.length > 0 && (
        <div className="panel-section lote-date-mode-section">
          <label className="setting-switch lote-date-switch">
            <span className="setting-switch-copy">
              <span className="setting-switch-title">Datas iguais</span>
            </span>
            <input
              type="checkbox"
              checked={loteUseSharedDates}
              onChange={(e) => setLoteUseSharedDates(e.target.checked)}
            />
            <span className="switch-track" aria-hidden="true">
              <span className="switch-thumb" />
            </span>
          </label>

          {loteUseSharedDates && (
            <div className="lote-shared-date-grid">
              {dateFields.map((f) => (
                <div key={f.key}>
                  <label className="field-label">{f.label}</label>
                  <input
                    className="field-control"
                    type="date"
                    min={
                      f.key === EXPIRATION_DATE_FIELD
                        ? loteSharedValues[MANUFACTURE_DATE_FIELD] || undefined
                        : undefined
                    }
                    value={loteSharedValues[f.key] ?? ""}
                    onChange={(e) => updateSharedDateValue(f.key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="panel-section lote-list">
        <div className="lote-list-toolbar">
          <h3>Lista de itens</h3>
          <button className="btn" disabled={importing} onClick={onImportClick}>
            {importing ? "Importando..." : "Importar planilha"}
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".xls,.xlsx,.csv"
            hidden
            onChange={(e) => {
              void onImportFile(e.target.files?.[0]);
              e.currentTarget.value = "";
            }}
          />
        </div>
        {lote.length === 0 && <p className="muted">Nenhum item no lote.</p>}

        {loteGroups.map((group) => (
          <div key={group.key} className="lote-store-group">
            {loteHasStores && (
              <div className="lote-store-header">
                <span>{group.store}</span>
                <span>{formatStoreSummary(group)}</span>
              </div>
            )}

            {group.rows.map(({ row, index }) => {
              const values = row.values ?? {};

              return (
                <div
                  key={row.rowId}
                  className="lote-row-card"
                  onFocusCapture={() => preview(row.rowId, row.productId)}
                  onClick={() => preview(row.rowId, row.productId)}
                >
                  <div className="lote-row">
                    <span className="lote-idx">{index + 1}</span>

                    <select
                      className="field-control lote-product"
                      value={row.productId ?? ""}
                      onChange={(e) => {
                        const id = e.target.value || null;
                        updateLoteRow(row.rowId, { productId: id });
                        preview(row.rowId, id);
                      }}
                    >
                      <option value="">Produto...</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>

                    {visibleRowInputFields.map((f) => (
                      <input
                        key={f.key}
                        className="field-control lote-date"
                        type={isDateFieldKey(f.key) ? "date" : "text"}
                        title={f.label}
                        aria-label={f.label}
                        min={f.key === EXPIRATION_DATE_FIELD ? values[MANUFACTURE_DATE_FIELD] || undefined : undefined}
                        value={values[f.key] ?? ""}
                        onChange={(e) => {
                          updateRowValue(row.rowId, values, f.key, e.target.value);
                          preview(row.rowId, row.productId);
                        }}
                      />
                    ))}

                    <input
                      className="field-control qty"
                      type="number"
                      min={1}
                      title="Quantidade"
                      aria-label="Quantidade"
                      value={row.quantity}
                      onChange={(e) => updateLoteRow(row.rowId, { quantity: Math.max(1, Number(e.target.value)) })}
                    />

                    <button className="icon-btn" title="Remover" onClick={() => removeLoteRow(row.rowId)}>
                      x
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}

        <button className="lote-add-row" title="Adicionar item" aria-label="Adicionar item" onClick={addLoteRow}>
          +
        </button>
      </div>

      <div className="panel-section lote-footer">
        <div className="lote-footer-row">
          <span className="total">Total: {total} etiqueta(s)</span>
          <button
            className="btn"
            disabled={printing || lote.length === 0}
            onClick={() => {
              clearLote();
              showToast("Lista do lote limpa.", "success");
            }}
          >
            Limpar tudo
          </button>
        </div>
        <button
          className="btn btn-primary lote-print-btn"
          disabled={printing || total === 0}
          onClick={onPrint}
        >
          {printing
            ? printProgress
              ? `Imprimindo... ${printProgress.done}/${printProgress.total}`
              : "Imprimindo..."
            : "Imprimir lote"}
        </button>

        {printProgress && (
          <div
            className="lote-progress"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={printProgress.total}
            aria-valuenow={printProgress.done}
          >
            <div
              className="lote-progress-fill"
              style={{
                width: `${printProgress.total ? (printProgress.done / printProgress.total) * 100 : 0}%`,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function groupLoteByStore(rows: LoteItem[], byStore: boolean) {
  if (!byStore) {
    return [
      {
        key: "all",
        store: "",
        weight: 0,
        value: 0,
        hasImportTotals: false,
        rows: rows.map((row, index) => ({ row, index })),
      },
    ];
  }

  const groups: {
    key: string;
    store: string;
    weight: number;
    value: number;
    hasImportTotals: boolean;
    rows: { row: LoteItem; index: number }[];
  }[] = [];
  const byKey = new Map<string, (typeof groups)[number]>();

  rows.forEach((row, index) => {
    const store = (row.values?.[STORE_FIELD] ?? "").trim() || "Sem loja";
    const key = store.toLocaleLowerCase("pt-BR");
    let group = byKey.get(key);
    if (!group) {
      group = { key, store, weight: 0, value: 0, hasImportTotals: false, rows: [] };
      groups.push(group);
      byKey.set(key, group);
    }
    if (row.importWeight !== undefined || row.importValue !== undefined) {
      group.hasImportTotals = true;
    }
    group.weight += row.importWeight ?? 0;
    group.value += row.importValue ?? 0;
    group.rows.push({ row, index });
  });

  return groups;
}

const weightFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 2,
});

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatStoreSummary(group: ReturnType<typeof groupLoteByStore>[number]) {
  const parts = [`${group.rows.length} item(ns)`];
  if (group.hasImportTotals) {
    parts.push(`${weightFormatter.format(group.weight)} kg`);
    parts.push(currencyFormatter.format(group.value));
  }
  return parts.join(" | ");
}
