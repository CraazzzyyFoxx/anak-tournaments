"use client";

import { useEffect } from "react";

/**
 * A short beep through Web Audio, and its release; nothing where the browser offers none. A context made before any
 * user gesture starts suspended: its tone never plays and never ends, so only closing it frees it.
 */
function beep(): () => void {
  const Context = typeof window === "undefined" ? undefined : window.AudioContext;
  if (Context == null) return () => {};
  const context = new Context();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 880;
  gain.gain.value = 0.08;
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.15);
  return () => void context.close();
}

/**
 * The in-browser turn alert (spec §7.5, Q29a): when it becomes the viewer's turn the page beeps once, vibrates once
 * and puts the turn in the tab title. When the turn passes (or the board goes) the title comes back and the sound
 * and the buzz are released. Nothing reaches a closed page (the Discord DM is П3).
 */
export function useTurnAlert(active: boolean, title: string): void {
  useEffect(() => {
    if (!active) return;
    const previous = document.title;
    document.title = title;
    navigator.vibrate?.(200);
    const silence = beep();
    return () => {
      document.title = previous;
      navigator.vibrate?.(0);
      silence();
    };
  }, [active, title]);
}
