import type { LabelElement, LabelInstance, Product, Template, TextElement } from "./types";
import {
  formatDateForLabel,
  getFieldLabel,
  getFieldPreviewText,
  isDateFieldKey,
  PRODUCT_BARCODE_FIELD,
  PRODUCT_QRCODE_FIELD,
} from "./fields";

/**
 * Build a (transient) label instance for a product, filling the template's
 * associated productField with the product name. `extra` holds any other
 * individual-field values edited in the Individual tab.
 */
export function productToLabel(
  template: Template,
  product: Product | null,
  extra: Record<string, string> = {}
): LabelInstance {
  const values = { ...extra };
  const productCaption = product ? formatProductCaption(product.name) : "";
  if (template.productField && !isDateFieldKey(template.productField) && product) {
    values[template.productField] = productCaption;
  }
  if (product?.barcode) {
    values[PRODUCT_BARCODE_FIELD] = product.barcode;
  }
  if (product?.qrcode) {
    values[PRODUCT_QRCODE_FIELD] = product.qrcode;
  }
  return {
    id: `preview-${product?.id ?? "none"}`,
    template_id: template.id,
    name: productCaption,
    values,
  };
}

/**
 * Resolve the text a text-element should display for a given label context.
 * - static text (no fieldKey): always its own text
 * - shared field: value from template.sharedValues, falling back to element.text
 * - individual field: value from the label instance, falling back to element.text
 */
export function resolveText(
  el: TextElement,
  template: Pick<Template, "sharedValues">,
  label?: LabelInstance | null
): string {
  if (!el.fieldKey) return el.text;
  const value =
    el.scope === "shared" ? template.sharedValues[el.fieldKey] : label?.values[el.fieldKey];
  // Date fields never use el.text as fallback — they show the dd/mm/aaaa preview.
  if (isDateFieldKey(el.fieldKey)) {
    return value ? formatDateForLabel(value) : getFieldPreviewText(el.fieldKey);
  }
  return value ? formatFieldValue(el.fieldKey, value) : el.text;
}

function formatFieldValue(fieldKey: string, value: string): string {
  return isDateFieldKey(fieldKey) ? formatDateForLabel(value) : value;
}

function formatProductCaption(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
}

/** Collect the dynamic fields declared in a design, deduped by fieldKey. */
export function collectFields(design: LabelElement[]): {
  shared: { key: string; label: string }[];
  individual: { key: string; label: string }[];
} {
  const shared = new Map<string, string>();
  const individual = new Map<string, string>();
  for (const el of design) {
    if (el.type !== "text" || !el.fieldKey) continue;
    const target = el.scope === "shared" ? shared : individual;
    if (!target.has(el.fieldKey)) target.set(el.fieldKey, getFieldLabel(el.fieldKey));
  }
  return {
    shared: [...shared.entries()].map(([key, label]) => ({ key, label })),
    individual: [...individual.entries()].map(([key, label]) => ({ key, label })),
  };
}
