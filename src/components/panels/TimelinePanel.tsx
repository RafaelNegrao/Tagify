import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "../../store/useStore";
import type { PrintHistoryEntry } from "../../db";

type Granularity = "day" | "month";

const MONTHS_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

interface Bucket {
  key: string;
  label: string;
  sublabel: string;
  quantity: number;
  full: string;
}

/** Group entries into day or month buckets, summing label quantities, sorted ascending. */
function aggregate(entries: PrintHistoryEntry[], granularity: Granularity): Bucket[] {
  const sums = new Map<string, number>();
  for (const e of entries) {
    // printed_at is local "YYYY-MM-DD HH:MM:SS"; slicing avoids timezone shifts.
    const key = granularity === "day" ? e.printed_at.slice(0, 10) : e.printed_at.slice(0, 7);
    sums.set(key, (sums.get(key) ?? 0) + e.quantity);
  }
  return [...sums.keys()]
    .sort()
    .map((key) => {
      const quantity = sums.get(key) ?? 0;
      if (granularity === "day") {
        const [y, m, d] = key.split("-");
        return {
          key,
          label: `${d}/${m}`,
          sublabel: "",
          quantity,
          full: `${d}/${m}/${y}`,
        };
      }
      const [y, m] = key.split("-");
      return {
        key,
        label: MONTHS_PT[Number(m) - 1] ?? m,
        sublabel: y,
        quantity,
        full: `${MONTHS_PT[Number(m) - 1] ?? m}/${y}`,
      };
    });
}

export default function TimelinePanel() {
  const printHistory = useStore((s) => s.printHistory);
  const loadPrintHistory = useStore((s) => s.loadPrintHistory);
  const clearPrintHistory = useStore((s) => s.clearPrintHistory);
  const showToast = useStore((s) => s.showToast);
  const [granularity, setGranularity] = useState<Granularity>("day");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadPrintHistory();
  }, [loadPrintHistory]);

  const buckets = useMemo(() => aggregate(printHistory, granularity), [printHistory, granularity]);
  const total = useMemo(() => printHistory.reduce((sum, e) => sum + e.quantity, 0), [printHistory]);
  const max = useMemo(() => Math.max(1, ...buckets.map((b) => b.quantity)), [buckets]);

  // Keep the newest bucket in view (timeline flows left → right, latest on the right).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [buckets]);

  const onClear = async () => {
    try {
      await clearPrintHistory();
      showToast("Histórico de impressão limpo.", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : String(err), "error");
    }
  };

  return (
    <section className="timeline-page">
      <div className="timeline-shell">
        <header className="timeline-heading">
          <div className="timeline-heading-main">
            <h1>Linha do tempo</h1>
            <span className="timeline-total" title="Total de etiquetas impressas">
              {total.toLocaleString("pt-BR")} etiqueta{total === 1 ? "" : "s"}
            </span>
          </div>

          <div className="timeline-controls">
            <div className="timeline-seg">
              <button
                className={`timeline-seg-btn ${granularity === "day" ? "active" : ""}`}
                onClick={() => setGranularity("day")}
              >
                Dia
              </button>
              <button
                className={`timeline-seg-btn ${granularity === "month" ? "active" : ""}`}
                onClick={() => setGranularity("month")}
              >
                Mês
              </button>
            </div>
            {printHistory.length > 0 && (
              <button className="btn" onClick={onClear} title="Apagar todo o histórico">
                Limpar
              </button>
            )}
          </div>
        </header>

        {buckets.length === 0 ? (
          <div className="timeline-empty">
            <TimelineIcon size={40} />
            <p>Nenhuma impressão registrada ainda.</p>
            <span>Os lotes que você imprimir aparecem aqui ao longo do tempo.</span>
          </div>
        ) : (
          <div className="timeline-chart" ref={scrollRef}>
            <div className="timeline-track">
              {buckets.map((b) => (
                <div className="tl-col" key={b.key} title={`${b.full}: ${b.quantity} etiqueta(s)`}>
                  <div className="tl-bar-area">
                    <span className="tl-count">{b.quantity}</span>
                    <div
                      className="tl-bar"
                      style={{ height: `${Math.max(3, (b.quantity / max) * 88)}%` }}
                    />
                  </div>
                  <div className="tl-foot">
                    <span className="tl-xlabel">{b.label}</span>
                    {b.sublabel && <span className="tl-xsub">{b.sublabel}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function TimelineIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="3" y1="21" x2="21" y2="21" />
      <rect x="5" y="11" width="3.2" height="7" rx="1" />
      <rect x="10.4" y="7" width="3.2" height="11" rx="1" />
      <rect x="15.8" y="14" width="3.2" height="4" rx="1" />
    </svg>
  );
}
