import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Group, Rect, Text, Image as KonvaImage, Line, Transformer, Circle } from "react-konva";
import type Konva from "konva";
import type { CodeElement, ImageElement, LabelElement, LabelInstance, LineElement, RectElement, Template, TextElement } from "../types";
import { resolveText } from "../render";
import { renderCodeDataUrl, resolveCodeValue } from "../codes";
import { STAGE_PAD, WORK_MARGIN_MM } from "../constants";
import { isDateFieldKey, isProductFieldKey } from "../fields";

interface Props {
  template: Pick<Template, "design" | "width_mm" | "height_mm" | "sharedValues">;
  label?: LabelInstance | null;
  pxPerMm: number;
  interactive?: boolean;
  selectedIds?: string[];
  onSelect?: (id: string | null) => void;
  onToggleSelect?: (id: string) => void;
  onSelectMany?: (ids: string[]) => void;
  onChange?: (id: string, patch: Partial<LabelElement>) => void;
  onRemove?: (id: string) => void;
  stageRef?: React.RefObject<Konva.Stage | null>;
  /** When true, dragging on the canvas draws a new line (A → B). */
  drawing?: boolean;
  onDrawLine?: (a: { x: number; y: number }, b: { x: number; y: number }) => void;
  /** When true, dragging measures the distance between A and B (no element added). */
  measuring?: boolean;
  alignGuides?: boolean;
}

type Box = { x: number; y: number; w: number; h: number };
type Guide = { axis: "x" | "y"; pos: number };

// Circular-arrows cursor shown over the rotation handle (white halo for contrast).
const ROTATE_CURSOR_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22' viewBox='0 0 24 24'><g fill='none' stroke-linecap='round' stroke-linejoin='round'><path d='M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4' stroke='white' stroke-width='5'/><path d='M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4' stroke='black' stroke-width='2.2'/></g></svg>`;
const ROTATE_CURSOR = `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(ROTATE_CURSOR_SVG)}") 11 11, crosshair`;

/** True when `b` is entirely inside `a` — marquee only selects fully enclosed elements. */
function boxContains(a: Box, b: { x: number; y: number; width: number; height: number }): boolean {
  return b.x >= a.x && b.y >= a.y && b.x + b.width <= a.x + a.w && b.y + b.height <= a.y + a.h;
}

function useImage(src: string): HTMLImageElement | undefined {
  const [img, setImg] = useState<HTMLImageElement>();
  useEffect(() => {
    setImg(undefined);
    if (!src) return;
    const image = new window.Image();
    image.crossOrigin = "anonymous";
    image.src = src;
    image.onload = () => setImg(image);
    return () => {
      image.onload = null;
    };
  }, [src]);
  return img;
}

function ImageNode({
  el,
  s,
  draggable,
  onMouseDownNode,
  onDragStart,
  onDragMove,
  onDragEnd,
  onResize,
}: {
  el: ImageElement;
  s: number;
  draggable: boolean;
  onMouseDownNode: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragStart: () => void;
  onDragMove: (node: Konva.Node) => void;
  onDragEnd: (node: Konva.Node) => void;
  onResize: (patch: Partial<ImageElement>) => void;
}) {
  const img = useImage(el.src);
  return (
    <KonvaImage
      id={el.id}
      image={img}
      x={el.x * s}
      y={el.y * s}
      width={el.width * s}
      height={el.height * s}
      rotation={el.rotation || 0}
      draggable={draggable}
      onMouseDown={onMouseDownNode}
      onTap={() => onMouseDownNode({ evt: {} } as Konva.KonvaEventObject<MouseEvent>)}
      onDragStart={onDragStart}
      onDragMove={(e) => onDragMove(e.target)}
      onDragEnd={(e) => onDragEnd(e.target)}
      onTransformEnd={(e) => {
        const node = e.target as Konva.Image;
        const sx = node.scaleX();
        const sy = node.scaleY();
        node.scaleX(1);
        node.scaleY(1);
        const width = Math.max(2, (node.width() * sx) / s);
        // Proportional lock: derive height from the element's own ratio so float
        // drift during the drag can't slowly distort it.
        const height = el.keepRatio
          ? width * (el.height / el.width)
          : Math.max(2, (node.height() * sy) / s);
        onResize({
          x: node.x() / s,
          y: node.y() / s,
          width,
          height,
          rotation: node.rotation(),
        });
      }}
    />
  );
}

function CodeNode({
  el,
  s,
  label,
  draggable,
  onMouseDownNode,
  onDragStart,
  onDragMove,
  onDragEnd,
  onResize,
}: {
  el: CodeElement;
  s: number;
  label?: LabelInstance | null;
  draggable: boolean;
  onMouseDownNode: (e: Konva.KonvaEventObject<MouseEvent>) => void;
  onDragStart: () => void;
  onDragMove: (node: Konva.Node) => void;
  onDragEnd: (node: Konva.Node) => void;
  onResize: (patch: Partial<CodeElement>) => void;
}) {
  const value = resolveCodeValue(el, label);
  const [src, setSrc] = useState("");
  useEffect(() => {
    let active = true;
    setSrc("");
    renderCodeDataUrl(el, value).then((url) => active && setSrc(url));
    return () => {
      active = false;
    };
  }, [el.kind, el.symbology, value]);
  const img = useImage(src);

  const commonHandlers = {
    id: el.id,
    x: el.x * s,
    y: el.y * s,
    width: el.width * s,
    height: el.height * s,
    rotation: el.rotation || 0,
    draggable,
    onMouseDown: onMouseDownNode,
    onTap: () => onMouseDownNode({ evt: {} } as Konva.KonvaEventObject<MouseEvent>),
    onDragStart,
    onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => onDragMove(e.target),
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onDragEnd(e.target),
    onTransformEnd: (e: Konva.KonvaEventObject<Event>) => {
      const node = e.target;
      const sx = node.scaleX();
      const sy = node.scaleY();
      node.scaleX(1);
      node.scaleY(1);
      const width = Math.max(4, (node.width() * sx) / s);
      // Proportional lock: derive height from the element's own ratio so float
      // drift during the drag can't slowly distort it.
      const height = el.keepRatio
        ? width * (el.height / el.width)
        : Math.max(4, (node.height() * sy) / s);
      onResize({
        x: node.x() / s,
        y: node.y() / s,
        width,
        height,
        rotation: node.rotation(),
      });
    },
  };

  // No image yet (empty/invalid value) in preview: nothing to show.
  if (!img && !draggable) return null;
  // Always render the same KonvaImage node: swapping the placeholder for a different
  // node type would orphan the transformer, which tracks the node instance (not the id).
  // The transparent fill keeps the whole area hit-testable while the code renders;
  // the dashed stroke is the placeholder look.
  return (
    <KonvaImage
      {...commonHandlers}
      image={img}
      fill="rgba(0,0,0,0)"
      stroke="#b6bcc6"
      strokeWidth={1}
      dash={[4, 3]}
      strokeEnabled={!img}
    />
  );
}

/** Dashed measurement line with its distance badge (m in px content coords). */
function MeasureGraphic({ m, s }: { m: [number, number, number, number]; s: number }) {
  const distMm = Math.hypot(m[2] - m[0], m[3] - m[1]) / s;
  const text = `${distMm.toFixed(1)} mm`;
  const lw = text.length * 7 + 14;
  const midX = (m[0] + m[2]) / 2;
  const midY = (m[1] + m[3]) / 2;
  return (
    <Group listening={false}>
      <Line points={m} stroke="#0a7d33" strokeWidth={1.5} dash={[6, 4]} lineCap="round" />
      <Group x={midX} y={midY - 22}>
        <Rect x={-lw / 2} y={0} width={lw} height={18} cornerRadius={4} fill="#0a7d33" />
        <Text
          x={-lw / 2}
          y={0}
          width={lw}
          height={18}
          align="center"
          verticalAlign="middle"
          text={text}
          fill="#ffffff"
          fontSize={12}
          fontStyle="bold"
        />
      </Group>
    </Group>
  );
}

/** Red "X" button drawn at the element's top-right corner to delete it. */
function DeleteHandle({ x, y, onRemove }: { x: number; y: number; onRemove: () => void }) {
  const remove = (e: Konva.KonvaEventObject<Event>) => {
    e.cancelBubble = true;
    onRemove();
  };
  return (
    <Group
      x={Math.max(0, x)}
      y={Math.max(0, y)}
      onMouseDown={(e) => (e.cancelBubble = true)}
      onClick={remove}
      onTap={remove}
    >
      <Rect width={20} height={20} cornerRadius={10} fill="#d6453d" opacity={0.95} />
      <Line points={[6, 6, 14, 14]} stroke="#ffffff" strokeWidth={1.6} lineCap="round" />
      <Line points={[14, 6, 6, 14]} stroke="#ffffff" strokeWidth={1.6} lineCap="round" />
    </Group>
  );
}

function LineEndpointHandles({
  line,
  s,
  snapPoint,
  onChange,
  onDone,
}: {
  line: LineElement;
  s: number;
  snapPoint: (x: number, y: number) => { x: number; y: number };
  onChange: (patch: Partial<LineElement>) => void;
  onDone: () => void;
}) {
  const handleDrag = (point: "a" | "b", node: Konva.Node) => {
    const snapped = snapPoint(node.x(), node.y());
    node.position(snapped);
    if (point === "a") {
      onChange({ x: snapped.x / s, y: snapped.y / s });
    } else {
      onChange({ x2: snapped.x / s, y2: snapped.y / s });
    }
  };

  const renderHandle = (point: "a" | "b", x: number, y: number) => (
    <Circle
      key={point}
      x={x}
      y={y}
      radius={6}
      fill="#ffffff"
      stroke="#2f6fed"
      strokeWidth={2}
      draggable
      onMouseDown={(e) => {
        e.cancelBubble = true;
      }}
      onTap={(e) => {
        e.cancelBubble = true;
      }}
      onDragMove={(e) => handleDrag(point, e.target)}
      onDragEnd={(e) => {
        handleDrag(point, e.target);
        onDone();
      }}
    />
  );

  return (
    <>
      {renderHandle("a", line.x * s, line.y * s)}
      {renderHandle("b", line.x2 * s, line.y2 * s)}
    </>
  );
}

export default function LabelStage({
  template,
  label,
  pxPerMm,
  interactive = false,
  selectedIds = [],
  onSelect,
  onToggleSelect,
  onSelectMany,
  onChange,
  onRemove,
  stageRef,
  drawing = false,
  onDrawLine,
  measuring = false,
  alignGuides = false,
}: Props) {
  const s = pxPerMm;
  const w = template.width_mm * s;
  const h = template.height_mm * s;
  // In the editor the stage extends well beyond the label so elements can be parked
  // outside the printable area; previews/print keep the label tight to the stage.
  const pad = interactive ? Math.round(WORK_MARGIN_MM * s) : STAGE_PAD;
  const trRef = useRef<Konva.Transformer>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const contentRef = useRef<Konva.Group>(null);

  /** Pointer position in content (label) coordinates — i.e. with the stage padding removed. */
  const contentPointer = (stage: Konva.Stage): { x: number; y: number } | null => {
    const p = stage.getPointerPosition();
    return p ? { x: p.x - pad, y: p.y - pad } : null;
  };

  // Line being drawn, in px content coordinates.
  const [draft, setDraft] = useState<[number, number, number, number] | null>(null);
  // Mirrors `draft` so the global mouseup handler can finalize without a
  // side-effect inside a setState updater (which StrictMode double-invokes).
  const draftRef = useRef<[number, number, number, number] | null>(null);

  // Measurement tool: live drag draft and the last committed measurement (px content coords).
  const [measureDraft, setMeasureDraft] = useState<[number, number, number, number] | null>(null);
  const measureDraftRef = useRef<[number, number, number, number] | null>(null);
  const [measure, setMeasure] = useState<[number, number, number, number] | null>(null);

  // When the ruler/guides are on, force the line onto the nearest axis so it
  // ends up perfectly horizontal or vertical instead of slightly inclined.
  const snapDraftLine = (
    d: [number, number, number, number]
  ): [number, number, number, number] => {
    if (!alignGuides) return d;
    const [x1, y1, x2, y2] = d;
    return Math.abs(x2 - x1) >= Math.abs(y2 - y1)
      ? [x1, y1, x2, y1] // horizontal
      : [x1, y1, x1, y2]; // vertical
  };
  // Marquee rectangle, in px content coordinates.
  const [marqueeRect, setMarqueeRect] = useState<[number, number, number, number] | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  // Live badge near the element while dragging (X/Y) or resizing (W×H), shown
  // only when the alignment ruler is on. Content px coords.
  const [dragBadge, setDragBadge] = useState<{ x: number; y: number; text: string } | null>(null);
  const marqueeRef = useRef(false);
  // Origin positions (px) of every selected node at the start of a group drag.
  const groupDrag = useRef<Map<string, { x: number; y: number }> | null>(null);
  // Per-element selection outlines (px, content coords) shown on multi-select, since
  // the transformer only draws a single box around the whole group.
  const [selectionBoxes, setSelectionBoxes] = useState<
    { id: string; x: number; y: number; width: number; height: number }[]
  >([]);
  const outlineGroupRef = useRef<Konva.Group>(null);
  // Delete ("X") buttons are translated as a group during a drag so they track the
  // element(s), since their React positions only update on drag end.
  const deleteHandlesRef = useRef<Konva.Group>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);

  const isGroup = selectedIds.length > 1;
  // Single selected image/code with the proportional lock on → corner handles only,
  // resizing keeps the width/height ratio.
  const selectedSingle =
    selectedIds.length === 1 ? template.design.find((e) => e.id === selectedIds[0]) : undefined;
  const transformerKeepRatio =
    (selectedSingle?.type === "image" || selectedSingle?.type === "code") &&
    !!selectedSingle.keepRatio;

  const onElementMouseDown = (id: string, e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!interactive || drawing || measuring) return;
    if (e.evt?.shiftKey) onToggleSelect?.(id);
    else if (!selectedIds.includes(id)) onSelect?.(id);
  };

  const getSnapTargets = (movingId: string) => {
    const xTargets = [0, w / 2, w];
    const yTargets = [0, h / 2, h];
    const layer = layerRef.current;
    const relativeTo = contentRef.current ?? undefined;
    if (!layer) return { xTargets, yTargets };

    for (const el of template.design) {
      if (el.id === movingId || selectedIds.includes(el.id)) continue;
      const node = layer.findOne(`#${el.id}`);
      if (!node) continue;
      const box = node.getClientRect({ relativeTo });
      xTargets.push(box.x, box.x + box.width / 2, box.x + box.width);
      yTargets.push(box.y, box.y + box.height / 2, box.y + box.height);
    }

    return { xTargets, yTargets };
  };

  const snapNode = (movingId: string, node: Konva.Node) => {
    if (!alignGuides || !contentRef.current) {
      setGuides([]);
      return;
    }

    const snapPx = 6;
    const box = node.getClientRect({ relativeTo: contentRef.current });
    const movingX = [box.x, box.x + box.width / 2, box.x + box.width];
    const movingY = [box.y, box.y + box.height / 2, box.y + box.height];
    const { xTargets, yTargets } = getSnapTargets(movingId);

    let dx = 0;
    let dy = 0;
    let bestX = snapPx + 1;
    let bestY = snapPx + 1;
    let xGuide: Guide | null = null;
    let yGuide: Guide | null = null;

    for (const target of xTargets) {
      for (const point of movingX) {
        const diff = target - point;
        if (Math.abs(diff) < bestX && Math.abs(diff) <= snapPx) {
          bestX = Math.abs(diff);
          dx = diff;
          xGuide = { axis: "x", pos: target };
        }
      }
    }

    for (const target of yTargets) {
      for (const point of movingY) {
        const diff = target - point;
        if (Math.abs(diff) < bestY && Math.abs(diff) <= snapPx) {
          bestY = Math.abs(diff);
          dy = diff;
          yGuide = { axis: "y", pos: target };
        }
      }
    }

    if (dx || dy) node.position({ x: node.x() + dx, y: node.y() + dy });
    setGuides([xGuide, yGuide].filter(Boolean) as Guide[]);
  };

  const snapPoint = (movingId: string, x: number, y: number): { x: number; y: number } => {
    if (!alignGuides) {
      setGuides([]);
      return { x, y };
    }

    const snapPx = 6;
    const { xTargets, yTargets } = getSnapTargets(movingId);
    let nextX = x;
    let nextY = y;
    let bestX = snapPx + 1;
    let bestY = snapPx + 1;
    let xGuide: Guide | null = null;
    let yGuide: Guide | null = null;

    for (const target of xTargets) {
      const diff = target - x;
      if (Math.abs(diff) < bestX && Math.abs(diff) <= snapPx) {
        bestX = Math.abs(diff);
        nextX = target;
        xGuide = { axis: "x", pos: target };
      }
    }

    for (const target of yTargets) {
      const diff = target - y;
      if (Math.abs(diff) < bestY && Math.abs(diff) <= snapPx) {
        bestY = Math.abs(diff);
        nextY = target;
        yGuide = { axis: "y", pos: target };
      }
    }

    setGuides([xGuide, yGuide].filter(Boolean) as Guide[]);
    return { x: nextX, y: nextY };
  };

  const handleDragStart = (id: string) => {
    const layer = layerRef.current;
    const node = layer?.findOne(`#${id}`);
    dragStartPos.current = node ? { x: node.x(), y: node.y() } : { x: 0, y: 0 };
    if (!isGroup || !selectedIds.includes(id) || !layer) {
      groupDrag.current = null;
      return;
    }
    const m = new Map<string, { x: number; y: number }>();
    for (const sid of selectedIds) {
      const n = layer.findOne(`#${sid}`);
      if (n) m.set(sid, { x: n.x(), y: n.y() });
    }
    groupDrag.current = m;
  };

  const handleDragMove = (id: string, node: Konva.Node) => {
    snapNode(id, node);
    if (alignGuides && contentRef.current) {
      const box = node.getClientRect({ relativeTo: contentRef.current });
      setDragBadge({
        x: box.x,
        y: box.y - 26,
        text: `X ${(box.x / s).toFixed(1)}  Y ${(box.y / s).toFixed(1)} mm`,
      });
    }
    // Keep the delete buttons (and group outlines) following the drag.
    const start = dragStartPos.current;
    if (start) {
      const ddx = node.x() - start.x;
      const ddy = node.y() - start.y;
      deleteHandlesRef.current?.position({ x: ddx, y: ddy });
      outlineGroupRef.current?.position({ x: ddx, y: ddy });
    }
    const m = groupDrag.current;
    if (!m || !layerRef.current) {
      layerRef.current?.batchDraw();
      return;
    }
    const o = m.get(id);
    if (!o) return;
    const dx = node.x() - o.x;
    const dy = node.y() - o.y;
    for (const [sid, start] of m) {
      if (sid === id) continue;
      const n = layerRef.current.findOne(`#${sid}`);
      if (n) n.position({ x: start.x + dx, y: start.y + dy });
    }
    layerRef.current.batchDraw();
  };

  /** Commit a group move. Returns true if it handled the drag (so the node's own commit is skipped). */
  const handleGroupDragEnd = (id: string, node: Konva.Node): boolean => {
    const m = groupDrag.current;
    if (!m) return false;
    const o = m.get(id);
    const dx = (node.x() - (o?.x ?? 0)) / s;
    const dy = (node.y() - (o?.y ?? 0)) / s;
    for (const sid of selectedIds) {
      const el = template.design.find((e) => e.id === sid);
      if (!el) continue;
      if (el.type === "line") {
        // Lines aren't position-controlled by React, so reset their node offset.
        layerRef.current?.findOne(`#${sid}`)?.position({ x: 0, y: 0 });
        onChange?.(sid, { x: el.x + dx, y: el.y + dy, x2: el.x2 + dx, y2: el.y2 + dy });
      } else {
        onChange?.(sid, { x: el.x + dx, y: el.y + dy });
      }
    }
    groupDrag.current = null;
    dragStartPos.current = null;
    setGuides([]);
    outlineGroupRef.current?.position({ x: 0, y: 0 });
    deleteHandlesRef.current?.position({ x: 0, y: 0 });
    return true;
  };

  // Sync the transformer with the current selection.
  useEffect(() => {
    if (!interactive || !trRef.current || !layerRef.current) return;
    const tr = trRef.current;
    const layer = layerRef.current;
    const nodes: Konva.Node[] = [];
    for (const id of selectedIds) {
      const el = template.design.find((e) => e.id === id);
      if (!el) continue;
      // A single line is moved by dragging it directly — no transformer box.
      if (selectedIds.length === 1 && el.type === "line") continue;
      const n = layer.findOne(`#${id}`);
      if (n) nodes.push(n);
    }
    tr.nodes(nodes);
    const multi = selectedIds.length > 1;
    tr.resizeEnabled(!multi);
    tr.rotateEnabled(!multi);
    tr.getLayer()?.batchDraw();

    // On multi-select, outline each selected element individually (the transformer
    // only shows one box around the whole group).
    outlineGroupRef.current?.position({ x: 0, y: 0 });
    deleteHandlesRef.current?.position({ x: 0, y: 0 });
    if (multi) {
      const relativeTo = contentRef.current ?? undefined;
      const boxes = nodes.map((n) => {
        const r = n.getClientRect({ relativeTo });
        return { id: n.id(), x: r.x, y: r.y, width: r.width, height: r.height };
      });
      setSelectionBoxes(boxes);
    } else {
      setSelectionBoxes([]);
    }
    // `s` (zoom) is a dep so a zoom change re-syncs the transformer, recomputes the
    // outline boxes at the new scale, and clears any leftover handle translation.
  }, [selectedIds, interactive, template.design, s]);

  useEffect(() => {
    if (!alignGuides) {
      setGuides([]);
      setDragBadge(null);
    }
  }, [alignGuides]);


  // Any committed change (drag/transform end) retires the live badge.
  useEffect(() => {
    setDragBadge(null);
  }, [template.design]);

  /** Nearest snap target within `tol` px of `value`, or null. */
  const nearestTarget = (targets: number[], value: number, tol: number): number | null => {
    let best: number | null = null;
    let bestDist = tol + 0.001;
    for (const t of targets) {
      const d = Math.abs(t - value);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return best;
  };

  /**
   * Snaps the box edges being resized to the label/element guides (alignment ruler
   * on, unrotated single selection). Boxes are in content coordinates — the
   * transformer lives in the content group.
   */
  const snapResizeBox = (
    oldBox: { x: number; y: number; width: number; height: number; rotation: number },
    newBox: { x: number; y: number; width: number; height: number; rotation: number }
  ) => {
    if (Math.abs(newBox.rotation) > 0.001 || selectedIds.length !== 1) return newBox;
    const snapPx = 6;
    const { xTargets, yTargets } = getSnapTargets(selectedIds[0]);
    const box = { ...newBox };
    const newGuides: Guide[] = [];

    const leftMoved = Math.abs(newBox.x - oldBox.x) > 0.01;
    const rightMoved =
      Math.abs(newBox.x + newBox.width - (oldBox.x + oldBox.width)) > 0.01;
    const topMoved = Math.abs(newBox.y - oldBox.y) > 0.01;
    const bottomMoved =
      Math.abs(newBox.y + newBox.height - (oldBox.y + oldBox.height)) > 0.01;

    if (leftMoved && !rightMoved) {
      const t = nearestTarget(xTargets, box.x, snapPx);
      if (t !== null) {
        box.width += box.x - t;
        box.x = t;
        newGuides.push({ axis: "x", pos: t });
      }
    } else if (rightMoved && !leftMoved) {
      const t = nearestTarget(xTargets, box.x + box.width, snapPx);
      if (t !== null) {
        box.width = t - box.x;
        newGuides.push({ axis: "x", pos: t });
      }
    }

    if (topMoved && !bottomMoved) {
      const t = nearestTarget(yTargets, box.y, snapPx);
      if (t !== null) {
        box.height += box.y - t;
        box.y = t;
        newGuides.push({ axis: "y", pos: t });
      }
    } else if (bottomMoved && !topMoved) {
      const t = nearestTarget(yTargets, box.y + box.height, snapPx);
      if (t !== null) {
        box.height = t - box.y;
        newGuides.push({ axis: "y", pos: t });
      }
    }

    setGuides(newGuides);
    return box;
  };

  // Leaving the line tool (e.g. Escape) discards any unfinished draft.
  useEffect(() => {
    if (!drawing) {
      draftRef.current = null;
      setDraft(null);
    }
  }, [drawing]);

  // Finalize a line drawn with the mouse, even if released outside the label.
  useEffect(() => {
    if (!drawing) return;
    const up = () => {
      const d = draftRef.current;
      if (!d) return;
      draftRef.current = null;
      setDraft(null);
      if (Math.hypot(d[2] - d[0], d[3] - d[1]) > 3) {
        onDrawLine?.({ x: d[0] / s, y: d[1] / s }, { x: d[2] / s, y: d[3] / s });
      }
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [drawing, s, onDrawLine]);

  // Finalize a measurement on mouse release. The committed measurement stays on
  // screen (even after leaving the tool) until deleted via its X button.
  useEffect(() => {
    if (!measuring) {
      setMeasureDraft(null);
      measureDraftRef.current = null;
      return;
    }
    const up = () => {
      const d = measureDraftRef.current;
      if (!d) return;
      measureDraftRef.current = null;
      setMeasureDraft(null);
      // Store in mm (scale-independent) so it stays put when zooming.
      if (Math.hypot(d[2] - d[0], d[3] - d[1]) > 3) {
        setMeasure([d[0] / s, d[1] / s, d[2] / s, d[3] / s]);
      }
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [measuring, s]);

  // Finalize a marquee selection on mouse release.
  useEffect(() => {
    const up = () => {
      if (!marqueeRef.current) return;
      marqueeRef.current = false;
      setMarqueeRect((r) => {
        if (r && Math.hypot(r[2] - r[0], r[3] - r[1]) > 3 && layerRef.current) {
          const box: Box = {
            x: Math.min(r[0], r[2]),
            y: Math.min(r[1], r[3]),
            w: Math.abs(r[2] - r[0]),
            h: Math.abs(r[3] - r[1]),
          };
          const ids: string[] = [];
          const relativeTo = contentRef.current ?? undefined;
          for (const el of template.design) {
            const n = layerRef.current.findOne(`#${el.id}`);
            if (n && boxContains(box, n.getClientRect({ relativeTo }))) ids.push(el.id);
          }
          onSelectMany?.(ids);
        }
        return null;
      });
    };
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [template.design, onSelectMany]);

  /** Top-right corner position for the delete ("X") button of an element. */
  const deleteHandlePosition = (el: LabelElement): { x: number; y: number } => {
    if (el.type === "line") {
      return { x: Math.max(el.x, el.x2) * s + 4, y: Math.min(el.y, el.y2) * s - 22 };
    }
    // text / image / rect / code all carry a width.
    return { x: (el.x + el.width) * s + 4, y: el.y * s - 22 };
  };

  return (
    <Stage
      ref={stageRef}
      width={w + pad * 2}
      height={h + pad * 2}
      onMouseDown={(e) => {
        const stage = e.target.getStage();
        if (!stage) return;
        const p = contentPointer(stage);
        if (drawing) {
          if (p) {
            const d: [number, number, number, number] = [p.x, p.y, p.x, p.y];
            draftRef.current = d;
            setDraft(d);
          }
          return;
        }
        if (measuring) {
          if (p) {
            const d: [number, number, number, number] = [p.x, p.y, p.x, p.y];
            measureDraftRef.current = d;
            setMeasureDraft(d);
            setMeasure(null);
          }
          return;
        }
        // Dragging on the empty label starts a marquee selection.
        if (interactive && e.target === stage) {
          if (!e.evt?.shiftKey) onSelect?.(null);
          if (p) {
            marqueeRef.current = true;
            setMarqueeRect([p.x, p.y, p.x, p.y]);
          }
        }
      }}
      onMouseMove={(e) => {
        const stage = e.target.getStage();
        const p = stage ? contentPointer(stage) : null;
        if (!p) return;
        if (drawing && draftRef.current) {
          const d = snapDraftLine([draftRef.current[0], draftRef.current[1], p.x, p.y]);
          draftRef.current = d;
          setDraft(d);
        } else if (measuring && measureDraftRef.current) {
          const d = snapDraftLine([measureDraftRef.current[0], measureDraftRef.current[1], p.x, p.y]);
          measureDraftRef.current = d;
          setMeasureDraft(d);
        } else if (marqueeRef.current) setMarqueeRect((r) => (r ? [r[0], r[1], p.x, p.y] : r));
      }}
    >
      <Layer ref={layerRef}>
        <Group ref={contentRef} x={pad} y={pad}>
        <Rect
          x={0}
          y={0}
          width={w}
          height={h}
          fill="#ffffff"
          stroke="#d0d0d0"
          strokeWidth={1}
          listening={false}
          shadowColor="#000000"
          shadowBlur={24}
          shadowOpacity={0.18}
          shadowOffsetY={6}
        />
        {template.design.map((el) => {
          const draggable = interactive && !drawing && !measuring;
          if (el.type === "text") {
            const t = el as TextElement;
            return (
              <Text
                key={t.id}
                id={t.id}
                text={resolveText(t, template, label)}
                x={t.x * s}
                y={t.y * s}
                width={t.width * s}
                fontSize={t.fontSize * s}
                fontFamily={t.fontFamily}
                fontStyle={t.fontStyle}
                align={t.align}
                fill={t.fill}
                opacity={interactive && isDateFieldKey(t.fieldKey) ? 0.45 : 1}
                rotation={t.rotation || 0}
                draggable={draggable}
                onMouseDown={(e) => onElementMouseDown(t.id, e)}
                onTap={() => onSelect?.(t.id)}
                onDblClick={(e) =>
                  interactive &&
                  !isDateFieldKey(t.fieldKey) &&
                  !isProductFieldKey(t.fieldKey) &&
                  startTextEditFor(e.target as Konva.Text)
                }
                onDblTap={(e) =>
                  interactive &&
                  !isDateFieldKey(t.fieldKey) &&
                  !isProductFieldKey(t.fieldKey) &&
                  startTextEditFor(e.target as Konva.Text)
                }
                onDragStart={() => handleDragStart(t.id)}
                onDragMove={(e) => handleDragMove(t.id, e.target)}
                onDragEnd={(e) => {
                  if (handleGroupDragEnd(t.id, e.target)) return;
                  setGuides([]);
                  onChange?.(t.id, { x: e.target.x() / s, y: e.target.y() / s });
                }}
                // Bake the live scale into the box width so the text reflows while
                // dragging the handles instead of stretching like an image.
                onTransform={(e) => {
                  const node = e.target as Konva.Text;
                  node.width(Math.max(5, node.width() * node.scaleX()));
                  node.scaleX(1);
                  node.scaleY(1);
                }}
                onTransformEnd={(e) => {
                  const node = e.target as Konva.Text;
                  node.scaleX(1);
                  node.scaleY(1);
                  onChange?.(t.id, {
                    x: node.x() / s,
                    y: node.y() / s,
                    width: Math.max(5, node.width() / s),
                    rotation: node.rotation(),
                  });
                }}
              />
            );
          }
          if (el.type === "line") {
            const ln = el as LineElement;
            return (
              <Line
                key={ln.id}
                id={ln.id}
                points={[ln.x * s, ln.y * s, ln.x2 * s, ln.y2 * s]}
                stroke={ln.fill}
                strokeWidth={Math.max(1, ln.thickness * s)}
                lineCap="round"
                hitStrokeWidth={Math.max(12, ln.thickness * s)}
                draggable={draggable}
                onMouseDown={(e) => onElementMouseDown(ln.id, e)}
                onTap={() => onSelect?.(ln.id)}
                onDragStart={() => handleDragStart(ln.id)}
                onDragMove={(e) => handleDragMove(ln.id, e.target)}
                onDragEnd={(e) => {
                  if (handleGroupDragEnd(ln.id, e.target)) return;
                  setGuides([]);
                  const node = e.target;
                  const dx = node.x() / s;
                  const dy = node.y() / s;
                  node.position({ x: 0, y: 0 });
                  onChange?.(ln.id, {
                    x: ln.x + dx,
                    y: ln.y + dy,
                    x2: ln.x2 + dx,
                    y2: ln.y2 + dy,
                  });
                }}
              />
            );
          }
          if (el.type === "rect") {
            const r = el as RectElement;
            return (
              <Rect
                key={r.id}
                id={r.id}
                x={r.x * s}
                y={r.y * s}
                width={r.width * s}
                height={r.height * s}
                cornerRadius={(r.cornerRadius || 0) * s}
                stroke={r.stroke}
                strokeWidth={Math.max(1, r.thickness * s)}
                fillEnabled={false}
                hitStrokeWidth={Math.max(12, r.thickness * s)}
                rotation={r.rotation || 0}
                draggable={draggable}
                onMouseDown={(e) => onElementMouseDown(r.id, e)}
                onTap={() => onSelect?.(r.id)}
                onDragStart={() => handleDragStart(r.id)}
                onDragMove={(e) => handleDragMove(r.id, e.target)}
                onDragEnd={(e) => {
                  if (handleGroupDragEnd(r.id, e.target)) return;
                  setGuides([]);
                  onChange?.(r.id, { x: e.target.x() / s, y: e.target.y() / s });
                }}
                // Bake the live scale into width/height so the stroke (and corner
                // radius) keep their thickness instead of stretching with the resize.
                onTransform={(e) => {
                  const node = e.target as Konva.Rect;
                  node.width(Math.max(2, node.width() * node.scaleX()));
                  node.height(Math.max(2, node.height() * node.scaleY()));
                  node.scaleX(1);
                  node.scaleY(1);
                }}
                onTransformEnd={(e) => {
                  const node = e.target as Konva.Rect;
                  const sx = node.scaleX();
                  const sy = node.scaleY();
                  node.scaleX(1);
                  node.scaleY(1);
                  onChange?.(r.id, {
                    x: node.x() / s,
                    y: node.y() / s,
                    width: Math.max(2, (node.width() * sx) / s),
                    height: Math.max(2, (node.height() * sy) / s),
                    rotation: node.rotation(),
                  });
                }}
              />
            );
          }
          if (el.type === "code") {
            return (
              <CodeNode
                key={el.id}
                el={el as CodeElement}
                s={s}
                label={label}
                draggable={draggable}
                onMouseDownNode={(e) => onElementMouseDown(el.id, e)}
                onDragStart={() => handleDragStart(el.id)}
                onDragMove={(node) => handleDragMove(el.id, node)}
                onDragEnd={(node) => {
                  if (handleGroupDragEnd(el.id, node)) return;
                  setGuides([]);
                  onChange?.(el.id, { x: node.x() / s, y: node.y() / s });
                }}
                onResize={(patch) => onChange?.(el.id, patch)}
              />
            );
          }
          return (
            <ImageNode
              key={el.id}
              el={el as ImageElement}
              s={s}
              draggable={draggable}
              onMouseDownNode={(e) => onElementMouseDown(el.id, e)}
              onDragStart={() => handleDragStart(el.id)}
              onDragMove={(node) => handleDragMove(el.id, node)}
              onDragEnd={(node) => {
                if (handleGroupDragEnd(el.id, node)) return;
                setGuides([]);
                onChange?.(el.id, { x: node.x() / s, y: node.y() / s });
              }}
              onResize={(patch) => onChange?.(el.id, patch)}
            />
          );
        })}
        {guides.map((guide, index) => {
          // Label centre lines get the accent colour; other guides stay pink.
          // Guides span the whole work area, not just the label.
          const isCenter =
            guide.axis === "x"
              ? Math.abs(guide.pos - w / 2) < 0.5
              : Math.abs(guide.pos - h / 2) < 0.5;
          const stroke = isCenter ? "#2f6fed" : "#f044b5";
          return guide.axis === "x" ? (
            <Line
              key={`guide-${index}`}
              points={[guide.pos, -pad, guide.pos, h + pad]}
              stroke={stroke}
              strokeWidth={1}
              dash={[5, 4]}
              listening={false}
            />
          ) : (
            <Line
              key={`guide-${index}`}
              points={[-pad, guide.pos, w + pad, guide.pos]}
              stroke={stroke}
              strokeWidth={1}
              dash={[5, 4]}
              listening={false}
            />
          );
        })}
        {dragBadge && (
          <Group listening={false} x={dragBadge.x} y={Math.max(-pad + 4, dragBadge.y)}>
            <Rect
              width={dragBadge.text.length * 6.4 + 12}
              height={18}
              cornerRadius={4}
              fill="#2f6fed"
              opacity={0.95}
            />
            <Text
              x={6}
              y={0}
              height={18}
              verticalAlign="middle"
              text={dragBadge.text}
              fill="#ffffff"
              fontSize={11}
              fontStyle="bold"
            />
          </Group>
        )}
        {interactive && (
          <Group ref={outlineGroupRef} listening={false}>
            {selectionBoxes.map((b) => (
              <Rect
                key={`outline-${b.id}`}
                x={b.x}
                y={b.y}
                width={b.width}
                height={b.height}
                stroke="#2f6fed"
                strokeWidth={1}
                dash={[4, 3]}
                listening={false}
              />
            ))}
          </Group>
        )}
        {interactive && onRemove && (
          <Group ref={deleteHandlesRef}>
            {selectedIds.map((id) => {
              const el = template.design.find((item) => item.id === id);
              if (!el) return null;
              const pos = deleteHandlePosition(el);
              return (
                <DeleteHandle key={`del-${id}`} x={pos.x} y={pos.y} onRemove={() => onRemove(id)} />
              );
            })}
          </Group>
        )}
        {interactive &&
          selectedIds.map((id) => {
            const el = template.design.find((item) => item.id === id);
            if (!el || el.type !== "line") return null;
            return (
              <LineEndpointHandles
                key={`line-handles-${id}`}
                line={el as LineElement}
                s={s}
                snapPoint={(x, y) => snapPoint(id, x, y)}
                onChange={(patch) => onChange?.(id, patch)}
                onDone={() => setGuides([])}
              />
            );
          })}
        {draft && (
          <Line points={draft} stroke="#2f6fed" strokeWidth={2} dash={[6, 4]} lineCap="round" />
        )}
        {measureDraft && (
          <>
            <MeasureGraphic m={measureDraft} s={s} />
            <Circle x={measureDraft[0]} y={measureDraft[1]} radius={3.5} fill="#0a7d33" listening={false} />
            <Circle x={measureDraft[2]} y={measureDraft[3]} radius={3.5} fill="#0a7d33" listening={false} />
          </>
        )}
        {measure && !measureDraft && (() => {
          // Committed measurement: endpoints stay draggable for fine adjustment and
          // the X button removes it.
          const mPx: [number, number, number, number] = [
            measure[0] * s,
            measure[1] * s,
            measure[2] * s,
            measure[3] * s,
          ];
          const distLabel = `${(Math.hypot(mPx[2] - mPx[0], mPx[3] - mPx[1]) / s).toFixed(1)} mm`;
          const lw = distLabel.length * 7 + 14;
          const midX = (mPx[0] + mPx[2]) / 2;
          const midY = (mPx[1] + mPx[3]) / 2;
          const stopBubble = (e: Konva.KonvaEventObject<Event>) => {
            e.cancelBubble = true;
          };
          return (
            <>
              <MeasureGraphic m={mPx} s={s} />
              <Circle
                x={mPx[0]}
                y={mPx[1]}
                radius={5.5}
                fill="#ffffff"
                stroke="#0a7d33"
                strokeWidth={2}
                draggable
                onMouseDown={stopBubble}
                onTap={stopBubble}
                onDragMove={(e) =>
                  setMeasure((prev) =>
                    prev ? [e.target.x() / s, e.target.y() / s, prev[2], prev[3]] : prev
                  )
                }
              />
              <Circle
                x={mPx[2]}
                y={mPx[3]}
                radius={5.5}
                fill="#ffffff"
                stroke="#0a7d33"
                strokeWidth={2}
                draggable
                onMouseDown={stopBubble}
                onTap={stopBubble}
                onDragMove={(e) =>
                  setMeasure((prev) =>
                    prev ? [prev[0], prev[1], e.target.x() / s, e.target.y() / s] : prev
                  )
                }
              />
              <DeleteHandle x={midX + lw / 2 + 6} y={midY - 23} onRemove={() => setMeasure(null)} />
            </>
          );
        })()}
        {marqueeRect && (
          <Rect
            x={Math.min(marqueeRect[0], marqueeRect[2])}
            y={Math.min(marqueeRect[1], marqueeRect[3])}
            width={Math.abs(marqueeRect[2] - marqueeRect[0])}
            height={Math.abs(marqueeRect[3] - marqueeRect[1])}
            fill="rgba(47,111,237,0.12)"
            stroke="#2f6fed"
            strokeWidth={1}
            dash={[4, 3]}
          />
        )}
        {interactive && (
          <Transformer
            ref={trRef}
            rotateEnabled
            keepRatio={transformerKeepRatio}
            // Proportional lock: side anchors would stretch one axis only, so hide them.
            enabledAnchors={
              transformerKeepRatio
                ? ["top-left", "top-right", "bottom-left", "bottom-right"]
                : undefined
            }
            // With the ruler on, snap rotation to right angles so objects keep a
            // straight orientation instead of ending up slightly tilted.
            rotationSnaps={alignGuides ? [0, 90, 180, 270] : []}
            rotationSnapTolerance={alignGuides ? 12 : 5}
            // Konva applies (and clears) this cursor itself on hover of the handle.
            rotateAnchorCursor={ROTATE_CURSOR}
            // The rotation handle reads as a round blue knob; resize anchors stay square.
            anchorStyleFunc={(anchor) => {
              if (anchor.hasName("rotater")) {
                anchor.cornerRadius(10);
                anchor.fill("#2f6fed");
                anchor.stroke("#ffffff");
                anchor.strokeWidth(2);
              }
            }}
            onTransform={() => {
              if (!alignGuides || !contentRef.current) return;
              const node = trRef.current?.nodes()[0];
              if (!node) return;
              const box = node.getClientRect({ relativeTo: contentRef.current });
              setDragBadge({
                x: box.x,
                y: box.y - 26,
                text: `${(box.width / s).toFixed(1)} × ${(box.height / s).toFixed(1)} mm`,
              });
            }}
            onTransformEnd={() => {
              setDragBadge(null);
              setGuides([]);
            }}
            boundBoxFunc={(oldBox, newBox) => {
              // Don't let a resize collapse or flip the element.
              if (newBox.width < 4 || newBox.height < 4) return oldBox;
              // Edge snapping would break the proportional lock, so skip it here.
              if (transformerKeepRatio) return newBox;
              return alignGuides ? snapResizeBox(oldBox, newBox) : newBox;
            }}
          />
        )}
        </Group>
      </Layer>
    </Stage>
  );

  // --- inline text editor ---
  function startTextEditFor(node: Konva.Text) {
    const stage = node.getStage();
    if (!stage) return;
    const id = node.id();

    node.hide();
    trRef.current?.hide();
    layerRef.current?.batchDraw();

    const pos = node.absolutePosition();
    const box = stage.container().getBoundingClientRect();
    const area = document.createElement("textarea");
    document.body.appendChild(area);
    area.value = node.text();

    Object.assign(area.style, {
      position: "absolute",
      top: `${box.top + window.scrollY + pos.y}px`,
      left: `${box.left + window.scrollX + pos.x}px`,
      width: `${node.width()}px`,
      fontSize: `${node.fontSize()}px`,
      fontFamily: node.fontFamily(),
      fontStyle: node.fontStyle().includes("italic") ? "italic" : "normal",
      fontWeight: node.fontStyle().includes("bold") ? "bold" : "normal",
      lineHeight: String(node.lineHeight()),
      textAlign: node.align(),
      color: node.fill() as string,
      border: "1px solid #2f6fed",
      borderRadius: "2px",
      padding: "0",
      margin: "0",
      overflow: "hidden",
      background: "#fff",
      outline: "none",
      resize: "none",
      lineBreak: "anywhere",
      transformOrigin: "left top",
      transform: node.rotation() ? `rotate(${node.rotation()}deg)` : "",
      zIndex: "1000",
    } as CSSStyleDeclaration);

    const autoHeight = () => {
      area.style.height = "auto";
      area.style.height = `${area.scrollHeight}px`;
    };
    autoHeight();
    area.focus();
    area.select();

    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      if (commit && area.value !== node.text()) onChange?.(id, { text: area.value });
      area.remove();
      node.show();
      trRef.current?.show();
      layerRef.current?.batchDraw();
      window.removeEventListener("pointerdown", onOutside, true);
    };
    const onOutside = (e: PointerEvent) => {
      if (e.target !== area) finish(true);
    };

    area.addEventListener("input", autoHeight);
    area.addEventListener("keydown", (e) => {
      // Enter inserts a line break; Ctrl+Enter commits, Esc cancels (click outside commits).
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        finish(false);
      }
    });
    setTimeout(() => window.addEventListener("pointerdown", onOutside, true), 0);
  }
}
