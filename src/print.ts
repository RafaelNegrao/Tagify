import Konva from "konva";
import { invoke } from "@tauri-apps/api/core";
import { PRINT_DPI, MM_PER_INCH } from "./constants";
import { resolveText } from "./render";
import { renderCodeDataUrl, resolveCodeValue } from "./codes";
import type { LabelInstance, Template, TextElement } from "./types";

/** Rasterize one label (template + optional instance) to a PNG data URL at print DPI. */
export async function renderLabelToDataURL(
  template: Template,
  label: LabelInstance | null,
  dpi = PRINT_DPI
): Promise<string> {
  const s = dpi / MM_PER_INCH; // px per mm
  const w = template.width_mm * s;
  const h = template.height_mm * s;

  const container = document.createElement("div");
  container.style.position = "absolute";
  container.style.left = "-100000px";
  container.style.top = "0";
  document.body.appendChild(container);

  const stage = new Konva.Stage({ container, width: w, height: h });
  const layer = new Konva.Layer();
  stage.add(layer);
  layer.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: "#ffffff" }));

  const pending: Promise<void>[] = [];
  for (const el of template.design) {
    if (el.type === "text") {
      const t = el as TextElement;
      layer.add(
        new Konva.Text({
          text: resolveText(t, template, label),
          x: t.x * s,
          y: t.y * s,
          width: t.width * s,
          fontSize: t.fontSize * s,
          fontFamily: t.fontFamily,
          fontStyle: t.fontStyle,
          align: t.align,
          fill: t.fill,
          rotation: t.rotation || 0,
        })
      );
    } else if (el.type === "line") {
      layer.add(
        new Konva.Line({
          points: [el.x * s, el.y * s, el.x2 * s, el.y2 * s],
          stroke: el.fill,
          strokeWidth: Math.max(1, el.thickness * s),
          lineCap: "round",
        })
      );
    } else if (el.type === "rect") {
      layer.add(
        new Konva.Rect({
          x: el.x * s,
          y: el.y * s,
          width: el.width * s,
          height: el.height * s,
          cornerRadius: (el.cornerRadius || 0) * s,
          stroke: el.stroke,
          strokeWidth: Math.max(1, el.thickness * s),
          fillEnabled: false,
          rotation: el.rotation || 0,
        })
      );
    } else if (el.type === "code") {
      const codeEl = el;
      pending.push(
        (async () => {
          const value = resolveCodeValue(codeEl, label);
          const dataUrl = await renderCodeDataUrl(codeEl, value);
          if (!dataUrl) return;
          await new Promise<void>((resolve) => {
            const img = new window.Image();
            img.onload = () => {
              layer.add(
                new Konva.Image({
                  image: img,
                  x: codeEl.x * s,
                  y: codeEl.y * s,
                  width: codeEl.width * s,
                  height: codeEl.height * s,
                  rotation: codeEl.rotation || 0,
                })
              );
              resolve();
            };
            img.onerror = () => resolve();
            img.src = dataUrl;
          });
        })()
      );
    } else {
      pending.push(
        new Promise<void>((resolve) => {
          const img = new window.Image();
          img.onload = () => {
            layer.add(
              new Konva.Image({
                image: img,
                x: el.x * s,
                y: el.y * s,
                width: el.width * s,
                height: el.height * s,
                rotation: el.rotation || 0,
              })
            );
            resolve();
          };
          img.onerror = () => resolve();
          img.src = el.src;
        })
      );
    }
  }

  await Promise.all(pending);
  layer.draw();
  const url = stage.toDataURL({ pixelRatio: 1 });
  stage.destroy();
  container.remove();
  return url;
}

export interface PrintJobItem {
  template: Template;
  label: LabelInstance | null;
  quantity: number;
}

export interface PrintOptions {
  printer?: string;
  showPreview?: boolean;
  directPageOrder?: "normal" | "reverse";
  /** Abort the direct print if the native side doesn't answer within this many ms. */
  timeoutMs?: number;
}

/** Reject if `promise` doesn't settle within `ms`. The underlying work isn't truly
 *  aborted, but the UI stops waiting and reports the failure. */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/** Yield to the event loop so React can repaint (e.g. the "Imprimindo…" state). */
const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

interface RenderedPrintPage {
  url: string;
  w: number;
  h: number;
  /** Number of identical copies of this label (rendered/decoded once). */
  copies: number;
}

/** Reports progress as printed labels accumulate: (done, total) physical labels. */
export type PrintProgress = (done: number, total: number) => void;

/**
 * Print labels. Each copy is its own page sized exactly to the label's mm dimensions,
 * so the printer feeds one label per page.
 *
 * Direct printing sends ONE item at a time (its own small job) so the printer starts
 * immediately, the UI stays responsive, and progress is reported as each item finishes —
 * instead of building one giant job that the spooler chews on before anything comes out.
 */
export async function printLabels(
  items: PrintJobItem[],
  options: PrintOptions = {},
  onProgress?: PrintProgress,
  /** Fires after each item is accepted by the printer, with that item's copy count. */
  onItemPrinted?: (copies: number) => void | Promise<void>
): Promise<string> {
  const valid = items.filter((it) => it.template && it.quantity >= 1);
  const total = valid.reduce((sum, it) => sum + Math.max(1, it.quantity), 0);
  if (total === 0) return "Nenhuma pagina para imprimir.";

  // Preview: one combined print dialog with every page (browser drives the output).
  if (options.showPreview) {
    const pages: RenderedPrintPage[] = [];
    for (const item of valid) {
      const url = await renderLabelToDataURL(item.template, item.label, PRINT_DPI);
      pages.push({ url, w: item.template.width_mm, h: item.template.height_mm, copies: Math.max(1, item.quantity) });
      await yieldToUI();
    }
    await printWithPreview(pages);
    return "Preview de impressao aberto.";
  }

  // Reverse the item order (not expanded copies) so the physical output stack matches
  // the list order, same as before when all pages were reversed at once.
  const ordered = options.directPageOrder === "reverse" ? [...valid].reverse() : valid;

  let done = 0;
  onProgress?.(0, total);

  for (const item of ordered) {
    const copies = Math.max(1, item.quantity);
    const url = await renderLabelToDataURL(item.template, item.label, PRINT_DPI);

    // Per-item timeout: small job, but give a stuck/offline printer a clear cutoff.
    const timeoutMs = options.timeoutMs ?? Math.max(15000, copies * 300);
    await withTimeout(
      invoke<string>("print_png_labels", {
        pages: [
          {
            dataUrl: url,
            widthMm: item.template.width_mm,
            heightMm: item.template.height_mm,
            copies,
          },
        ],
        printer: options.printer || null,
      }),
      timeoutMs,
      "A impressão não respondeu a tempo e foi cancelada. Verifique se a impressora está ligada e disponível."
    );

    done += copies;
    onProgress?.(done, total);
    // Record this item now that it's been sent — a later failure won't erase it.
    await onItemPrinted?.(copies);
    await yieldToUI();
  }

  return `${total} etiqueta(s) enviada(s) para impressão.`;
}

async function printWithPreview(pages: RenderedPrintPage[]): Promise<void> {
  // Page size for @page is taken from the first label (thermal media is fixed).
  const { w, h } = pages[0];

  const body = pages
    .map((p) =>
      `<div class="page"><img src="${p.url}" style="width:${p.w}mm;height:${p.h}mm" /></div>`.repeat(
        Math.max(1, p.copies)
      )
    )
    .join("");

  const html = `<!doctype html><html><head><meta charset="utf-8" />
<style>
  @page { size: ${w}mm ${h}mm; margin: 0; }
  html, body { margin: 0; padding: 0; }
  .page { width: ${w}mm; height: ${h}mm; overflow: hidden; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
  img { display: block; }
</style></head><body>${body}</body></html>`;

  await new Promise<void>((resolve) => {
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    document.body.appendChild(iframe);

    const cleanup = () => {
      setTimeout(() => iframe.remove(), 1000);
      resolve();
    };

    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) return cleanup();
      win.focus();
      win.print();
      cleanup();
    };

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(html);
      doc.close();
    } else {
      cleanup();
    }
  });
}
