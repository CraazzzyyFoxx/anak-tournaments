"use client";

import { useEffect, useRef, useState } from "react";

import styles from "./docs.module.css";

type MermaidApi = (typeof import("mermaid"))["default"];

// mermaid is heavy: import it once, lazily, only in the browser. The module is
// cached by the bundler, so the singleton (and its `initialize`) persists across
// every diagram render on the page.
let mermaidPromise: Promise<MermaidApi> | null = null;
let initialized = false;

// Mermaid's theming is a JS API: it takes plain colour strings and runs its own
// colour maths over them, so it cannot read CSS custom properties — `var()` in
// `themeVariables` would not resolve. Rather than hardcode a second copy of the
// palette, resolve the --aqt-* tokens once at init and hand mermaid the computed
// values, so the diagrams follow the app theme. The hex fallbacks are the values
// this file used to carry, for when the tokens are unreachable (no DOM).
const THEME_FALLBACK = {
  "--aqt-bg": "#0d1117",
  "--aqt-card": "#12171f",
  "--aqt-card-2": "#161b22",
  "--aqt-border-3": "#2b3440",
  "--aqt-fg": "#e6edf3",
  "--aqt-teal": "#2dd4bf"
};
const MONO_FALLBACK = '"JetBrains Mono", ui-monospace, Consolas, monospace';

/**
 * Reads the palette + mono stack off `<body>`, where next/font declares its
 * `--font-*` variables and the `:root` `--aqt-*` tokens have inherited down.
 * Note it reads `--font-jetbrains-mono`, not `--aqt-mono`: the latter is
 * declared on `:root` yet references a `<body>`-scoped variable, so it computes
 * to the guaranteed-invalid value and always reads back empty.
 */
function readTheme(): { c: Record<string, string>; mono: string } {
  const c: Record<string, string> = { ...THEME_FALLBACK };
  if (typeof document === "undefined" || typeof getComputedStyle !== "function" || !document.body) {
    return { c, mono: MONO_FALLBACK };
  }
  const bodyStyle = getComputedStyle(document.body);
  const probe = document.createElement("div");
  probe.style.display = "none";
  document.body.appendChild(probe);
  try {
    for (const token of Object.keys(THEME_FALLBACK)) {
      const raw = bodyStyle.getPropertyValue(token).trim();
      if (!raw) continue;
      // Tokens are authored as `hsl(h s% l%)`, which mermaid's colour maths does
      // not parse. Round-trip through `color` so the browser returns `rgb(...)`.
      probe.style.color = "";
      probe.style.color = raw;
      if (!probe.style.color) continue;
      const normalised = getComputedStyle(probe).color;
      if (normalised) c[token] = normalised;
    }
    const face = bodyStyle.getPropertyValue("--font-jetbrains-mono").trim();
    return { c, mono: face ? `${face}, ${MONO_FALLBACK}` : MONO_FALLBACK };
  } finally {
    probe.remove();
  }
}

async function getMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => mod.default);
  }
  const mermaid = await mermaidPromise;
  if (!initialized) {
    const { c, mono } = readTheme();
    mermaid.initialize({
      startOnLoad: false,
      theme: "dark",
      securityLevel: "loose",
      fontFamily: mono,
      themeVariables: {
        darkMode: true,
        background: c["--aqt-bg"],
        mainBkg: c["--aqt-card-2"],
        primaryColor: c["--aqt-card-2"],
        primaryBorderColor: c["--aqt-teal"],
        primaryTextColor: c["--aqt-fg"],
        secondaryColor: c["--aqt-card"],
        tertiaryColor: c["--aqt-bg"],
        lineColor: c["--aqt-teal"],
        textColor: c["--aqt-fg"],
        // ER attribute rows
        attributeBackgroundColorOdd: c["--aqt-card"],
        attributeBackgroundColorEven: c["--aqt-bg"],
        // Flowchart clusters (domain map)
        clusterBkg: c["--aqt-card"],
        clusterBorder: c["--aqt-border-3"],
        nodeBorder: c["--aqt-teal"],
        edgeLabelBackground: c["--aqt-bg"]
      },
      er: {
        useMaxWidth: false,
        entityPadding: 15,
        layoutDirection: "TB"
      },
      flowchart: {
        useMaxWidth: false,
        htmlLabels: true,
        curve: "basis"
      }
    });
    initialized = true;
  }
  return mermaid;
}

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.15;

interface MermaidDiagramProps {
  /** Verbatim Mermaid source. */
  code: string;
  /** Stable key for the active diagram (used to build a unique render id). */
  diagramKey: string;
  /**
   * `false` (default): fills the flex stage (absolute scroll region).
   * `true`: grows to content height inside a normal-flow block.
   */
  inline?: boolean;
}

export function MermaidDiagram({ code, diagramKey, inline = false }: Readonly<MermaidDiagramProps>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);

  // No synchronous state reset here: callers pass a `key` so switching diagrams
  // remounts the component with fresh initial state (loading=true, zoom=1). The
  // setState calls below all run after an `await`, so they never cascade the
  // initial render synchronously.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const mermaid = await getMermaid();
        // Unique id per render — mermaid errors if an id is reused.
        const renderId = `mermaid-${diagramKey}-${Math.random().toString(36).slice(2, 9)}`;
        const { svg, bindFunctions } = await mermaid.render(renderId, code);
        if (cancelled) return;
        const el = containerRef.current;
        if (el) {
          el.innerHTML = svg;
          bindFunctions?.(el);
        }
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Не удалось отрендерить диаграмму");
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, diagramKey]);

  const zoomIn = () => setZoom((z) => Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 100) / 100));
  const zoomOut = () => setZoom((z) => Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 100) / 100));
  const zoomReset = () => setZoom(1);

  return (
    <div className={inline ? styles.diagramWrapInline : styles.diagramWrap}>
      <div className={styles.zoomControls}>
        <button
          type="button"
          className={styles.zoomBtn}
          onClick={zoomOut}
          aria-label="Уменьшить"
          disabled={zoom <= ZOOM_MIN}
        >
          −
        </button>
        <span className={styles.zoomLevel}>{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className={styles.zoomBtn}
          onClick={zoomIn}
          aria-label="Увеличить"
          disabled={zoom >= ZOOM_MAX}
        >
          +
        </button>
        <button type="button" className={styles.zoomBtn} onClick={zoomReset} aria-label="Сбросить">
          ⟲
        </button>
      </div>

      <div className={inline ? styles.diagramScrollInline : styles.diagramScroll}>
        <div
          ref={containerRef}
          className={styles.diagramInner}
          style={{ transform: `scale(${zoom})` }}
        />
      </div>

      {loading && !error && <div className={styles.diagramState}>Рендер диаграммы…</div>}
      {error && <div className={styles.diagramError}>Ошибка Mermaid: {error}</div>}
    </div>
  );
}
