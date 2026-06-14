import type { LabelSizeGroup } from "./types";

// Default thermal-printer label sizes, grouped by use case.
export const LABEL_SIZE_GROUPS: LabelSizeGroup[] = [
  {
    group: "Logística e E-commerce",
    sizes: [
      { label: "100 × 150 mm", width_mm: 100, height_mm: 150, note: "Declaração de conteúdo / envio" },
      { label: "100 × 100 mm", width_mm: 100, height_mm: 100 },
    ],
  },
  {
    group: "Comércio, Gôndolas e Balanças",
    sizes: [
      { label: "60 × 40 mm", width_mm: 60, height_mm: 40 },
      { label: "40 × 25 mm", width_mm: 40, height_mm: 25 },
      { label: "50 × 25 mm", width_mm: 50, height_mm: 25 },
    ],
  },
  {
    group: "Laboratórios e Identificação",
    sizes: [
      { label: "34 × 23 mm", width_mm: 34, height_mm: 23, note: "Várias colunas" },
      { label: "80 × 50 mm", width_mm: 80, height_mm: 50 },
    ],
  },
];

// Screen rendering: px per mm. The canvas auto-fits within this ceiling.
export const MAX_SCREEN_PX_PER_MM = 6;
// Transparent margin (screen px) around the label inside the Konva stage, so the
// transformer handles and rotation knob aren't clipped when an element sits at the edge.
// Used in non-editing (preview/print) contexts where the label fills the stage tightly.
export const STAGE_PAD = 28;
export const WORK_MARGIN_MM = 40;
// Target print resolution in DPI (dots per inch) for the rasterized label.
export const PRINT_DPI = 300;
export const MM_PER_INCH = 25.4;
