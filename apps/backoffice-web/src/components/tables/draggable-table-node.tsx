"use client";

import { memo, type PointerEvent as ReactPointerEvent, useEffect, useRef } from "react";
import type { DiningTableItem } from "@/components/tables/types";
import type { Language } from "@/lib/i18n";
import { TableStatusBadge } from "@/components/tables/table-status-badge";

type Props = {
  table: DiningTableItem;
  zoom: number;
  selected?: boolean;
  editable?: boolean;
  onSelect?: (table: DiningTableItem) => void;
  onPrefetch?: (table: DiningTableItem) => void;
  onMove?: (tableId: string, x: number, y: number) => void;
  onResize?: (tableId: string, width: number, height: number) => void;
  lang?: Language;
};

function DraggableTableNodeComponent({ table, zoom, selected, editable = false, onSelect, onPrefetch, onMove, onResize, lang = "en" }: Props) {
  const draggingRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizingRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ x: number; y: number } | null>(null);
  const pendingResizeRef = useRef<{ width: number; height: number } | null>(null);

  useEffect(() => {
    return () => {
      if (dragRafRef.current !== null) {
        cancelAnimationFrame(dragRafRef.current);
      }
      if (resizeRafRef.current !== null) {
        cancelAnimationFrame(resizeRafRef.current);
      }
    };
  }, []);

  function flushDrag() {
    dragRafRef.current = null;
    const pending = pendingDragRef.current;
    if (!pending) return;
    pendingDragRef.current = null;
    onMove?.(table.id, pending.x, pending.y);
  }

  function queueDrag(x: number, y: number) {
    pendingDragRef.current = { x, y };
    if (dragRafRef.current !== null) {
      return;
    }
    dragRafRef.current = requestAnimationFrame(flushDrag);
  }

  function flushResize() {
    resizeRafRef.current = null;
    const pending = pendingResizeRef.current;
    if (!pending) return;
    pendingResizeRef.current = null;
    onResize?.(table.id, pending.width, pending.height);
  }

  function queueResize(width: number, height: number) {
    pendingResizeRef.current = { width, height };
    if (resizeRafRef.current !== null) {
      return;
    }
    resizeRafRef.current = requestAnimationFrame(flushResize);
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    onPrefetch?.(table);
    if (!editable) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: table.position_x,
      originY: table.position_y
    };
  }

  function moveDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const dragging = draggingRef.current;
    if (!dragging) return;
    const deltaX = (event.clientX - dragging.startX) / zoom;
    const deltaY = (event.clientY - dragging.startY) / zoom;
    queueDrag(dragging.originX + deltaX, dragging.originY + deltaY);
  }

  function endDrag() {
    if (dragRafRef.current !== null) {
      cancelAnimationFrame(dragRafRef.current);
      dragRafRef.current = null;
    }
    const pending = pendingDragRef.current;
    if (pending) {
      onMove?.(table.id, pending.x, pending.y);
      pendingDragRef.current = null;
    }
    draggingRef.current = null;
  }

  function startResize(event: ReactPointerEvent<HTMLSpanElement>) {
    if (!editable) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizingRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      width: table.width,
      height: table.height
    };
  }

  function moveResize(event: ReactPointerEvent<HTMLSpanElement>) {
    const resizing = resizingRef.current;
    if (!resizing) return;
    const nextWidth = Math.max(40, resizing.width + (event.clientX - resizing.startX) / zoom);
    const nextHeight = Math.max(40, resizing.height + (event.clientY - resizing.startY) / zoom);
    queueResize(nextWidth, nextHeight);
  }

  function endResize() {
    if (resizeRafRef.current !== null) {
      cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = null;
    }
    const pending = pendingResizeRef.current;
    if (pending) {
      onResize?.(table.id, pending.width, pending.height);
      pendingResizeRef.current = null;
    }
    resizingRef.current = null;
  }

  return (
    <button
      type="button"
      className={`floor-node status-${table.status} ${selected ? "is-selected" : ""} ${editable ? "is-editable" : ""}`}
      style={{
        left: `${table.position_x}px`,
        top: `${table.position_y}px`,
        width: `${table.width}px`,
        height: `${table.height}px`,
        borderRadius: table.shape === "circle" ? "999px" : table.shape === "square" ? "8px" : "10px",
        transform: `rotate(${table.rotation}deg)`
      }}
      onClick={() => onSelect?.(table)}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerEnter={() => onPrefetch?.(table)}
    >
      <strong>{table.table_code}</strong>
      {table.qr_activity?.latest_event_id ? (
        <span className="floor-node__qr-dot" aria-label={lang === "th" ? "มีรายการล่าสุดจาก QR" : "New QR activity"} />
      ) : null}
      <small>{table.table_name ?? "-"}</small>
      <TableStatusBadge status={table.status} lang={lang} />
      {editable ? (
        <span
          className="floor-node__resize"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        />
      ) : null}
    </button>
  );
}

export const DraggableTableNode = memo(DraggableTableNodeComponent, (prev, next) => {
  return (
    prev.table === next.table &&
    prev.zoom === next.zoom &&
    prev.selected === next.selected &&
    prev.editable === next.editable &&
    prev.lang === next.lang
  );
});
