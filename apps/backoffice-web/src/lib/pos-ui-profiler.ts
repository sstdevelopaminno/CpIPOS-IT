"use client";

import { useEffect, useRef } from "react";

function isEnabled(): boolean {
  return process.env.NEXT_PUBLIC_POS_RENDER_PROFILER === "1";
}

type PosActionTrace = {
  id: string;
  actionName: string;
  startedAt: number;
};

function hasPerfMarks(): boolean {
  return typeof performance !== "undefined" && typeof performance.mark === "function" && typeof performance.measure === "function";
}

function appendTraceEvent(event: Record<string, unknown>) {
  const runtime = globalThis as { __posTraceEvents?: Array<Record<string, unknown>> };
  if (!runtime.__posTraceEvents) {
    runtime.__posTraceEvents = [];
  }
  runtime.__posTraceEvents.push({
    at: new Date().toISOString(),
    ...event
  });
  if (runtime.__posTraceEvents.length > 500) {
    runtime.__posTraceEvents.splice(0, runtime.__posTraceEvents.length - 500);
  }
}

export function readPosTraceEvents() {
  const runtime = globalThis as { __posTraceEvents?: Array<Record<string, unknown>> };
  return [...(runtime.__posTraceEvents ?? [])];
}

export function clearPosTraceEvents() {
  const runtime = globalThis as { __posTraceEvents?: Array<Record<string, unknown>> };
  runtime.__posTraceEvents = [];
}

export function usePosRenderProfiler(componentName: string, dependencies: unknown[]) {
  const renderCountRef = useRef(0);
  const lastCommitRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isEnabled()) return;
    renderCountRef.current += 1;
    const now = performance.now();
    const sinceLastCommit = lastCommitRef.current === null ? null : Number((now - lastCommitRef.current).toFixed(2));
    lastCommitRef.current = now;
    // Dev-only lightweight profiler for render cadence.
    console.debug("[POS Render]", componentName, {
      commits: renderCountRef.current,
      since_last_commit_ms: sinceLastCommit
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}

export function beginPosActionTrace(actionName: string, metadata?: Record<string, unknown>): PosActionTrace | null {
  if (!isEnabled()) return null;
  const startedAt = performance.now();
  const id = `pos-action-${actionName}-${Math.round(startedAt)}-${Math.random().toString(16).slice(2, 8)}`;
  if (hasPerfMarks()) {
    performance.mark(`${id}:start`);
  }
  console.debug("[POS Action:start]", actionName, {
    id,
    ...metadata
  });
  appendTraceEvent({
    type: "start",
    action: actionName,
    id,
    metadata: metadata ?? null
  });
  return {
    id,
    actionName,
    startedAt
  };
}

export function endPosActionTrace(
  trace: PosActionTrace | null,
  status: "ok" | "error" | "retry" = "ok",
  metadata?: Record<string, unknown>
) {
  if (!trace || !isEnabled()) return;
  const durationMs = Number((performance.now() - trace.startedAt).toFixed(2));
  if (hasPerfMarks()) {
    const endMark = `${trace.id}:end`;
    const measureName = `${trace.id}:${status}`;
    performance.mark(endMark);
    performance.measure(measureName, `${trace.id}:start`, endMark);
    performance.clearMarks(`${trace.id}:start`);
    performance.clearMarks(endMark);
    performance.clearMeasures(measureName);
  }
  console.debug("[POS Action:end]", trace.actionName, {
    id: trace.id,
    status,
    duration_ms: durationMs,
    ...metadata
  });
  appendTraceEvent({
    type: "end",
    action: trace.actionName,
    id: trace.id,
    status,
    duration_ms: durationMs,
    metadata: metadata ?? null
  });
}
