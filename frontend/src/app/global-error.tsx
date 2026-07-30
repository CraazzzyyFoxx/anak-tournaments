"use client";

import { useEffect } from "react";

import "./globals.css";

/**
 * Last-resort error boundary for failures in the root layout itself. It
 * replaces the entire document (must render <html>/<body>) and therefore runs
 * *outside* `NextIntlClientProvider` — the provider lives in the very layout
 * that just failed — so `useTranslations` would throw here. The copy below is
 * deliberately an English literal; it is the only untranslated string left on
 * the public site.
 *
 * The stylesheet is imported here explicitly so the `--aqt-*` palette resolves
 * even though the root layout never rendered. Each token still carries a plain
 * CSS-keyword fallback, because this screen must stay legible in the one
 * scenario where even the stylesheet failed to load.
 */
export default function GlobalError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--aqt-bg, black)",
          color: "var(--aqt-fg, white)",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
          padding: 24
        }}
      >
        <div role="alert" style={{ textAlign: "center", maxWidth: 480 }}>
          <div
            aria-hidden="true"
            style={{
              margin: "0 auto 20px",
              width: 48,
              height: 48,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 16,
              border: "1px solid color-mix(in srgb, var(--aqt-rose, red) 30%, transparent)",
              background: "color-mix(in srgb, var(--aqt-rose, red) 12%, transparent)",
              color: "var(--aqt-rose, red)",
              fontSize: 26,
              fontWeight: 700
            }}
          >
            !
          </div>
          <h1 style={{ fontSize: 24, fontWeight: 600, margin: "0 0 8px" }}>Something went wrong</h1>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.6,
              color: "var(--aqt-fg-muted, gray)",
              margin: "0 0 24px"
            }}
          >
            The application failed to load. Please try again.
          </p>
          {error?.digest ? (
            <p
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: "var(--aqt-fg-dim, gray)",
                margin: "0 0 24px"
              }}
            >
              Error {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              cursor: "pointer",
              border: "none",
              borderRadius: 8,
              padding: "10px 18px",
              fontSize: 14,
              fontWeight: 600,
              background: "var(--aqt-teal, teal)",
              color: "var(--aqt-bg, black)"
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
