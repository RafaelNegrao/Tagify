import { useEffect, useState } from "react";
import { MAX_SCREEN_PX_PER_MM } from "../constants";

/** Compute a px-per-mm scale so a (width_mm × height_mm) label fits its container. */
export function useFitScale(
  ref: React.RefObject<HTMLElement | null>,
  width_mm: number,
  height_mm: number,
  padding = 32
): number {
  const [scale, setScale] = useState(MAX_SCREEN_PX_PER_MM);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const compute = () => {
      const availW = el.clientWidth - padding;
      const availH = el.clientHeight - padding;
      if (availW <= 0 || availH <= 0) return;
      const fit = Math.min(availW / width_mm, availH / height_mm, MAX_SCREEN_PX_PER_MM);
      setScale(Math.max(1, fit));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, width_mm, height_mm, padding]);

  return scale;
}
