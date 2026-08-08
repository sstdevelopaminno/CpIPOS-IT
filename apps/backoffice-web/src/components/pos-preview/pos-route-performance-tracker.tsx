"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

type PosNavSource = "staff_menu" | "sidebar_settings" | "unknown";

type PosNavMark = {
  startedAt: number;
  from: string;
  to: string;
  source: PosNavSource;
};

type PerfPayload = {
  route: string;
  from_route: string | null;
  nav_duration_ms: number | null;
  ttfb_ms: number | null;
  resource_name: string | null;
  source: PosNavSource;
  captured_at: string;
};

function safeRound(value: number | null | undefined): number | null {
  if (!Number.isFinite(value)) return null;
  return Number(Number(value).toFixed(2));
}

function resolveRouteTtfb(navStartAt: number): { ttfbMs: number | null; resourceName: string | null } {
  const recentEntries = performance
    .getEntriesByType("resource")
    .filter((entry) => entry.startTime >= navStartAt - 40)
    .map((entry) => entry as PerformanceResourceTiming);

  const preferred = recentEntries
    .filter((entry) => entry.responseStart > entry.startTime)
    .filter((entry) => entry.initiatorType === "fetch" || entry.initiatorType === "xmlhttprequest")
    .sort((a, b) => a.startTime - b.startTime)[0];

  if (preferred) {
    return {
      ttfbMs: safeRound(preferred.responseStart - preferred.startTime),
      resourceName: preferred.name
    };
  }

  const navigationEntry = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (navigationEntry && Number.isFinite(navigationEntry.responseStart)) {
    return {
      ttfbMs: safeRound(navigationEntry.responseStart),
      resourceName: navigationEntry.name || null
    };
  }

  return { ttfbMs: null, resourceName: null };
}

function postPerf(payload: PerfPayload) {
  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    const blob = new Blob([body], { type: "application/json" });
    const queued = navigator.sendBeacon("/api/pos/perf", blob);
    if (queued) return;
  }

  void fetch("/api/pos/perf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true
  }).catch(() => undefined);
}

export function PosRoutePerformanceTracker() {
  const pathname = usePathname();
  const lastRouteRef = useRef<string | null>(null);

  useEffect(() => {
    const previousRoute = lastRouteRef.current;
    lastRouteRef.current = pathname;

    const navMark = (window as Window & { __POS_NAV_MARK__?: PosNavMark }).__POS_NAV_MARK__;
    const hasExpectedMark = Boolean(navMark && navMark.to === pathname);
    const startedAt = hasExpectedMark ? navMark!.startedAt : performance.now();
    const navDurationMs = hasExpectedMark ? safeRound(performance.now() - navMark!.startedAt) : null;
    const fromRoute = hasExpectedMark ? navMark!.from : previousRoute;
    const source: PosNavSource = hasExpectedMark ? navMark!.source : "unknown";
    const ttfb = resolveRouteTtfb(startedAt);

    postPerf({
      route: pathname,
      from_route: fromRoute ?? null,
      nav_duration_ms: navDurationMs,
      ttfb_ms: ttfb.ttfbMs,
      resource_name: ttfb.resourceName,
      source,
      captured_at: new Date().toISOString()
    });

    if (hasExpectedMark) {
      delete (window as Window & { __POS_NAV_MARK__?: PosNavMark }).__POS_NAV_MARK__;
    }
  }, [pathname]);

  return null;
}

