"use client";

import React, { useEffect } from "react";
import { useLiquidGlass } from "@/app/users/components/UserLiquidGlassProvider";

type RGB = { r: number; g: number; b: number };

const rgbCache = new Map<string, RGB>();

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toCssVarRgb(rgb: RGB) {
  return `${clampByte(rgb.r)} ${clampByte(rgb.g)} ${clampByte(rgb.b)}`;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t
  };
}

async function loadImage(src: string) {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";

  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
  });

  img.src = src;
  return promise;
}

async function dominantColor(src: string, options?: { ignoreTransparent?: boolean }): Promise<RGB> {
  const cached = rgbCache.get(src);
  if (cached) {
    return cached;
  }

  const img = await loadImage(src);
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas 2D context not available");
  }

  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  let rSum = 0;
  let gSum = 0;
  let bSum = 0;
  let count = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];

    if (options?.ignoreTransparent && a < 128) {
      continue;
    }

    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum < 8 || lum > 248) {
      continue;
    }

    rSum += r;
    gSum += g;
    bSum += b;
    count += 1;
  }

  const result = count
    ? { r: rSum / count, g: gSum / count, b: bSum / count }
    : { r: 120, g: 120, b: 120 };

  rgbCache.set(src, result);
  return result;
}

export interface UserAuraReporterProps {
  avatarSrc: string;
  divisionIconSrc: string;
}

const UserAuraReporter = ({ avatarSrc, divisionIconSrc }: UserAuraReporterProps) => {
  const { setAura } = useLiquidGlass();

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const [avatarRgb, divisionRgb] = await Promise.all([
          dominantColor(avatarSrc),
          dominantColor(divisionIconSrc, { ignoreTransparent: true })
        ]);

        if (cancelled) {
          return;
        }

        const mixed = mix(avatarRgb, divisionRgb, 0.5);
        setAura({ a: toCssVarRgb(avatarRgb), b: toCssVarRgb(divisionRgb), c: toCssVarRgb(mixed) });
      } catch {
        // Keep defaults.
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [avatarSrc, divisionIconSrc, setAura]);

  return null;
};

export default UserAuraReporter;
