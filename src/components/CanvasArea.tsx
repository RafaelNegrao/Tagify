import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type Konva from "konva";
import { useStore } from "../store/useStore";
import { MAX_SCREEN_PX_PER_MM, STAGE_PAD, WORK_MARGIN_MM } from "../constants";
import { productToLabel } from "../render";
import LabelStage from "./LabelStage";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 12;
const GRID_MM = 5; // dot-matrix spacing, in label millimetres
const RULER = 22; // ruler thickness in px (editor only)

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/** Viewport state: zoom level and the screen offset of the stage. */
interface View {
  z: number;
  x: number;
  y: number;
}

const formatMm = (mm: number) =>
  Math.abs(mm % 1) > 1e-6 ? mm.toFixed(1) : String(Math.round(mm));

/**
 * Millimetre ruler along the top (h) or left (v) edge of the canvas, Photoshop-style:
 * the white band marks the label extent and a thin line tracks the cursor.
 */
function Ruler({
  orientation,
  origin,
  pxPerMm,
  labelMm,
  markerRef,
}: {
  orientation: "h" | "v";
  /** Position (px, in the ruler's own coordinates) of label millimetre 0. */
  origin: number;
  pxPerMm: number;
  labelMm: number;
  markerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;

    const draw = () => {
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      const cw = cv.clientWidth;
      const ch = cv.clientHeight;
      if (cw === 0 || ch === 0) return;
      const len = orientation === "h" ? cw : ch;
      const th = orientation === "h" ? ch : cw;
      const dpr = window.devicePixelRatio || 1;
      cv.width = Math.round(cw * dpr);
      cv.height = Math.round(ch * dpr);
      ctx.scale(dpr, dpr);

      ctx.fillStyle = "#eef0f3";
      ctx.fillRect(0, 0, cw, ch);

      // White band over the label's extent.
      ctx.fillStyle = "#ffffff";
      if (orientation === "h") ctx.fillRect(origin, 0, labelMm * pxPerMm, th);
      else ctx.fillRect(0, origin, th, labelMm * pxPerMm);

      // Pick the tick step so numbered ticks sit ~44px+ apart at any zoom.
      const steps = [0.5, 1, 2, 5, 10, 25, 50, 100, 250];
      const step = steps.find((st) => st * pxPerMm >= 44) ?? 500;
      const minor = step / 5;
      const mmFrom = Math.floor(-origin / pxPerMm / minor) * minor;
      const mmTo = (len - origin) / pxPerMm;

      ctx.strokeStyle = "#aab1bd";
      ctx.fillStyle = "#5d6674";
      ctx.font = "500 9px 'SF Pro Text', sans-serif";
      ctx.beginPath();
      for (let mm = mmFrom; mm <= mmTo; mm += minor) {
        const p = Math.round(origin + mm * pxPerMm) + 0.5;
        const isMajor = Math.abs(mm / step - Math.round(mm / step)) < 1e-6;
        const tickLen = isMajor ? th : 6;
        if (orientation === "h") {
          ctx.moveTo(p, th);
          ctx.lineTo(p, th - tickLen);
        } else {
          ctx.moveTo(th, p);
          ctx.lineTo(th - tickLen, p);
        }
        if (isMajor) {
          const text = formatMm(mm);
          if (orientation === "h") {
            ctx.fillText(text, p + 3, 9);
          } else {
            ctx.save();
            ctx.translate(9, p - 3);
            ctx.rotate(-Math.PI / 2);
            ctx.fillText(text, 0, 0);
            ctx.restore();
          }
        }
      }
      ctx.stroke();

      // Border on the edge facing the canvas.
      ctx.strokeStyle = "#d8dce2";
      ctx.beginPath();
      if (orientation === "h") {
        ctx.moveTo(0, th - 0.5);
        ctx.lineTo(cw, th - 0.5);
      } else {
        ctx.moveTo(th - 0.5, 0);
        ctx.lineTo(th - 0.5, ch);
      }
      ctx.stroke();
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [orientation, origin, pxPerMm, labelMm]);

  return (
    <div className={`canvas-ruler canvas-ruler-${orientation}`}>
      <canvas ref={canvasRef} />
      <div className="canvas-ruler-marker" ref={markerRef} />
    </div>
  );
}

export default function CanvasArea() {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const tab = useStore((s) => s.tab);
  const editor = useStore((s) => s.editor);
  const selectedIds = useStore((s) => s.selectedIds);
  const select = useStore((s) => s.select);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const selectMany = useStore((s) => s.selectMany);
  const selectAll = useStore((s) => s.selectAll);
  const updateElement = useStore((s) => s.updateElement);
  const removeElement = useStore((s) => s.removeElement);
  const removeSelected = useStore((s) => s.removeSelected);
  const nudgeSelected = useStore((s) => s.nudgeSelected);
  const copySelected = useStore((s) => s.copySelected);
  const pasteClipboard = useStore((s) => s.pasteClipboard);
  const duplicateSelected = useStore((s) => s.duplicateSelected);
  const reorderElement = useStore((s) => s.reorderElement);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const addLine = useStore((s) => s.addLine);

  const templates = useStore((s) => s.templates);
  const products = useStore((s) => s.products);
  const selectedTemplateId = useStore((s) => s.selectedTemplateId);
  const selectedProductId = useStore((s) => s.selectedProductId);
  const lote = useStore((s) => s.lote);
  const selectedLoteRowId = useStore((s) => s.selectedLoteRowId);
  const loteUseSharedDates = useStore((s) => s.loteUseSharedDates);
  const loteSharedValues = useStore((s) => s.loteSharedValues);

  const showPreview = tab === "lote";
  const previewTemplate =
    showPreview ? templates.find((t) => t.id === selectedTemplateId) ?? null : null;
  const previewProduct = products.find((p) => p.id === selectedProductId) ?? null;

  const template = tab === "canva" && editor ? editor : previewTemplate;
  const loteValues = lote.find((row) => row.rowId === selectedLoteRowId)?.values ?? {};
  const mergedLoteValues = loteUseSharedDates
    ? { ...loteValues, ...loteSharedValues }
    : loteValues;

  const label =
    previewTemplate
      ? productToLabel(
          previewTemplate,
          previewProduct,
          tab === "lote" ? mergedLoteValues : {}
        )
      : null;

  const w = template?.width_mm ?? 100;
  const h = template?.height_mm ?? 150;
  const isEditor = tab === "canva" && !!editor;

  // Base px-per-mm; zoom is applied on top via CSS transform.
  const base = MAX_SCREEN_PX_PER_MM;
  const [view, setView] = useState<View>({ z: 1, x: 0, y: 0 });
  const [alignGuides, setAlignGuides] = useState(false);
  const [panning, setPanning] = useState(false);

  // The label sits inset by this padding inside the (larger) stage. In the editor it
  // scales with zoom (work margin); previews keep the fixed transformer padding.
  const padPxFor = useCallback(
    (z: number) => (isEditor ? WORK_MARGIN_MM * base * z : STAGE_PAD),
    [isEditor, base]
  );

  // Pan that centres the label in the viewport for a given zoom.
  const centeredPan = useCallback(
    (z: number) => {
      const el = containerRef.current;
      if (!el) return { x: 0, y: 0 };
      const pad = padPxFor(z);
      return {
        x: (el.clientWidth - w * base * z) / 2 - pad,
        y: (el.clientHeight - h * base * z) / 2 - pad,
      };
    },
    [w, h, base, padPxFor]
  );

  // Fit the label into the viewport and centre it.
  const fitToView = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const padding = 64;
    const fit = clampZoom(
      Math.min((el.clientWidth - padding) / (w * base), (el.clientHeight - padding) / (h * base))
    );
    setView({ z: fit, ...centeredPan(fit) });
  }, [w, h, base, centeredPan]);

  // Re-fit whenever the displayed label changes.
  const fitKey = `${template?.id ?? "none"}:${w}x${h}`;
  useLayoutEffect(() => {
    if (template) fitToView();
  }, [fitKey, fitToView, template]);

  // Zoom keeping the screen point (qx, qy) anchored — the spot under the cursor stays put.
  const zoomAt = useCallback(
    (qx: number, qy: number, mul: number, absolute = false) => {
      setView((v) => {
        const next = clampZoom(absolute ? mul : v.z * mul);
        if (next === v.z) return v;
        const k = next / v.z;
        const padNow = padPxFor(v.z);
        const padNext = padPxFor(next);
        return {
          z: next,
          x: qx - padNext - (qx - v.x - padNow) * k,
          y: qy - padNext - (qy - v.y - padNow) * k,
        };
      });
    },
    [padPxFor]
  );

  // Zoom from buttons/shortcuts: anchor at the viewport centre (keeps the current view).
  const zoomAtCenter = useCallback(
    (mul: number, absolute = false) => {
      const el = containerRef.current;
      if (!el) return;
      zoomAt(el.clientWidth / 2, el.clientHeight / 2, mul, absolute);
    },
    [zoomAt]
  );

  // Wheel: zoom anchored at the cursor, like Photoshop/Figma.
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.1 : 1 / 1.1);
    },
    [zoomAt]
  );

  // Pan with middle mouse, space-drag, or dragging the empty background.
  const spaceDown = useRef(false);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const capturedPointer = useRef<number | null>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceDown.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Editor keyboard shortcuts (Photoshop-style). Skipped while typing in a field.
  useEffect(() => {
    if (!isEditor) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (!ctrl) {
        if (e.key === "Delete" || e.key === "Backspace") {
          if (selectedIds.length === 0) return;
          e.preventDefault();
          removeSelected();
        } else if (e.key === "Escape") {
          if (tool !== "select") setTool("select");
          else select(null);
        } else if (e.key.startsWith("Arrow")) {
          if (selectedIds.length === 0) return;
          e.preventDefault();
          const d = e.shiftKey ? 2 : 0.5; // mm
          nudgeSelected(
            e.key === "ArrowLeft" ? -d : e.key === "ArrowRight" ? d : 0,
            e.key === "ArrowUp" ? -d : e.key === "ArrowDown" ? d : 0
          );
        } else if (e.key === "v") {
          setTool("select");
        } else if (e.key === "l") {
          setTool("line");
        } else if (e.key === "m") {
          setTool("measure");
        }
        return;
      }

      if (key === "d") {
        e.preventDefault();
        duplicateSelected();
      } else if (key === "c") {
        copySelected();
      } else if (key === "x") {
        copySelected();
        removeSelected();
      } else if (key === "v") {
        pasteClipboard();
      } else if (key === "a") {
        e.preventDefault();
        selectAll();
      } else if (key === "0") {
        e.preventDefault();
        fitToView();
      } else if (key === "1") {
        e.preventDefault();
        zoomAtCenter(1, true);
      } else if (key === "=" || key === "+") {
        e.preventDefault();
        zoomAtCenter(1.2);
      } else if (key === "-") {
        e.preventDefault();
        zoomAtCenter(1 / 1.2);
      } else if (e.key === "]") {
        e.preventDefault();
        for (const id of selectedIds) reorderElement(id, e.shiftKey ? "front" : "forward");
      } else if (e.key === "[") {
        e.preventDefault();
        for (const id of selectedIds) reorderElement(id, e.shiftKey ? "back" : "backward");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    isEditor,
    selectedIds,
    tool,
    setTool,
    select,
    removeSelected,
    nudgeSelected,
    duplicateSelected,
    copySelected,
    pasteClipboard,
    selectAll,
    reorderElement,
    fitToView,
    zoomAtCenter,
  ]);

  const stopPan = useCallback(() => {
    dragging.current = null;
    capturedPointer.current = null;
    setPanning(false);
  }, []);

  useEffect(() => {
    window.addEventListener("pointerup", stopPan);
    window.addEventListener("pointercancel", stopPan);
    window.addEventListener("blur", stopPan);
    return () => {
      window.removeEventListener("pointerup", stopPan);
      window.removeEventListener("pointercancel", stopPan);
      window.removeEventListener("blur", stopPan);
    };
  }, [stopPan]);

  // Cursor tracking for the ruler markers and the X/Y readout. These update the DOM
  // directly (refs) so element drags aren't slowed down by React re-renders.
  const hMarkerRef = useRef<HTMLDivElement>(null);
  const vMarkerRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);

  const trackCursor = (e: React.PointerEvent) => {
    if (!isEditor) return;
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (hMarkerRef.current) {
      hMarkerRef.current.style.transform = `translateX(${cx - RULER}px)`;
      hMarkerRef.current.style.opacity = "1";
    }
    if (vMarkerRef.current) {
      vMarkerRef.current.style.transform = `translateY(${cy - RULER}px)`;
      vMarkerRef.current.style.opacity = "1";
    }
    if (readoutRef.current) {
      const pad = padPxFor(view.z);
      const mmX = (cx - view.x - pad) / (base * view.z);
      const mmY = (cy - view.y - pad) / (base * view.z);
      readoutRef.current.textContent = `X ${mmX.toFixed(1)}  Y ${mmY.toFixed(1)} mm`;
    }
  };

  const onPointerLeave = () => {
    if (hMarkerRef.current) hMarkerRef.current.style.opacity = "0";
    if (vMarkerRef.current) vMarkerRef.current.style.opacity = "0";
    if (readoutRef.current) readoutRef.current.textContent = "";
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const onBackground = e.target === e.currentTarget;
    if (e.button === 1 || spaceDown.current || onBackground) {
      dragging.current = { x: e.clientX - view.x, y: e.clientY - view.y };
      capturedPointer.current = e.pointerId;
      setPanning(true);
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // The global pointerup fallback still clears the pan state.
      }
      e.preventDefault();
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    trackCursor(e);
    if (!dragging.current) return;
    const d = dragging.current;
    setView((v) => ({ ...v, x: e.clientX - d.x, y: e.clientY - d.y }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (dragging.current || capturedPointer.current === e.pointerId) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Capture may already have been released by the browser.
      }
      stopPan();
    }
  };

  const padPx = padPxFor(view.z);
  const gridPx = GRID_MM * base * view.z;
  const drawingLine = tool === "line" && isEditor;
  const measuring = tool === "measure" && isEditor;

  return (
    <div
      className={`canvas-area ${panning ? "panning" : ""} ${drawingLine || measuring ? "drawing" : ""}`}
      ref={containerRef}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      style={{
        backgroundSize: `${gridPx}px ${gridPx}px`,
        // Anchor the dot grid to the label origin so dots land on whole millimetres.
        backgroundPosition: `${view.x + padPx}px ${view.y + padPx}px`,
      }}
    >
      {template ? (
        <>
          <div
            className="canvas-frame"
            style={{
              transform: `translate(${view.x}px, ${view.y}px)`,
              transformOrigin: "top left",
            }}
          >
            <LabelStage
              template={template}
              label={label}
              pxPerMm={base * view.z}
              interactive={isEditor}
              selectedIds={selectedIds}
              onSelect={select}
              onToggleSelect={toggleSelect}
              onSelectMany={selectMany}
              onChange={updateElement}
              onRemove={isEditor ? removeElement : undefined}
              stageRef={stageRef}
              drawing={drawingLine}
              onDrawLine={addLine}
              measuring={measuring}
              alignGuides={alignGuides}
            />
          </div>

          {isEditor && (
            <>
              <Ruler
                orientation="h"
                origin={view.x + padPx - RULER}
                pxPerMm={base * view.z}
                labelMm={template.width_mm}
                markerRef={hMarkerRef}
              />
              <Ruler
                orientation="v"
                origin={view.y + padPx - RULER}
                pxPerMm={base * view.z}
                labelMm={template.height_mm}
                markerRef={vMarkerRef}
              />
              <div className="canvas-ruler-corner" />
            </>
          )}

          <div className={`canvas-hud ${isEditor ? "with-rulers" : ""}`}>
            <div className="canvas-hud-left">
              {isEditor && (
                <button
                  className={`canvas-tool-btn ${alignGuides ? "active" : ""}`}
                  title="Régua de alinhamento"
                  aria-label="Régua de alinhamento"
                  onClick={() => setAlignGuides((enabled) => !enabled)}
                >
                  <RulerIcon />
                </button>
              )}
              <div className="canvas-hud-badges">
                <span className="canvas-hud-dims">
                  {template.width_mm} × {template.height_mm} mm
                </span>
                {isEditor && <span className="canvas-hud-dims canvas-hud-pos" ref={readoutRef} />}
              </div>
            </div>
            <div className="canvas-zoom">
              <button className="zoom-btn" title="Diminuir (Ctrl -)" onClick={() => zoomAtCenter(1 / 1.2)}>
                −
              </button>
              <button className="zoom-pct" title="Ajustar à tela (Ctrl 0)" onClick={fitToView}>
                {Math.round(view.z * 100)}%
              </button>
              <button className="zoom-btn" title="Aumentar (Ctrl +)" onClick={() => zoomAtCenter(1.2)}>
                +
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="canvas-empty">
          {tab === "canva"
            ? "Escolha um tamanho de etiqueta no menu para começar."
            : "Selecione um item no menu para visualizar a etiqueta."}
        </div>
      )}
    </div>
  );
}

function RulerIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 4v9a6 6 0 0 0 12 0V4" />
      <path d="M6 4h4" />
      <path d="M14 4h4" />
      <path d="M6 9h4" />
      <path d="M14 9h4" />
    </svg>
  );
}
