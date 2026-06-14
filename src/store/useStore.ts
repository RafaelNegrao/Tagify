import { create } from "zustand";
import { nanoid } from "nanoid";
import { invoke } from "@tauri-apps/api/core";
import type { Client, CodeKind, LabelElement, Product, Template, TextElement } from "../types";
import type { LicenseStatus } from "../license";
import { STORE_FIELD } from "../fields";
import { normalizeKey, type ImportedOrderRow } from "../orderImport";
import * as db from "../db";

export type Tab = "canva" | "produtos" | "lote" | "timeline" | "settings";

export interface LoteItem {
  rowId: string;
  templateId: string | null;
  productId: string | null;
  quantity: number;
  importWeight?: number;
  importValue?: number;
  values: Record<string, string>;
}

export type ToastType = "success" | "error" | "info";
export interface ToastMessage {
  id: number;
  type: ToastType;
  message: string;
}

interface State {
  // navigation
  tab: Tab;
  setTab: (t: Tab) => void;

  // ---- Toast notifications ----
  toast: ToastMessage | null;
  showToast: (message: string, type?: ToastType) => void;
  dismissToast: () => void;

  // ---- First-run guided tour ----
  tourOpen: boolean;
  openTour: () => void;
  closeTour: () => void;

  // ---- Licensing ----
  license: LicenseStatus | null;
  setLicense: (l: LicenseStatus | null) => void;
  activationOpen: boolean;
  openActivation: () => void;
  closeActivation: () => void;

  // data
  templates: Template[];
  products: Product[];
  clients: Client[];
  loadAll: () => Promise<void>;

  // ---- Print history (Timeline tab) ----
  printHistory: db.PrintHistoryEntry[];
  loadPrintHistory: () => Promise<void>;
  recordPrint: (quantity: number) => Promise<void>;
  /** Insert one print entry without reloading — used per item during a batch. */
  recordPrintItem: (quantity: number) => Promise<void>;
  clearPrintHistory: () => Promise<void>;

  // ---- Products (Lista Produtos tab) ----
  addProduct: (name: string) => Promise<void>;
  updateProduct: (id: string, name: string, barcode: string, qrcode: string) => Promise<void>;
  removeProduct: (id: string) => Promise<void>;
  setClientPrintEnabled: (id: string, printEnabled: boolean) => Promise<void>;

  // printer (persisted across app restarts)
  printers: string[];
  printer: string;
  loadPrinters: () => Promise<void>;
  setPrinter: (name: string) => void;
  showPrintPreview: boolean;
  setShowPrintPreview: (show: boolean) => void;

  // ---- Editor (Canva tab) ----
  editor: Template | null;
  selectedIds: string[];
  tool: "select" | "line" | "measure";
  setTool: (t: "select" | "line" | "measure") => void;
  newTemplate: (width_mm: number, height_mm: number) => void;
  editTemplate: (id: string) => void;
  clearEditor: () => void;
  setEditorName: (name: string) => void;
  setEditorSize: (width_mm: number, height_mm: number) => void;
  setEditorProductField: (fieldKey: string | undefined) => void;
  addText: () => void;
  addFieldText: (fieldKey: string, label: string) => void;
  addImage: (src: string, width_mm: number, height_mm: number) => void;
  addLine: (a: { x: number; y: number }, b: { x: number; y: number }) => void;
  addRect: () => void;
  addCode: (kind: CodeKind) => void;
  updateElement: (id: string, patch: Partial<LabelElement>) => void;
  updateElements: (ids: string[], patch: Partial<LabelElement>) => void;
  reorderElement: (id: string, mode: "front" | "back" | "forward" | "backward") => void;
  removeElement: (id: string) => void;
  removeSelected: () => void;
  select: (id: string | null) => void;
  toggleSelect: (id: string) => void;
  selectMany: (ids: string[]) => void;
  selectAll: () => void;
  /** Move every selected element by (dx, dy) mm; lines move both endpoints. */
  nudgeSelected: (dx: number, dy: number) => void;
  clipboard: LabelElement[];
  copySelected: () => void;
  pasteClipboard: () => void;
  duplicateSelected: () => void;
  setSharedValue: (fieldKey: string, value: string) => void;
  saveEditor: () => Promise<void>;
  removeTemplate: (id: string) => Promise<void>;

  // ---- Undo / redo (editor design history) ----
  past: Template[];
  future: Template[];
  undo: () => void;
  redo: () => void;

  // ---- Lote preview selection ----
  // The iterable items are products; a product fills the template's productField.
  selectedTemplateId: string | null;
  selectedProductId: string | null;
  setSelectedTemplate: (id: string | null) => void;
  setSelectedProduct: (id: string | null) => void;

  // lote
  selectedLoteRowId: string | null;
  setSelectedLoteRow: (rowId: string | null) => void;
  loteUseSharedDates: boolean;
  setLoteUseSharedDates: (useSharedDates: boolean) => void;
  loteSharedValues: Record<string, string>;
  setLoteSharedValues: (values: Record<string, string>) => void;
  lote: LoteItem[];
  importLoteRows: (
    rows: ImportedOrderRow[],
    templateId: string | null
  ) => Promise<{ importedRows: number; addedProducts: number; addedClients: number; skippedStores: number }>;
  addLoteRow: () => void;
  updateLoteRow: (rowId: string, patch: Partial<LoteItem>) => void;
  removeLoteRow: (rowId: string) => void;
  clearLote: () => void;
}

const HISTORY_LIMIT = 100;

/**
 * History fields to merge into any editor-mutating `set`: it snapshots the current
 * editor onto the undo stack and clears the redo stack. Spread `...pushPast(s)` into
 * the returned partial state of every action that changes the editor design.
 */
function pushPast(s: State): Pick<State, "past" | "future"> {
  return {
    past: s.editor ? [...s.past, s.editor].slice(-HISTORY_LIMIT) : s.past,
    future: [],
  };
}

/** Move an element within the design array (= its z-order / stacking). */
function reorderDesign(
  design: LabelElement[],
  id: string,
  mode: "front" | "back" | "forward" | "backward"
): LabelElement[] {
  const i = design.findIndex((e) => e.id === id);
  if (i < 0) return design;
  const arr = design.slice();
  const [el] = arr.splice(i, 1);
  const j =
    mode === "front"
      ? arr.length
      : mode === "back"
        ? 0
        : mode === "forward"
          ? Math.min(arr.length, i + 1)
          : Math.max(0, i - 1);
  arr.splice(j, 0, el);
  return arr;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Rounds every numeric field of a patch to 2 decimals — canvas drags produce long floats. */
function roundPatch<T extends Partial<LabelElement>>(patch: T): T {
  const out: Record<string, unknown> = { ...patch };
  for (const key of Object.keys(out)) {
    const value = out[key];
    if (typeof value === "number") out[key] = round2(value);
  }
  return out as T;
}

/** Deep-copies an element with a fresh id, shifted so the copy doesn't cover the original. */
function cloneWithOffset(el: LabelElement, offsetMm = 2): LabelElement {
  const copy = structuredClone(el);
  copy.id = nanoid();
  copy.x += offsetMm;
  copy.y += offsetMm;
  if (copy.type === "line") {
    copy.x2 += offsetMm;
    copy.y2 += offsetMm;
  }
  return copy;
}

function defaultTextElement(text = "Texto"): TextElement {
  return {
    id: nanoid(),
    type: "text",
    x: 4,
    y: 4,
    text,
    fontSize: 4,
    fontFamily: "Arial",
    fontStyle: "normal",
    align: "left",
    width: 30,
    fill: "#000000",
  };
}

export const useStore = create<State>((set, get) => ({
  tab: "lote",
  setTab: (t) => set({ tab: t }),

  toast: null,
  showToast: (message, type = "info") =>
    set({ toast: { id: Date.now() + Math.random(), type, message } }),
  dismissToast: () => set({ toast: null }),

  tourOpen: false,
  // Tour targets live on the Lote tab; switch there so every highlighted element exists.
  openTour: () => set({ tourOpen: true, tab: "lote" }),
  closeTour: () => set({ tourOpen: false }),

  license: null,
  setLicense: (l) => set({ license: l }),
  activationOpen: false,
  openActivation: () => set({ activationOpen: true }),
  closeActivation: () => set({ activationOpen: false }),

  templates: [],
  products: [],
  clients: [],
  loadAll: async () => {
    const [templates, products] = await Promise.all([db.listTemplates(), db.listProducts()]);
    let clients: Client[] = [];
    try {
      clients = await db.listClients();
    } catch (err) {
      console.error("Falha ao carregar clientes:", err);
    }
    set({ templates, products, clients });
  },

  printHistory: [],
  loadPrintHistory: async () => {
    try {
      set({ printHistory: await db.listPrintHistory() });
    } catch (err) {
      console.error("Falha ao carregar histórico de impressão:", err);
    }
  },
  recordPrint: async (quantity) => {
    try {
      await db.recordPrint(quantity);
      set({ printHistory: await db.listPrintHistory() });
    } catch (err) {
      console.error("Falha ao registrar impressão:", err);
    }
  },
  recordPrintItem: async (quantity) => {
    try {
      await db.recordPrint(quantity);
    } catch (err) {
      console.error("Falha ao registrar impressão do item:", err);
    }
  },
  clearPrintHistory: async () => {
    await db.clearPrintHistory();
    set({ printHistory: [] });
  },

  addProduct: async (name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    await db.saveProduct({ id: nanoid(), name: trimmed });
    await get().loadAll();
  },
  updateProduct: async (id, name, barcode, qrcode) => {
    await db.saveProduct({
      id,
      name: name.trim(),
      barcode: barcode.trim() || undefined,
      qrcode: qrcode.trim() || undefined,
    });
    await get().loadAll();
  },
  removeProduct: async (id) => {
    await db.deleteProduct(id);
    set((s) => ({
      selectedProductId: s.selectedProductId === id ? null : s.selectedProductId,
      lote: s.lote.map((r) => (r.productId === id ? { ...r, productId: null } : r)),
    }));
    await get().loadAll();
  },
  setClientPrintEnabled: async (id, printEnabled) => {
    set((s) => ({
      clients: s.clients.map((c) => (c.id === id ? { ...c, printEnabled } : c)),
    }));
    try {
      await db.updateClientPrintEnabled(id, printEnabled);
    } catch (err) {
      await get().loadAll();
      throw err;
    }
  },

  printers: [],
  printer: localStorage.getItem("selectedPrinter") ?? "",
  showPrintPreview: localStorage.getItem("showPrintPreview") === "true",
  loadPrinters: async () => {
    try {
      const printers = await invoke<string[]>("list_printers");
      set({ printers });
    } catch (err) {
      console.error("Falha ao listar impressoras:", err);
    }
  },
  setPrinter: (name) => {
    localStorage.setItem("selectedPrinter", name);
    set({ printer: name });
  },
  setShowPrintPreview: (show) => {
    localStorage.setItem("showPrintPreview", String(show));
    set({ showPrintPreview: show });
  },

  editor: null,
  selectedIds: [],
  tool: "select",
  past: [],
  future: [],
  setTool: (t) => set({ tool: t }),
  newTemplate: (width_mm, height_mm) =>
    set({
      editor: {
        id: nanoid(),
        name: "",
        width_mm,
        height_mm,
        design: [],
        sharedValues: {},
      },
      selectedIds: [],
      past: [],
      future: [],
    }),
  editTemplate: (id) => {
    const t = get().templates.find((x) => x.id === id);
    if (t) set({ editor: structuredClone(t), selectedIds: [], tab: "canva", past: [], future: [] });
  },
  clearEditor: () => set({ editor: null, selectedIds: [], tool: "select", past: [], future: [] }),
  setEditorName: (name) =>
    set((s) => (s.editor ? { editor: { ...s.editor, name }, ...pushPast(s) } : {})),
  setEditorSize: (width_mm, height_mm) =>
    set((s) => (s.editor ? { editor: { ...s.editor, width_mm, height_mm }, ...pushPast(s) } : {})),
  setEditorProductField: (fieldKey) =>
    set((s) => (s.editor ? { editor: { ...s.editor, productField: fieldKey }, ...pushPast(s) } : {})),

  addText: () =>
    set((s) => {
      if (!s.editor) return {};
      const el = defaultTextElement();
      return { editor: { ...s.editor, design: [...s.editor.design, el] }, selectedIds: [el.id], ...pushPast(s) };
    }),
  addFieldText: (fieldKey, label) =>
    set((s) => {
      if (!s.editor) return {};
      const el: TextElement = {
        ...defaultTextElement(label),
        fieldKey,
        scope: "individual",
      };
      return { editor: { ...s.editor, design: [...s.editor.design, el] }, selectedIds: [el.id], ...pushPast(s) };
    }),
  addImage: (src, width_mm, height_mm) =>
    set((s) => {
      if (!s.editor) return {};
      const el: LabelElement = {
        id: nanoid(),
        type: "image",
        x: 4,
        y: 4,
        src,
        width: width_mm,
        height: height_mm,
      };
      return { editor: { ...s.editor, design: [...s.editor.design, el] }, selectedIds: [el.id], ...pushPast(s) };
    }),
  addLine: (a, b) =>
    set((s) => {
      if (!s.editor) return {};
      const el: LabelElement = {
        id: nanoid(),
        type: "line",
        x: a.x,
        y: a.y,
        x2: b.x,
        y2: b.y,
        thickness: 0.5,
        fill: "#000000",
      };
      return {
        editor: { ...s.editor, design: [...s.editor.design, el] },
        selectedIds: [el.id],
        tool: "select",
        ...pushPast(s),
      };
    }),
  addRect: () =>
    set((s) => {
      if (!s.editor) return {};
      const el: LabelElement = {
        id: nanoid(),
        type: "rect",
        x: 4,
        y: 4,
        width: Math.min(30, s.editor.width_mm - 8),
        height: Math.min(20, s.editor.height_mm - 8),
        thickness: 0.5,
        stroke: "#000000",
        cornerRadius: 0,
      };
      return { editor: { ...s.editor, design: [...s.editor.design, el] }, selectedIds: [el.id], ...pushPast(s) };
    }),
  addCode: (kind) =>
    set((s) => {
      if (!s.editor) return {};
      const qr = kind === "qrcode";
      const el: LabelElement = {
        id: nanoid(),
        type: "code",
        kind,
        symbology: "CODE128",
        x: 4,
        y: 4,
        width: qr ? 20 : Math.min(40, s.editor.width_mm - 8),
        height: qr ? 20 : 15,
        // A QR code only scans reliably square, so it starts with the lock on.
        keepRatio: qr,
      };
      return { editor: { ...s.editor, design: [...s.editor.design, el] }, selectedIds: [el.id], ...pushPast(s) };
    }),
  updateElement: (id, patch) =>
    set((s) => {
      if (!s.editor) return {};
      const rounded = roundPatch(patch);
      const design = s.editor.design.map((e) =>
        e.id === id ? ({ ...e, ...rounded } as LabelElement) : e
      );
      return { editor: { ...s.editor, design }, ...pushPast(s) };
    }),
  updateElements: (ids, patch) =>
    set((s) => {
      if (!s.editor) return {};
      const idSet = new Set(ids);
      const rounded = roundPatch(patch);
      const design = s.editor.design.map((e) =>
        idSet.has(e.id) ? ({ ...e, ...rounded } as LabelElement) : e
      );
      return { editor: { ...s.editor, design }, ...pushPast(s) };
    }),
  reorderElement: (id, mode) =>
    set((s) =>
      s.editor
        ? { editor: { ...s.editor, design: reorderDesign(s.editor.design, id, mode) }, ...pushPast(s) }
        : {}
    ),
  removeElement: (id) =>
    set((s) => {
      if (!s.editor) return {};
      return {
        editor: { ...s.editor, design: s.editor.design.filter((e) => e.id !== id) },
        selectedIds: s.selectedIds.filter((x) => x !== id),
        ...pushPast(s),
      };
    }),
  removeSelected: () =>
    set((s) => {
      if (!s.editor || s.selectedIds.length === 0) return {};
      const ids = new Set(s.selectedIds);
      return {
        editor: { ...s.editor, design: s.editor.design.filter((e) => !ids.has(e.id)) },
        selectedIds: [],
        ...pushPast(s),
      };
    }),
  select: (id) => set({ selectedIds: id ? [id] : [] }),
  toggleSelect: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
  selectMany: (ids) => set({ selectedIds: ids }),
  selectAll: () => set((s) => ({ selectedIds: s.editor ? s.editor.design.map((e) => e.id) : [] })),
  nudgeSelected: (dx, dy) =>
    set((s) => {
      if (!s.editor || s.selectedIds.length === 0) return {};
      const sel = new Set(s.selectedIds);
      const design = s.editor.design.map((e) => {
        if (!sel.has(e.id)) return e;
        if (e.type === "line")
          return {
            ...e,
            x: round2(e.x + dx),
            y: round2(e.y + dy),
            x2: round2(e.x2 + dx),
            y2: round2(e.y2 + dy),
          };
        return { ...e, x: round2(e.x + dx), y: round2(e.y + dy) };
      });
      return { editor: { ...s.editor, design }, ...pushPast(s) };
    }),
  clipboard: [],
  copySelected: () =>
    set((s) => {
      if (!s.editor || s.selectedIds.length === 0) return {};
      const sel = new Set(s.selectedIds);
      return { clipboard: s.editor.design.filter((e) => sel.has(e.id)).map((e) => structuredClone(e)) };
    }),
  pasteClipboard: () =>
    set((s) => {
      if (!s.editor || s.clipboard.length === 0) return {};
      const clones = s.clipboard.map((e) => cloneWithOffset(e));
      return {
        editor: { ...s.editor, design: [...s.editor.design, ...clones] },
        selectedIds: clones.map((c) => c.id),
        ...pushPast(s),
      };
    }),
  duplicateSelected: () =>
    set((s) => {
      if (!s.editor || s.selectedIds.length === 0) return {};
      const sel = new Set(s.selectedIds);
      const clones = s.editor.design.filter((e) => sel.has(e.id)).map((e) => cloneWithOffset(e));
      if (clones.length === 0) return {};
      return {
        editor: { ...s.editor, design: [...s.editor.design, ...clones] },
        selectedIds: clones.map((c) => c.id),
        ...pushPast(s),
      };
    }),
  setSharedValue: (fieldKey, value) =>
    set((s) =>
      s.editor
        ? {
            editor: { ...s.editor, sharedValues: { ...s.editor.sharedValues, [fieldKey]: value } },
            ...pushPast(s),
          }
        : {}
    ),
  undo: () =>
    set((s) => {
      if (!s.editor || s.past.length === 0) return {};
      const prev = s.past[s.past.length - 1];
      return {
        editor: prev,
        past: s.past.slice(0, -1),
        future: [s.editor, ...s.future].slice(0, HISTORY_LIMIT),
        selectedIds: [],
      };
    }),
  redo: () =>
    set((s) => {
      if (!s.editor || s.future.length === 0) return {};
      const next = s.future[0];
      return {
        editor: next,
        past: [...s.past, s.editor].slice(-HISTORY_LIMIT),
        future: s.future.slice(1),
        selectedIds: [],
      };
    }),
  saveEditor: async () => {
    const e = get().editor;
    if (!e) return;
    await db.saveTemplate(e);
    await get().loadAll();
  },
  removeTemplate: async (id) => {
    await db.deleteTemplate(id);
    set((s) => ({ editor: s.editor?.id === id ? null : s.editor }));
    await get().loadAll();
  },

  selectedTemplateId: null,
  selectedProductId: null,
  setSelectedTemplate: (id) => set({ selectedTemplateId: id }),
  setSelectedProduct: (id) => set({ selectedProductId: id }),

  selectedLoteRowId: null,
  setSelectedLoteRow: (rowId) => set({ selectedLoteRowId: rowId }),
  loteUseSharedDates: true,
  setLoteUseSharedDates: (useSharedDates) => set({ loteUseSharedDates: useSharedDates }),
  loteSharedValues: {},
  setLoteSharedValues: (values) => set({ loteSharedValues: values }),
  lote: [],
  importLoteRows: async (rows, templateId) => {
    const productByName = new Map(get().products.map((p) => [normalizeKey(p.name), p]));
    const clientByName = new Map(get().clients.map((c) => [normalizeKey(c.name), c]));
    const newProducts: Product[] = [];
    const newClients: Client[] = [];

    for (const row of rows) {
      const key = normalizeKey(row.productName);
      if (productByName.has(key)) continue;
      const product: Product = { id: nanoid(), name: row.productName };
      productByName.set(key, product);
      newProducts.push(product);
    }

    for (const row of rows) {
      const key = normalizeKey(row.store);
      if (clientByName.has(key)) continue;
      const client: Client = { id: nanoid(), name: row.store, printEnabled: true };
      clientByName.set(key, client);
      newClients.push(client);
    }

    for (const product of newProducts) {
      await db.saveProduct(product);
    }
    for (const client of newClients) {
      await db.saveClient(client);
    }

    const products = newProducts.length > 0 ? await db.listProducts() : get().products;
    const clients = newClients.length > 0 ? await db.listClients() : get().clients;
    const printByStore = new Map(clients.map((c) => [normalizeKey(c.name), c.printEnabled]));
    const inactiveStores = new Set<string>();
    const printableRows = rows.filter((row) => {
      const enabled = printByStore.get(normalizeKey(row.store)) ?? true;
      if (!enabled) {
        inactiveStores.add(normalizeKey(row.store));
        return false;
      }
      return true;
    });
    const refreshedByName = new Map(products.map((p) => [normalizeKey(p.name), p]));
    const lote = printableRows.map((row): LoteItem => {
      const product = refreshedByName.get(normalizeKey(row.productName));
      return {
        rowId: nanoid(),
        templateId,
        productId: product?.id ?? null,
        quantity: row.quantity,
        importWeight: row.weight,
        importValue: row.value,
        values: { [STORE_FIELD]: row.store },
      };
    });

    set({
      products,
      clients,
      lote,
      selectedTemplateId: templateId,
      selectedLoteRowId: lote[0]?.rowId ?? null,
      selectedProductId: lote[0]?.productId ?? null,
    });

    return {
      importedRows: lote.length,
      addedProducts: newProducts.length,
      addedClients: newClients.length,
      skippedStores: inactiveStores.size,
    };
  },
  addLoteRow: () =>
    set((s) => {
      const row: LoteItem = {
        rowId: nanoid(),
        templateId: null,
        productId: null,
        quantity: 1,
        values: {},
      };
      return { lote: [...s.lote, row], selectedLoteRowId: row.rowId };
    }),
  updateLoteRow: (rowId, patch) =>
    set((s) => ({ lote: s.lote.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)) })),
  removeLoteRow: (rowId) =>
    set((s) => ({
      lote: s.lote.filter((r) => r.rowId !== rowId),
      selectedLoteRowId: s.selectedLoteRowId === rowId ? null : s.selectedLoteRowId,
    })),
  clearLote: () =>
    set({
      lote: [],
      selectedLoteRowId: null,
      selectedProductId: null,
      loteSharedValues: {},
    }),
}));
