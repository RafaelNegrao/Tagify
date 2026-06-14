import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useStore, type Tab } from "./store/useStore";
import CanvasArea from "./components/CanvasArea";
import CanvaPanel from "./components/panels/CanvaPanel";
import ProductsPanel from "./components/panels/ProductsPanel";
import LotePanel from "./components/panels/LotePanel";
import TimelinePanel from "./components/panels/TimelinePanel";
import SettingsPanel from "./components/panels/SettingsPanel";
import Toast from "./components/Toast";
import ActivationScreen from "./components/ActivationScreen";
import Tour, { TOUR_SEEN_KEY } from "./components/Tour";
import { fetchLicenseStatus, revalidateStored } from "./license";
import { checkUpdate, type UpdateInfo } from "./updater";
import UpdateGate from "./components/UpdateGate";
import "./App.css";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "lote", label: "Lote", icon: <LoteIcon /> },
  { id: "canva", label: "Canva", icon: <CanvaIcon /> },
  { id: "produtos", label: "Lista", icon: <ProductsIcon /> },
  { id: "timeline", label: "Histórico", icon: <TimelineIcon /> },
];

const SETTINGS_TAB: { id: Tab; label: string; icon: ReactNode } = {
  id: "settings",
  label: "Settings",
  icon: <SettingsIcon />,
};

const SIDEBAR_MIN = 280;
const SIDEBAR_MAX = 640;
const SIDEBAR_W_KEY = "etiquetas:sidebarW";

function loadSidebarW(): number {
  const raw = Number(localStorage.getItem(SIDEBAR_W_KEY));
  if (!Number.isFinite(raw) || raw <= 0) return 420;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, raw));
}

export default function App() {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  return <MainApp appWindow={appWindow} />;
}

function MainApp({ appWindow }: { appWindow: ReturnType<typeof getCurrentWindow> }) {
  const tab = useStore((s) => s.tab);
  const setTab = useStore((s) => s.setTab);
  const loadAll = useStore((s) => s.loadAll);
  const loadPrinters = useStore((s) => s.loadPrinters);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const openTour = useStore((s) => s.openTour);

  const [sidebarW, setSidebarW] = useState(loadSidebarW);
  const [collapsed, setCollapsed] = useState(false);
  const resizing = useRef(false);

  const license = useStore((s) => s.license);
  const setLicense = useStore((s) => s.setLicense);
  const activationOpen = useStore((s) => s.activationOpen);
  const openActivation = useStore((s) => s.openActivation);
  const closeActivation = useStore((s) => s.closeActivation);

  // Fetch the license, then start the trial tour and revalidate online.
  const initLicense = useCallback(() => {
    fetchLicenseStatus()
      .then(async (status) => {
        setLicense(status);
        if (status.state !== "expired" && localStorage.getItem(TOUR_SEEN_KEY) !== "1") {
          openTour();
        }
        if (status.state === "licensed" && status.machineId) {
          await revalidateStored(status.machineId);
          fetchLicenseStatus().then(setLicense).catch(() => {});
        }
      })
      .catch(() => setLicense({ state: "licensed", machineId: "", trialDaysLeft: 0 }));
  }, [setLicense, openTour]);

  const enterApp = useCallback(() => {
    initLicense();
  }, [initLicense]);

  useEffect(() => {
    loadAll();
    loadPrinters();
    enterApp();
  }, [loadAll, loadPrinters, enterApp]);

  // Check for a newer release only AFTER the app is up and interactive — never block
  // startup on it. If one exists, a persistent icon appears above Settings; clicking it
  // opens the (unchanged) update flow.
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateOpen, setUpdateOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const info = await checkUpdate();
        if (!cancelled && info.available) setUpdateInfo(info);
      } catch {
        // Offline or check failed — stay on the current version silently.
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or Ctrl+Y to redo — but not while the
  // user is typing in a form field (let the browser handle native text undo there).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if ((key === "z" && e.shiftKey) || key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  const startResize = useCallback((e: React.PointerEvent) => {
    resizing.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  }, []);

  const onResize = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    const w = window.innerWidth - e.clientX;
    setSidebarW(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w)));
  }, []);

  const endResize = useCallback((e: React.PointerEvent) => {
    if (!resizing.current) return;
    resizing.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setSidebarW((w) => {
      localStorage.setItem(SIDEBAR_W_KEY, String(w));
      return w;
    });
  }, []);

  return (
    <div className="app">
      <header className="topbar" data-tauri-drag-region>
        <div className="topbar-brand" data-tauri-drag-region>
          <AppMark />
          <span className="brand" data-tauri-drag-region>Tagify</span>
        </div>
        <div className="window-controls">
          <button className="window-btn" title="Minimizar" aria-label="Minimizar" onClick={() => void appWindow.minimize()}>
            <MinimizeIcon />
          </button>
          <button className="window-btn" title="Maximizar" aria-label="Maximizar" onClick={() => void appWindow.toggleMaximize()}>
            <MaximizeIcon />
          </button>
          <button className="window-btn window-close" title="Fechar" aria-label="Fechar" onClick={() => void appWindow.close()}>
            <CloseIcon />
          </button>
        </div>
        <span className="topbar-sub">Impressão térmica de qualidade</span>
      </header>

      {license && (license.state === "expired" || activationOpen) ? (
        <ActivationScreen
          machineId={license.machineId}
          trialDaysLeft={license.trialDaysLeft}
          expired={license.state === "expired"}
          onActivated={(s) => {
            setLicense(s);
            closeActivation();
          }}
          onClose={closeActivation}
        />
      ) : (
      <main className="workspace">
        <nav className="rail">
          {TABS.map((t) => (
            <button
              key={t.id}
              data-tour={`tab-${t.id}`}
              className={`rail-btn ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
              title={t.label}
              aria-label={t.label}
            >
              {t.icon}
            </button>
          ))}
          <div className="rail-bottom">
            {updateInfo && (
              <button
                className="rail-btn rail-update"
                title={`Atualização disponível (versão ${updateInfo.version}) — clique para baixar`}
                aria-label="Baixar atualização"
                onClick={() => setUpdateOpen(true)}
              >
                <UpdateDownloadIcon />
              </button>
            )}
            <button
              key={SETTINGS_TAB.id}
              data-tour="settings"
              className={`rail-btn ${tab === SETTINGS_TAB.id ? "active" : ""}`}
              onClick={() => setTab(SETTINGS_TAB.id)}
              title={SETTINGS_TAB.label}
              aria-label={SETTINGS_TAB.label}
            >
              {SETTINGS_TAB.icon}
            </button>
          </div>
        </nav>

        {tab === "settings" ? (
          <SettingsPanel />
        ) : tab === "produtos" ? (
          <ProductsPanel />
        ) : tab === "timeline" ? (
          <TimelinePanel />
        ) : (
          <>
            <CanvasArea />

            {collapsed ? (
              <button
                className="sidebar-reopen"
                title="Abrir painel"
                aria-label="Abrir painel"
                onClick={() => setCollapsed(false)}
              >
                <ChevronLeft />
              </button>
            ) : (
              <aside className="sidebar" style={{ width: sidebarW }}>
                <div
                  className="sidebar-resizer"
                  onPointerDown={startResize}
                  onPointerMove={onResize}
                  onPointerUp={endResize}
                  title="Arraste para redimensionar"
                />
                <div className="sidebar-header">
                  <span className="sidebar-title">
                    {TABS.find((t) => t.id === tab)?.label}
                  </span>
                  <button
                    className="sidebar-collapse"
                    title="Fechar painel"
                    aria-label="Fechar painel"
                    onClick={() => setCollapsed(true)}
                  >
                    <ChevronRight />
                  </button>
                </div>
                <div className="sidebar-body">
                  {tab === "canva" && <CanvaPanel />}
                  {tab === "lote" && <LotePanel />}
                </div>
              </aside>
            )}
          </>
        )}
      </main>
      )}

      {license?.state === "trial" && !activationOpen && (
        <div className="trial-banner">
          <span>
            Versão de teste · {license.trialDaysLeft} dia(s) restante(s)
          </span>
          <button className="trial-banner-btn" onClick={openActivation}>
            Ativar licença
          </button>
        </div>
      )}
      {updateInfo && updateOpen && (
        <div className="update-overlay">
          <UpdateGate info={updateInfo} onCancel={() => setUpdateOpen(false)} />
        </div>
      )}
      <Tour />
      <Toast />
    </div>
  );
}

function AppMark() {
  return (
    <svg className="app-mark" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <rect x="2" y="3" width="14" height="12" rx="3" fill="#2f6fed" />
      <path d="M5 7.5h8M5 10.5h5" stroke="#ffffff" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="13" cy="5" r="2" fill="#f2b84b" />
    </svg>
  );
}

function MinimizeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
      <path d="M2 9.5h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function MaximizeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
      <rect x="2.5" y="2.5" width="8" height="8" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" aria-hidden="true">
      <path d="M3 3l7 7M10 3l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ChevronLeft() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}

function CanvaIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19l7-7 3 3-7 7-3-3z" />
      <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
      <path d="M2 2l7.586 7.586" />
      <circle cx="11" cy="11" r="2" />
    </svg>
  );
}

function ProductsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="3.01" y2="6" />
      <line x1="3" y1="12" x2="3.01" y2="12" />
      <line x1="3" y1="18" x2="3.01" y2="18" />
    </svg>
  );
}

function LoteIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" rx="1" />
    </svg>
  );
}

function UpdateDownloadIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M5 21h14" />
    </svg>
  );
}

function TimelineIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="21" x2="21" y2="21" />
      <rect x="5" y="11" width="3.2" height="7" rx="1" />
      <rect x="10.4" y="7" width="3.2" height="11" rx="1" />
      <rect x="15.8" y="14" width="3.2" height="4" rx="1" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1.82V22a2 2 0 0 1-4 0v-.18A1.65 1.65 0 0 0 9 20a1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1.82-.33H2a2 2 0 0 1 0-4h.18A1.65 1.65 0 0 0 4 9a1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1.82V2a2 2 0 0 1 4 0v.18A1.65 1.65 0 0 0 15 4a1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 .6 1 1.65 1.65 0 0 0 1.82.33H22a2 2 0 0 1 0 4h-.18A1.65 1.65 0 0 0 20 15a1.65 1.65 0 0 0-.6 0z" />
    </svg>
  );
}
