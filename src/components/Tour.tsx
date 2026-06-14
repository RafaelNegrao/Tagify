import { useEffect, useState } from "react";
import { useStore } from "../store/useStore";

export const TOUR_SEEN_KEY = "etiquetas:tourSeen";

interface Step {
  /** CSS selector of the element to highlight; omit for a centered welcome card. */
  selector?: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    title: "Bem-vindo ao Tagify 👋",
    body: "Um tour rápido para você conhecer as áreas principais. Leva menos de um minuto.",
  },
  {
    selector: '[data-tour="tab-lote"]',
    title: "Lote",
    body: "Cadastre vários produtos com quantidade e imprima tudo de uma vez. É por onde você começa no dia a dia.",
  },
  {
    selector: '[data-tour="tab-canva"]',
    title: "Canva",
    body: "Monte o desenho da etiqueta: textos, datas, logo, linhas e retângulos. Arraste e edite à vontade.",
  },
  {
    selector: '[data-tour="tab-produtos"]',
    title: "Lista de produtos",
    body: "Cadastre os nomes dos produtos que aparecem nas etiquetas e na seleção do Lote.",
  },
  {
    selector: '[data-tour="tab-timeline"]',
    title: "Histórico",
    body: "Acompanhe quantas etiquetas você imprimiu ao longo do tempo, num gráfico por dia ou por mês.",
  },
  {
    selector: ".canvas-area",
    title: "Pré-visualização",
    body: "Aqui você vê a etiqueta. No Canva, os elementos são arrastados e ajustados nesta área.",
  },
  {
    selector: ".sidebar",
    title: "Painel de controle",
    body: "O painel da área atual. No Lote, monte os itens e dispare a impressão por aqui.",
  },
  {
    selector: '[data-tour="settings"]',
    title: "Configurações",
    body: "Escolha a impressora, preferências e gerencie sua licença. Você pode rever este tour aqui quando quiser.",
  },
];

const POPOVER_W = 320;
const POPOVER_H_EST = 180; // rough height used only to decide above/below placement

export default function Tour() {
  const tourOpen = useStore((s) => s.tourOpen);
  const closeTour = useStore((s) => s.closeTour);

  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const step = STEPS[i];

  useEffect(() => {
    if (tourOpen) setI(0);
  }, [tourOpen]);

  useEffect(() => {
    if (!tourOpen) return;
    const measure = () => {
      if (!step?.selector) {
        setRect(null);
        return;
      }
      const el = document.querySelector(step.selector) as HTMLElement | null;
      el?.scrollIntoView({ block: "nearest", inline: "nearest" });
      setRect(el ? el.getBoundingClientRect() : null);
    };
    // Measure now and shortly after, to catch layout settling.
    measure();
    const t = setTimeout(measure, 120);
    window.addEventListener("resize", measure);
    return () => {
      clearTimeout(t);
      window.removeEventListener("resize", measure);
    };
  }, [tourOpen, i, step]);

  if (!tourOpen) return null;

  const finish = () => {
    localStorage.setItem(TOUR_SEEN_KEY, "1");
    closeTour();
  };
  const next = () => (i < STEPS.length - 1 ? setI(i + 1) : finish());
  const prev = () => setI(Math.max(0, i - 1));

  const pad = 8;
  const spot = rect
    ? {
        left: rect.left - pad,
        top: rect.top - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  let popStyle: React.CSSProperties;
  if (!rect) {
    popStyle = { left: "50%", top: "50%", transform: "translate(-50%, -50%)", width: POPOVER_W };
  } else {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const placeBelow = rect.bottom + 12 + POPOVER_H_EST < vh;
    const top = placeBelow ? rect.bottom + 12 : Math.max(12, rect.top - 12 - POPOVER_H_EST);
    let left = rect.left + rect.width / 2 - POPOVER_W / 2;
    left = Math.min(Math.max(12, left), vw - POPOVER_W - 12);
    popStyle = { left, top, width: POPOVER_W };
  }

  const last = i === STEPS.length - 1;

  return (
    <div className="tour-overlay" style={{ background: rect ? "transparent" : "rgba(15,20,30,.62)" }}>
      {spot && <div className="tour-spotlight" style={spot} />}
      <div className="tour-popover" style={popStyle}>
        <div className="tour-count">
          {i + 1} de {STEPS.length}
        </div>
        <h3 className="tour-title">{step.title}</h3>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button className="tour-skip" onClick={finish}>
            Pular
          </button>
          <div className="tour-nav">
            {i > 0 && (
              <button className="btn" onClick={prev}>
                Voltar
              </button>
            )}
            <button className="btn btn-primary" onClick={next}>
              {last ? "Concluir" : "Próximo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
