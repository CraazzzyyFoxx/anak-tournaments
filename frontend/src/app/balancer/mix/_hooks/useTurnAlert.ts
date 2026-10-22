"use client";

import { useEffect } from "react";

/** A short beep through Web Audio; nothing where the browser offers none. */
function beep(): void {
  const Context = typeof window === "undefined" ? undefined : window.AudioContext;
  if (Context == null) return;
  const context = new Context();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 880;
  gain.gain.value = 0.08;
  oscillator.connect(gain).connect(context.destination);
  oscillator.onended = () => void context.close();
  oscillator.start();
  oscillator.stop(context.currentTime + 0.15);
}

/**
 * The in-browser turn alert (spec §7.5, Q29a): when it becomes the viewer's turn the page beeps once, vibrates once
 * and puts the turn in the tab title until the turn passes. Nothing reaches a closed page (the Discord DM is П3).
 */
export function useTurnAlert(active: boolean, title: string): void {
  useEffect(() => {
    if (!active) return;
    const previous = document.title;
    document.title = title;
    navigator.vibrate?.(200);
    beep();
    return () => {
      document.title = previous;
    };
  }, [active, title]);
}
