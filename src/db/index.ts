import Database from "@tauri-apps/plugin-sql";
import { nanoid } from "nanoid";
import type { Client, LabelElement, LabelInstance, Product, Template } from "../types";

let dbPromise: Promise<Database> | null = null;

function getDb(): Promise<Database> {
  if (!dbPromise) {
    // Resolves to <appdata>/etiquetas.db (created/migrated by the Rust side).
    dbPromise = Database.load("sqlite:etiquetas.db");
  }
  return dbPromise;
}

interface TemplateRow {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  design: string;
  shared_values: string;
  product_field: string | null;
  created_at: string;
  updated_at: string;
}

interface ProductRow {
  id: string;
  name: string;
  barcode: string | null;
  qrcode: string | null;
  created_at: string;
  updated_at: string;
}

interface ClientRow {
  id: string;
  name: string;
  print_enabled: number;
  created_at: string;
  updated_at: string;
}

interface LabelRow {
  id: string;
  template_id: string;
  name: string;
  values: string;
  created_at: string;
  updated_at: string;
}

function rowToTemplate(r: TemplateRow): Template {
  return {
    id: r.id,
    name: r.name,
    width_mm: r.width_mm,
    height_mm: r.height_mm,
    design: safeParse<LabelElement[]>(r.design, []),
    sharedValues: safeParse<Record<string, string>>(r.shared_values, {}),
    productField: r.product_field ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToProduct(r: ProductRow): Product {
  return {
    id: r.id,
    name: r.name,
    barcode: r.barcode ?? undefined,
    qrcode: r.qrcode ?? undefined,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToClient(r: ClientRow): Client {
  return {
    id: r.id,
    name: r.name,
    printEnabled: r.print_enabled !== 0,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function rowToLabel(r: LabelRow): LabelInstance {
  return {
    id: r.id,
    template_id: r.template_id,
    name: r.name,
    values: safeParse<Record<string, string>>(r.values, {}),
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function safeParse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

async function ensureClientsTable(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      print_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(name)");
}

// ---- Templates ----

export async function listTemplates(): Promise<Template[]> {
  const db = await getDb();
  const rows = await db.select<TemplateRow[]>(
    "SELECT * FROM templates ORDER BY updated_at DESC"
  );
  return rows.map(rowToTemplate);
}

export async function saveTemplate(t: Template): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO templates (id, name, width_mm, height_mm, design, shared_values, product_field, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       width_mm = excluded.width_mm,
       height_mm = excluded.height_mm,
       design = excluded.design,
       shared_values = excluded.shared_values,
       product_field = excluded.product_field,
       updated_at = datetime('now')`,
    [
      t.id,
      t.name,
      t.width_mm,
      t.height_mm,
      JSON.stringify(t.design),
      JSON.stringify(t.sharedValues),
      t.productField ?? null,
    ]
  );
}

export async function deleteTemplate(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM labels WHERE template_id = $1", [id]);
  await db.execute("DELETE FROM templates WHERE id = $1", [id]);
}

// ---- Labels (instances) ----

export async function listLabels(templateId?: string): Promise<LabelInstance[]> {
  const db = await getDb();
  const rows = templateId
    ? await db.select<LabelRow[]>(
        "SELECT * FROM labels WHERE template_id = $1 ORDER BY name",
        [templateId]
      )
    : await db.select<LabelRow[]>("SELECT * FROM labels ORDER BY name");
  return rows.map(rowToLabel);
}

export async function saveLabel(l: LabelInstance): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO labels (id, template_id, name, "values", updated_at)
     VALUES ($1, $2, $3, $4, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       "values" = excluded."values",
       updated_at = datetime('now')`,
    [l.id, l.template_id, l.name, JSON.stringify(l.values)]
  );
}

export async function deleteLabel(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM labels WHERE id = $1", [id]);
}

// ---- Products (Lista Produtos) ----

export async function listProducts(): Promise<Product[]> {
  const db = await getDb();
  const rows = await db.select<ProductRow[]>("SELECT * FROM products ORDER BY name");
  return rows.map(rowToProduct);
}

export async function saveProduct(p: Product): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO products (id, name, barcode, qrcode, updated_at)
     VALUES ($1, $2, $3, $4, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       barcode = excluded.barcode,
       qrcode = excluded.qrcode,
       updated_at = datetime('now')`,
    [p.id, p.name, p.barcode ?? null, p.qrcode ?? null]
  );
}

export async function deleteProduct(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM products WHERE id = $1", [id]);
}

// ---- Clients / stores imported from spreadsheets ----

export async function listClients(): Promise<Client[]> {
  const db = await getDb();
  await ensureClientsTable(db);
  const rows = await db.select<ClientRow[]>("SELECT * FROM clients ORDER BY name");
  return rows.map(rowToClient);
}

export async function saveClient(c: Client): Promise<void> {
  const db = await getDb();
  await ensureClientsTable(db);
  await db.execute(
    `INSERT INTO clients (id, name, print_enabled, updated_at)
     VALUES ($1, $2, $3, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       print_enabled = excluded.print_enabled,
       updated_at = datetime('now')`,
    [c.id, c.name, c.printEnabled ? 1 : 0]
  );
}

export async function updateClientPrintEnabled(id: string, printEnabled: boolean): Promise<void> {
  const db = await getDb();
  await ensureClientsTable(db);
  await db.execute(
    "UPDATE clients SET print_enabled = $2, updated_at = datetime('now') WHERE id = $1",
    [id, printEnabled ? 1 : 0]
  );
}

// ---- Print history (timeline) ----

export interface PrintHistoryEntry {
  id: string;
  /** Local timestamp, "YYYY-MM-DD HH:MM:SS" — so day/month buckets match the user's clock. */
  printed_at: string;
  quantity: number;
}

interface PrintHistoryRow {
  id: string;
  printed_at: string;
  quantity: number;
}

async function ensurePrintHistoryTable(db: Database): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS print_history (
      id TEXT PRIMARY KEY,
      printed_at TEXT NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.execute("CREATE INDEX IF NOT EXISTS idx_print_history_date ON print_history(printed_at)");
}

/** Local "YYYY-MM-DD HH:MM:SS" for the current moment (SQLite's now() is UTC). */
function localTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

export async function recordPrint(quantity: number): Promise<void> {
  if (quantity <= 0) return;
  const db = await getDb();
  await ensurePrintHistoryTable(db);
  await db.execute(
    "INSERT INTO print_history (id, printed_at, quantity) VALUES ($1, $2, $3)",
    [nanoid(), localTimestamp(), Math.round(quantity)]
  );
}

export async function listPrintHistory(): Promise<PrintHistoryEntry[]> {
  const db = await getDb();
  await ensurePrintHistoryTable(db);
  const rows = await db.select<PrintHistoryRow[]>(
    "SELECT id, printed_at, quantity FROM print_history ORDER BY printed_at ASC"
  );
  return rows.map((r) => ({ id: r.id, printed_at: r.printed_at, quantity: r.quantity }));
}

export async function clearPrintHistory(): Promise<void> {
  const db = await getDb();
  await ensurePrintHistoryTable(db);
  await db.execute("DELETE FROM print_history");
}
