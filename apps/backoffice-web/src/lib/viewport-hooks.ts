"use client";

import { useEffect, useMemo, useState } from "react";

export type ViewportSize = {
  width: number;
  height: number;
};

function readViewport(): ViewportSize {
  if (typeof window === "undefined") {
    return { width: 0, height: 0 };
  }
  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

export function useViewportSize(): ViewportSize {
  const [size, setSize] = useState<ViewportSize>(() => readViewport());

  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSize(readViewport()));
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  return size;
}

export function useIsLandscape(): boolean {
  const { width, height } = useViewportSize();
  return width >= height;
}

export function useIsPosSupportedViewport() {
  const size = useViewportSize();
  return useMemo(() => {
    const hasSize = size.width > 0 && size.height > 0;
    const isLandscape = hasSize && size.width >= size.height;
    const isNarrow = hasSize && size.width < 768;
    const isPortraitTabletOrPhone = hasSize && !isLandscape && size.width < 1280;
    return {
      ...size,
      hasSize,
      isLandscape,
      isNarrow,
      isPortraitTabletOrPhone,
      supported: hasSize ? isLandscape && !isNarrow : true
    };
  }, [size]);
}
