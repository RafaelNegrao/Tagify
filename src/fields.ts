export const MANUFACTURE_DATE_FIELD = "data_fabricacao";
export const EXPIRATION_DATE_FIELD = "data_validade";
export const STORE_FIELD = "loja";
export const PRODUCT_FIELD = "produto";
export const PRODUCT_FIELD_PREVIEW = "PEIXE";
/** Reserved keys carrying the selected product's code values into a label instance. */
export const PRODUCT_BARCODE_FIELD = "__codigo_barras_produto__";
export const PRODUCT_QRCODE_FIELD = "__qrcode_produto__";

export const SPECIAL_FIELD_OPTIONS = [
  { key: MANUFACTURE_DATE_FIELD, label: "Data fabrica\u00e7\u00e3o" },
  { key: EXPIRATION_DATE_FIELD, label: "Data validade" },
  { key: STORE_FIELD, label: "Loja" },
] as const;

export type SpecialFieldKey = (typeof SPECIAL_FIELD_OPTIONS)[number]["key"];

const SPECIAL_FIELD_LABELS = new Map<string, string>(
  SPECIAL_FIELD_OPTIONS.map((field) => [field.key, field.label])
);

export function getFieldLabel(key: string): string {
  if (key === PRODUCT_FIELD) return "Peixe";
  return SPECIAL_FIELD_LABELS.get(key) ?? key;
}

export function getFieldPreviewText(key: string): string {
  if (key === PRODUCT_FIELD) return PRODUCT_FIELD_PREVIEW;
  return isDateFieldKey(key) ? "dd/mm/aaaa" : getFieldLabel(key);
}

export function isDateFieldKey(key: string | undefined): key is SpecialFieldKey {
  return key === MANUFACTURE_DATE_FIELD || key === EXPIRATION_DATE_FIELD;
}

export function isProductFieldKey(key: string | undefined): key is typeof PRODUCT_FIELD {
  return key === PRODUCT_FIELD;
}

export function formatDateForLabel(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function applyDateConstraint(
  values: Record<string, string>,
  key: string,
  value: string
): Record<string, string> {
  const next = { ...values, [key]: value };
  const manufacture = next[MANUFACTURE_DATE_FIELD];
  const expiration = next[EXPIRATION_DATE_FIELD];

  if (manufacture && expiration && expiration < manufacture) {
    next[EXPIRATION_DATE_FIELD] = manufacture;
  }

  return next;
}
