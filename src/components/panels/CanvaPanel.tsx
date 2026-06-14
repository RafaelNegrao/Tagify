import { useState } from "react";
import { useStore } from "../../store/useStore";
import SizeSelector from "../SizeSelector";
import { collectFields } from "../../render";
import type { CodeElement, LineElement, RectElement, TextElement } from "../../types";
import {
  PRODUCT_FIELD,
  SPECIAL_FIELD_OPTIONS,
  getFieldLabel,
  getFieldPreviewText,
  isDateFieldKey,
  isProductFieldKey,
} from "../../fields";

export default function CanvaPanel() {
  const editor = useStore((s) => s.editor);
  const templates = useStore((s) => s.templates);
  const selectedIds = useStore((s) => s.selectedIds);
  const removeSelected = useStore((s) => s.removeSelected);

  const newTemplate = useStore((s) => s.newTemplate);
  const editTemplate = useStore((s) => s.editTemplate);
  const clearEditor = useStore((s) => s.clearEditor);
  const removeTemplate = useStore((s) => s.removeTemplate);
  const setEditorName = useStore((s) => s.setEditorName);
  const setEditorSize = useStore((s) => s.setEditorSize);
  const setEditorProductField = useStore((s) => s.setEditorProductField);
  const addText = useStore((s) => s.addText);
  const addFieldText = useStore((s) => s.addFieldText);
  const addImage = useStore((s) => s.addImage);
  const addRect = useStore((s) => s.addRect);
  const addCode = useStore((s) => s.addCode);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const updateElement = useStore((s) => s.updateElement);
  const updateElements = useStore((s) => s.updateElements);
  const reorderElement = useStore((s) => s.reorderElement);
  const removeElement = useStore((s) => s.removeElement);
  const setSharedValue = useStore((s) => s.setSharedValue);
  const saveEditor = useStore((s) => s.saveEditor);
  const showToast = useStore((s) => s.showToast);

  const [newW, setNewW] = useState(100);
  const [newH, setNewH] = useState(150);
  const [saving, setSaving] = useState(false);

  const onSave = async () => {
    setSaving(true);
    try {
      await saveEditor();
      showToast("Template salvo.", "success");
    } catch (err) {
      showToast(`Erro ao salvar: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setSaving(false);
    }
  };

  if (!editor) {
    return (
      <div className="panel">
        <div className="panel-section">
          <h3>Novo template</h3>
          <label className="field-label">Tamanho</label>
          <SizeSelector width_mm={newW} height_mm={newH} onChange={(w, h) => { setNewW(w); setNewH(h); }} />
          <button className="btn btn-primary mt8" onClick={() => newTemplate(newW, newH)}>
            + Criar etiqueta
          </button>
        </div>

        <div className="panel-section">
          <h3>Templates salvos</h3>
          {templates.length === 0 && <p className="muted">Nenhum template ainda.</p>}
          {templates.map((t) => (
            <div key={t.id} className="list-row">
              <button className="link" onClick={() => editTemplate(t.id)}>
                {t.name || "(sem nome)"} · {t.width_mm}×{t.height_mm}
              </button>
              <button className="icon-btn" title="Excluir" onClick={() => removeTemplate(t.id)}>
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const selected =
    selectedIds.length === 1 ? editor.design.find((e) => e.id === selectedIds[0]) : undefined;
  const selectedTextEls = editor.design.filter(
    (e): e is TextElement => e.type === "text" && selectedIds.includes(e.id)
  );
  const fields = collectFields(editor.design);

  const onPickImage = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const maxW = 30; // mm
        const ratio = img.height / img.width;
        addImage(src, maxW, +(maxW * ratio).toFixed(1));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const addProductValueField = () => {
    addFieldText(PRODUCT_FIELD, getFieldPreviewText(PRODUCT_FIELD));
    setEditorProductField(PRODUCT_FIELD);
  };

  return (
    <div className="panel canva-panel">
      <div className="panel-section">
        <label className="field-label">Nome do template</label>
        <input
          className="field-control"
          value={editor.name}
          placeholder="Ex.: Peixaria padrão"
          onChange={(e) => setEditorName(e.target.value)}
        />
        <label className="field-label mt8">Tamanho</label>
        <SizeSelector width_mm={editor.width_mm} height_mm={editor.height_mm} onChange={setEditorSize} />
      </div>

      <div className="panel-section">
        <h3>Adicionar</h3>

        <label className="field-label">Elementos</label>
        <div className="add-grid">
          <button className="btn" onClick={addText}>+ Texto</button>
          <button
            className={`btn ${tool === "line" ? "active" : ""}`}
            onClick={() => setTool(tool === "line" ? "select" : "line")}
          >
            + Linha
          </button>
          <button className="btn" onClick={addRect}>+ Retângulo</button>
          <label className="btn">
            + Imagem
            <input
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => e.target.files?.[0] && onPickImage(e.target.files[0])}
            />
          </label>
        </div>
        {tool === "line" && (
          <p className="muted">Clique e arraste no canvas para traçar a linha (ponto A → B).</p>
        )}

        <label className="field-label mt8">Campos dinâmicos</label>
        <div className="add-grid">
          <button className="btn" onClick={addProductValueField}>+ Peixe</button>
          {SPECIAL_FIELD_OPTIONS.map((field) => (
            <button key={field.key} className="btn" onClick={() => addFieldText(field.key, getFieldPreviewText(field.key))}>
              + {field.label}
            </button>
          ))}
        </div>

        <label className="field-label mt8">Códigos</label>
        <div className="add-grid">
          <button className="btn" onClick={() => addCode("barcode")}>+ Cód. barras</button>
          <button className="btn" onClick={() => addCode("qrcode")}>+ QR Code</button>
        </div>
      </div>

      <div className="panel-section">
        <h3>Ferramentas</h3>
        <div className="add-grid">
          <button
            className={`btn ${tool === "measure" ? "active" : ""}`}
            onClick={() => setTool(tool === "measure" ? "select" : "measure")}
          >
            📏 Medir
          </button>
        </div>
        {tool === "measure" && (
          <p className="muted">Clique e arraste para medir a distância entre A e B (em mm).</p>
        )}
      </div>

      {selectedIds.length > 1 && (
        <div className="panel-section">
          <h3>Seleção</h3>
          <p className="muted">{selectedIds.length} elementos selecionados.</p>
          {selectedTextEls.length > 0 && (
            <MultiTextProps
              els={selectedTextEls}
              onChange={(p) => updateElements(selectedTextEls.map((e) => e.id), p)}
            />
          )}
          <button className="btn btn-danger mt8" onClick={removeSelected}>
            Remover selecionados
          </button>
        </div>
      )}

      {selected && (
        <div className="panel-section">
          <h3>Ordem</h3>
          <div className="add-grid">
            <button className="btn" title="Trazer para frente" onClick={() => reorderElement(selected.id, "front")}>⤒ Frente</button>
            <button className="btn" title="Avançar um nível" onClick={() => reorderElement(selected.id, "forward")}>↑ Avançar</button>
            <button className="btn" title="Recuar um nível" onClick={() => reorderElement(selected.id, "backward")}>↓ Recuar</button>
            <button className="btn" title="Enviar para trás" onClick={() => reorderElement(selected.id, "back")}>⤓ Trás</button>
          </div>
        </div>
      )}

      {selected && selected.type === "text" && (
        <TextProps el={selected} onChange={(p) => updateElement(selected.id, p)} onRemove={() => removeElement(selected.id)} />
      )}
      {selected && selected.type === "image" && (
        <div className="panel-section">
          <h3>Imagem</h3>
          <div className="grid2">
            <NumberField
              label="Largura (mm)"
              value={selected.width}
              onChange={(v) => {
                const width = Math.max(1, v);
                // Proportional lock: scale the other side by the same factor.
                updateElement(
                  selected.id,
                  selected.keepRatio && selected.width > 0
                    ? { width, height: width * (selected.height / selected.width) }
                    : { width }
                );
              }}
            />
            <NumberField
              label="Altura (mm)"
              value={selected.height}
              onChange={(v) => {
                const height = Math.max(1, v);
                updateElement(
                  selected.id,
                  selected.keepRatio && selected.height > 0
                    ? { height, width: height * (selected.width / selected.height) }
                    : { height }
                );
              }}
            />
          </div>
          <label className="check mt8">
            <input
              type="checkbox"
              checked={!!selected.keepRatio}
              onChange={(e) => updateElement(selected.id, { keepRatio: e.target.checked })}
            />
            Manter proporção
          </label>
          <button className="btn btn-danger mt8" onClick={() => removeElement(selected.id)}>Remover elemento</button>
        </div>
      )}
      {selected && selected.type === "line" && (
        <LineProps
          el={selected}
          onChange={(p) => updateElement(selected.id, p)}
          onRemove={() => removeElement(selected.id)}
        />
      )}
      {selected && selected.type === "rect" && (
        <RectProps
          el={selected}
          onChange={(p) => updateElement(selected.id, p)}
          onRemove={() => removeElement(selected.id)}
        />
      )}
      {selected && selected.type === "code" && (
        <CodeProps
          el={selected}
          onChange={(p) => updateElement(selected.id, p)}
          onRemove={() => removeElement(selected.id)}
        />
      )}

      {fields.shared.length > 0 && (
        <div className="panel-section">
          <h3>Campos compartilhados</h3>
          <p className="muted">Iguais para todas as etiquetas deste template.</p>
          {fields.shared.map((f) => (
            <div key={f.key}>
              <label className="field-label">{f.key}</label>
              <input
                className="field-control"
                value={editor.sharedValues[f.key] ?? ""}
                onChange={(e) => setSharedValue(f.key, e.target.value)}
              />
            </div>
          ))}
        </div>
      )}

      <div className="panel-section canva-save-section">
        <div className="panel-footer">
          <button
            className="btn btn-primary"
            disabled={!editor.name.trim() || saving}
            onClick={onSave}
          >
            {saving ? "Salvando…" : "Salvar template"}
          </button>
          <button className="btn" onClick={() => newTemplate(editor.width_mm, editor.height_mm)}>Novo</button>
          <button className="btn" onClick={clearEditor}>Limpar</button>
        </div>
        {!editor.name.trim() && <p className="muted">Dê um nome ao template para poder salvar.</p>}
      </div>
    </div>
  );
}

// Common fonts that ship with Windows, so the printed label matches the preview.
const FONT_FAMILIES = [
  "Arial",
  "Arial Black",
  "Verdana",
  "Tahoma",
  "Segoe UI",
  "Times New Roman",
  "Georgia",
  "Courier New",
  "Consolas",
  "Impact",
];

function FontFamilySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (fontFamily: string) => void;
}) {
  // Keep a legacy/unknown family visible instead of silently swapping it.
  const options = FONT_FAMILIES.includes(value) ? FONT_FAMILIES : [value, ...FONT_FAMILIES];
  return (
    <select
      className="field-control"
      value={value}
      style={{ fontFamily: value }}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((f) => (
        <option key={f} value={f} style={{ fontFamily: f }}>
          {f}
        </option>
      ))}
    </select>
  );
}

function TextProps({
  el,
  onChange,
  onRemove,
}: {
  el: TextElement;
  onChange: (p: Partial<TextElement>) => void;
  onRemove: () => void;
}) {
  const isField = !!el.fieldKey;
  const specialField = SPECIAL_FIELD_OPTIONS.find((field) => field.key === el.fieldKey);
  const isDateField = !!specialField && isDateFieldKey(specialField.key);
  const isProductField = isProductFieldKey(el.fieldKey);
  const lockedFieldKey = isDateField || isProductField ? el.fieldKey : undefined;
  const heading = isField ? getFieldLabel(el.fieldKey ?? "") : "Texto";
  const bold = el.fontStyle.includes("bold");
  const italic = el.fontStyle.includes("italic");
  const setStyle = (b: boolean, i: boolean) => {
    const parts = [b && "bold", i && "italic"].filter(Boolean);
    onChange({ fontStyle: parts.length ? parts.join(" ") : "normal" });
  };

  return (
    <div className="panel-section">
      <h3>{heading}</h3>
      {isField && <p className="muted">Campo dinâmico</p>}
      {isDateField ? null : lockedFieldKey ? (
        <>
          <label className="field-label">Preview</label>
          <input className="field-control" value={getFieldPreviewText(lockedFieldKey)} readOnly />
        </>
      ) : (
        <>
          <label className="field-label">Conteúdo {isField ? "(valor padrão)" : ""}</label>
          <textarea className="field-control" rows={2} value={el.text} onChange={(e) => onChange({ text: e.target.value })} />
        </>
      )}

      <label className="field-label mt8">Estilo de fonte</label>
      <FontFamilySelect value={el.fontFamily} onChange={(fontFamily) => onChange({ fontFamily })} />

      <div className="grid2 mt8">
        <NumberField label="Fonte (mm)" value={el.fontSize} step={0.5} onChange={(v) => onChange({ fontSize: v })} />
        <NumberField label="Largura (mm)" value={el.width} onChange={(v) => onChange({ width: v })} />
      </div>

      <label className="field-label mt8">Alinhar texto</label>
      <div className="btn-row text-align-row">
        <button className={`btn ${bold ? "active" : ""}`} onClick={() => setStyle(!bold, italic)}>B</button>
        <button className={`btn ${italic ? "active" : ""}`} onClick={() => setStyle(bold, !italic)}><i>I</i></button>
        {(["left", "center", "right"] as const).map((align) => (
          <button
            key={align}
            className={`btn align-btn ${el.align === align ? "active" : ""}`}
            title={align === "left" ? "Esquerda" : align === "center" ? "Centro" : "Direita"}
            aria-label={align === "left" ? "Alinhar a esquerda" : align === "center" ? "Centralizar" : "Alinhar a direita"}
            onClick={() => onChange({ align })}
          >
            <AlignIcon align={align} />
          </button>
        ))}
        <input type="color" className="color" value={el.fill} onChange={(e) => onChange({ fill: e.target.value })} />
      </div>

      <button className="btn btn-danger mt8" onClick={onRemove}>Remover elemento</button>
    </div>
  );
}

/** Bulk font/style editing applied to every selected text element at once. */
function MultiTextProps({
  els,
  onChange,
}: {
  els: TextElement[];
  onChange: (p: Partial<TextElement>) => void;
}) {
  const first = els[0];
  const allBold = els.every((e) => e.fontStyle.includes("bold"));
  const allItalic = els.every((e) => e.fontStyle.includes("italic"));
  const commonFontSize = first.fontSize;
  const commonAlign = els.every((e) => e.align === first.align) ? first.align : undefined;
  const commonFill = els.every((e) => e.fill === first.fill) ? first.fill : "#000000";

  const setStyle = (b: boolean, i: boolean) => {
    const parts = [b && "bold", i && "italic"].filter(Boolean);
    onChange({ fontStyle: parts.length ? parts.join(" ") : "normal" });
  };

  const commonFamily = els.every((e) => e.fontFamily === first.fontFamily)
    ? first.fontFamily
    : "Arial";

  return (
    <div className="panel-subsection mt8">
      <p className="muted">{els.length} textos — alterações aplicam-se a todos.</p>
      <label className="field-label">Estilo de fonte</label>
      <FontFamilySelect value={commonFamily} onChange={(fontFamily) => onChange({ fontFamily })} />
      <NumberField
        label="Fonte (mm)"
        value={commonFontSize}
        step={0.5}
        onChange={(v) => onChange({ fontSize: v })}
      />
      <label className="field-label mt8">Estilo</label>
      <div className="btn-row text-align-row">
        <button className={`btn ${allBold ? "active" : ""}`} onClick={() => setStyle(!allBold, allItalic)}>B</button>
        <button className={`btn ${allItalic ? "active" : ""}`} onClick={() => setStyle(allBold, !allItalic)}><i>I</i></button>
        {(["left", "center", "right"] as const).map((align) => (
          <button
            key={align}
            className={`btn align-btn ${commonAlign === align ? "active" : ""}`}
            title={align === "left" ? "Esquerda" : align === "center" ? "Centro" : "Direita"}
            aria-label={align === "left" ? "Alinhar a esquerda" : align === "center" ? "Centralizar" : "Alinhar a direita"}
            onClick={() => onChange({ align })}
          >
            <AlignIcon align={align} />
          </button>
        ))}
        <input type="color" className="color" value={commonFill} onChange={(e) => onChange({ fill: e.target.value })} />
      </div>
    </div>
  );
}

function AlignIcon({ align }: { align: TextElement["align"] }) {
  const middle =
    align === "left" ? [3, 9, 12, 9] : align === "center" ? [5, 9, 13, 9] : [6, 9, 15, 9];

  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        d={`M3 5H15M${middle[0]} ${middle[1]}H${middle[2]}M3 13H15`}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

const THICKNESS_PRESETS = [0.25, 0.5, 1, 1.5, 2, 3];

function LineProps({
  el,
  onChange,
  onRemove,
}: {
  el: LineElement;
  onChange: (p: Partial<LineElement>) => void;
  onRemove: () => void;
}) {
  const length = Math.hypot(el.x2 - el.x, el.y2 - el.y);
  return (
    <div className="panel-section">
      <h3>Linha</h3>

      <label className="field-label">Grossura (mm)</label>
      <div className="btn-row">
        {THICKNESS_PRESETS.map((t) => (
          <button
            key={t}
            className={`btn ${Math.abs(el.thickness - t) < 1e-6 ? "active" : ""}`}
            onClick={() => onChange({ thickness: t })}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="mt8">
        <NumberField
          label="Valor personalizado (mm)"
          value={el.thickness}
          step={0.1}
          onChange={(v) => onChange({ thickness: Math.max(0.1, v) })}
        />
      </div>

      <div className="grid2 mt8">
        <div>
          <label className="field-label">Comprimento (mm)</label>
          <input className="field-control" value={length.toFixed(1)} readOnly />
        </div>
        <div>
          <label className="field-label">Cor</label>
          <input
            type="color"
            className="color"
            value={el.fill}
            onChange={(e) => onChange({ fill: e.target.value })}
          />
        </div>
      </div>

      <button className="btn btn-danger mt8" onClick={onRemove}>Remover elemento</button>
    </div>
  );
}

function RectProps({
  el,
  onChange,
  onRemove,
}: {
  el: RectElement;
  onChange: (p: Partial<RectElement>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="panel-section">
      <h3>Retângulo</h3>

      <div className="grid2">
        <NumberField label="Largura (mm)" value={el.width} onChange={(v) => onChange({ width: Math.max(1, v) })} />
        <NumberField label="Altura (mm)" value={el.height} onChange={(v) => onChange({ height: Math.max(1, v) })} />
      </div>

      <label className="field-label mt8">Grossura da borda (mm)</label>
      <div className="btn-row">
        {THICKNESS_PRESETS.map((t) => (
          <button
            key={t}
            className={`btn ${Math.abs(el.thickness - t) < 1e-6 ? "active" : ""}`}
            onClick={() => onChange({ thickness: t })}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="grid2 mt8">
        <NumberField
          label="Cantos (mm)"
          value={el.cornerRadius}
          step={0.5}
          onChange={(v) => onChange({ cornerRadius: Math.max(0, v) })}
        />
        <div>
          <label className="field-label">Cor da borda</label>
          <input
            type="color"
            className="color"
            value={el.stroke}
            onChange={(e) => onChange({ stroke: e.target.value })}
          />
        </div>
      </div>

      <button className="btn btn-danger mt8" onClick={onRemove}>Remover elemento</button>
    </div>
  );
}

function CodeProps({
  el,
  onChange,
  onRemove,
}: {
  el: CodeElement;
  onChange: (p: Partial<CodeElement>) => void;
  onRemove: () => void;
}) {
  const isBarcode = el.kind === "barcode";
  return (
    <div className="panel-section">
      <h3>{isBarcode ? "Código de barras" : "QR Code"}</h3>
      <p className="muted">
        Puxa automaticamente o {isBarcode ? "código de barras" : "QR Code"} do produto escolhido
        (cadastrado na aba Lista de Produtos).
      </p>

      {isBarcode && (
        <>
          <label className="field-label mt8">Tipo</label>
          <select
            className="field-control"
            value={el.symbology}
            onChange={(e) => onChange({ symbology: e.target.value as CodeElement["symbology"] })}
          >
            <option value="CODE128">CODE128 (texto/números)</option>
            <option value="EAN13">EAN-13 (13 dígitos)</option>
          </select>
        </>
      )}

      <div className="grid2 mt8">
        <NumberField
          label="Largura (mm)"
          value={el.width}
          onChange={(v) => {
            const width = Math.max(4, v);
            // Proportional lock: scale the other side by the same factor.
            onChange(
              el.keepRatio && el.width > 0
                ? { width, height: width * (el.height / el.width) }
                : { width }
            );
          }}
        />
        <NumberField
          label="Altura (mm)"
          value={el.height}
          onChange={(v) => {
            const height = Math.max(4, v);
            onChange(
              el.keepRatio && el.height > 0
                ? { height, width: height * (el.width / el.height) }
                : { height }
            );
          }}
        />
      </div>
      <label className="check mt8">
        <input
          type="checkbox"
          checked={!!el.keepRatio}
          onChange={(e) => onChange({ keepRatio: e.target.checked })}
        />
        Manter proporção
      </label>

      <button className="btn btn-danger mt8" onClick={onRemove}>Remover elemento</button>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  step = 1,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <input
        className="field-control"
        type="number"
        step={step}
        // Cap at 2 decimals: canvas drags (and older saved templates) carry long floats.
        value={Number(value.toFixed(2))}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
