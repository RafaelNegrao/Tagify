import { read, utils } from "xlsx";

const STORE_COL = "F";
const PRODUCT_COL = "Y";
const WEIGHT_COL = "Z";
const VALUE_COL = "AA";
const HEADER_ROW = 1;
const DATA_START_ROW = 2;
const WEIGHT_PER_LABEL = 20;

const EXPECTED_HEADERS: Record<string, string> = {
  [STORE_COL]: "Nome do contato",
  [PRODUCT_COL]: "Descricao",
  [WEIGHT_COL]: "Quantidade",
  [VALUE_COL]: "Valor unitario",
};

export interface ImportedOrderRow {
  store: string;
  productName: string;
  weight: number;
  value: number;
  quantity: number;
}

export interface ImportPreview {
  rows: ImportedOrderRow[];
  skippedRows: number;
}

export async function parseOrderSpreadsheet(file: File): Promise<ImportPreview> {
  const data = await file.arrayBuffer();
  const workbook = read(data, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  if (!sheet || !sheet["!ref"]) {
    throw new Error("Planilha vazia ou invalida.");
  }

  validateHeaders(sheet);

  const range = utils.decode_range(sheet["!ref"]);
  const grouped = new Map<string, { store: string; productName: string; weight: number; value: number }>();
  let skippedRows = 0;

  for (let row = DATA_START_ROW; row <= range.e.r + 1; row += 1) {
    const store = cellText(sheet, STORE_COL, row);
    const productName = cellText(sheet, PRODUCT_COL, row);
    const weight = parseNumber(cellValue(sheet, WEIGHT_COL, row));
    const unitValue = parseNumber(cellValue(sheet, VALUE_COL, row));

    if (!store && !productName && weight === null && unitValue === null) continue;
    if (!store || !productName || weight === null || weight <= 0 || unitValue === null || unitValue < 0) {
      skippedRows += 1;
      continue;
    }

    const value = weight * unitValue;
    const key = `${normalizeKey(store)}\u0000${normalizeKey(productName)}`;
    const current = grouped.get(key);
    if (current) {
      current.weight += weight;
      current.value += value;
    } else {
      grouped.set(key, { store, productName, weight, value });
    }
  }

  const rows = [...grouped.values()].map((row) => ({
    ...row,
    quantity: Math.max(1, Math.ceil(row.weight / WEIGHT_PER_LABEL)),
  }));

  if (rows.length === 0) {
    throw new Error("Nenhum item valido foi encontrado na planilha.");
  }

  return { rows, skippedRows };
}

function validateHeaders(sheet: Record<string, any>) {
  const found: Record<string, string> = {
    [STORE_COL]: cellText(sheet, STORE_COL, HEADER_ROW),
    [PRODUCT_COL]: cellText(sheet, PRODUCT_COL, HEADER_ROW),
    [WEIGHT_COL]: cellText(sheet, WEIGHT_COL, HEADER_ROW),
    [VALUE_COL]: cellText(sheet, VALUE_COL, HEADER_ROW),
  };

  const invalid = Object.entries(EXPECTED_HEADERS).filter(
    ([col, expected]) => normalizeHeader(found[col]) !== normalizeHeader(expected)
  );
  if (invalid.length === 0) return;

  const detail = invalid
    .map(([col, expected]) => `${col}: esperado "${expected}", encontrado "${found[col] || "(vazio)"}"`)
    .join("; ");
  throw new Error(`Cabecalhos da planilha nao conferem. ${detail}`);
}

function cellValue(sheet: Record<string, any>, col: string, row: number): unknown {
  return sheet[`${col}${row}`]?.v;
}

function cellText(sheet: Record<string, any>, col: string, row: number): string {
  return String(cellValue(sheet, col, row) ?? "").trim().replace(/\s+/g, " ");
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const cleaned = raw.replace(/[^\d,.-]/g, "");
  const normalized =
    cleaned.includes(",") && cleaned.includes(".")
      ? cleaned.replace(/\./g, "").replace(",", ".")
      : cleaned.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeHeader(value: string): string {
  return normalizeKey(value);
}

export function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
