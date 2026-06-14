// All geometry is stored in millimeters (mm) so it is resolution-independent.
// Rendering multiplies by a px-per-mm scale for screen, and a higher one for print.

export type FieldScope = "shared" | "individual";

export interface BaseElement {
  id: string;
  type: "text" | "image" | "line" | "rect" | "code";
  x: number; // mm
  y: number; // mm
  rotation?: number; // degrees
  /** When set, this element is a dynamic field whose value can vary. */
  fieldKey?: string;
  /** shared = same for every label of the template; individual = per-label. */
  scope?: FieldScope;
}

export interface TextElement extends BaseElement {
  type: "text";
  text: string; // default/static text (used as fallback for fields)
  fontSize: number; // mm (cap height-ish)
  fontFamily: string;
  fontStyle: string; // "normal" | "bold" | "italic" | "bold italic"
  align: "left" | "center" | "right";
  width: number; // mm (text box width)
  fill: string;
}

export interface ImageElement extends BaseElement {
  type: "image";
  src: string; // data URL
  width: number; // mm
  height: number; // mm
  /** Resize proportionally: width and height keep their ratio (canvas and panel). */
  keepRatio?: boolean;
}

export interface LineElement extends BaseElement {
  type: "line";
  // (x, y) is point A; (x2, y2) is point B — both in mm.
  x2: number;
  y2: number;
  thickness: number; // mm (stroke thickness / grossura)
  fill: string;
}

export interface RectElement extends BaseElement {
  type: "rect";
  width: number; // mm
  height: number; // mm
  thickness: number; // mm (stroke thickness / grossura da borda)
  stroke: string; // border color
  cornerRadius: number; // mm
}

export type CodeKind = "barcode" | "qrcode";
export type CodeSymbology = "CODE128" | "EAN13";

export interface CodeElement extends BaseElement {
  type: "code";
  kind: CodeKind;
  /** Barcode symbology; ignored for QR codes. */
  symbology: CodeSymbology;
  width: number; // mm
  height: number; // mm
  /** Resize proportionally: width and height keep their ratio (canvas and panel). */
  keepRatio?: boolean;
}

export type LabelElement = TextElement | ImageElement | LineElement | RectElement | CodeElement;

export interface Template {
  id: string;
  name: string;
  width_mm: number;
  height_mm: number;
  design: LabelElement[];
  sharedValues: Record<string, string>;
  /** fieldKey of the individual field filled with the product name (Lista Produtos). */
  productField?: string;
  created_at?: string;
  updated_at?: string;
}

/** A product is just a name; it feeds the iterable item lists in Lote/Individual. */
export interface Product {
  id: string;
  name: string;
  /** Value encoded by a barcode element when this product is selected. */
  barcode?: string;
  /** Value encoded by a QR code element when this product is selected. */
  qrcode?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Client {
  id: string;
  name: string;
  printEnabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface LabelInstance {
  id: string;
  template_id: string;
  name: string;
  values: Record<string, string>; // individual field values
  created_at?: string;
  updated_at?: string;
}

export interface LabelSize {
  label: string;
  width_mm: number;
  height_mm: number;
  note?: string;
}

export interface LabelSizeGroup {
  group: string;
  sizes: LabelSize[];
}
