import { LABEL_SIZE_GROUPS } from "../constants";

interface Props {
  width_mm: number;
  height_mm: number;
  onChange: (width_mm: number, height_mm: number) => void;
}

export default function SizeSelector({ width_mm, height_mm, onChange }: Props) {
  const value = `${width_mm}x${height_mm}`;
  const known = LABEL_SIZE_GROUPS.some((g) =>
    g.sizes.some((s) => `${s.width_mm}x${s.height_mm}` === value)
  );
  const setDimension = (nextWidth: number, nextHeight: number) => {
    if (Number.isFinite(nextWidth) && Number.isFinite(nextHeight) && nextWidth > 0 && nextHeight > 0) {
      onChange(nextWidth, nextHeight);
    }
  };

  return (
    <>
      <select
        className="field-control"
        value={known ? value : ""}
        onChange={(e) => {
          const [w, h] = e.target.value.split("x").map(Number);
          if (w && h) onChange(w, h);
        }}
      >
        {!known && <option value="">Personalizado ({value} mm)</option>}
        {LABEL_SIZE_GROUPS.map((group) => (
          <optgroup key={group.group} label={group.group}>
            {group.sizes.map((s) => (
              <option key={s.label} value={`${s.width_mm}x${s.height_mm}`}>
                {s.label}
                {s.note ? ` - ${s.note}` : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      <div className="grid2 mt8">
        <div>
          <label className="field-label">Largura (mm)</label>
          <input
            className="field-control"
            type="number"
            min={1}
            step={0.1}
            value={width_mm}
            onChange={(e) => setDimension(Number(e.target.value), height_mm)}
          />
        </div>
        <div>
          <label className="field-label">Altura (mm)</label>
          <input
            className="field-control"
            type="number"
            min={1}
            step={0.1}
            value={height_mm}
            onChange={(e) => setDimension(width_mm, Number(e.target.value))}
          />
        </div>
      </div>
    </>
  );
}
