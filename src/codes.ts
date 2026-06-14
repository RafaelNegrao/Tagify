import JsBarcode from "jsbarcode";
import QRCode from "qrcode";
import type { CodeElement, LabelInstance } from "./types";
import { PRODUCT_BARCODE_FIELD, PRODUCT_QRCODE_FIELD } from "./fields";

/**
 * Value a code element encodes. It always pulls from the selected product:
 * a barcode uses the product's barcode, a QR uses the product's qrcode.
 * In the editor (no product context) it shows a sample so the element is visible.
 */
export function resolveCodeValue(el: CodeElement, label?: LabelInstance | null): string {
  const key = el.kind === "qrcode" ? PRODUCT_QRCODE_FIELD : PRODUCT_BARCODE_FIELD;
  if (label) return (label.values[key] ?? "").trim();
  return el.kind === "qrcode" ? "https://exemplo.com" : "0123456789";
}

/**
 * Render a barcode/QR value to a PNG data URL. Returns "" when the value is empty
 * or invalid for the chosen symbology (e.g. EAN-13 needs 12–13 digits).
 */
export async function renderCodeDataUrl(el: CodeElement, value: string): Promise<string> {
  if (!value) return "";
  try {
    if (el.kind === "qrcode") {
      return await QRCode.toDataURL(value, {
        margin: 1,
        width: 512,
        errorCorrectionLevel: "M",
      });
    }
    // Render at high resolution so the rasterized image is scaled DOWN to the label
    // element (crisp), never up (blurry) — especially the human-readable digits.
    const canvas = document.createElement("canvas");
    JsBarcode(canvas, value, {
      format: el.symbology,
      displayValue: true,
      margin: 10,
      width: 6,
      height: 240,
      fontSize: 48,
      textMargin: 6,
      font: "monospace",
    });
    return canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}
