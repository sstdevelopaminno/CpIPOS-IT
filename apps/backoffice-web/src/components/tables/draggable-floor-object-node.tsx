"use client";

import { memo, type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef } from "react";
import type { FloorPlanObjectItem } from "@/components/tables/types";
import type { Language } from "@/lib/i18n";
import { getFloorObjectTypeLabel, getTableUiText } from "@/components/tables/table-i18n";

type Props = {
  item: FloorPlanObjectItem;
  zoom: number;
  selected?: boolean;
  editable?: boolean;
  onSelect?: (item: FloorPlanObjectItem) => void;
  onMove?: (itemId: string, x: number, y: number) => void;
  onResize?: (itemId: string, width: number, height: number) => void;
  lang?: Language;
};

function getObjectGlyph(objectType: FloorPlanObjectItem["object_type"]) {
  switch (objectType) {
    case "counter":
      return "CT";
    case "cashier":
      return "CA";
    case "partition":
      return "PT";
    case "plant":
      return "PL";
    case "entrance":
      return "EN";
    case "service_station":
      return "SV";
    default:
      return "OB";
  }
}

function DraggableFloorObjectNodeComponent({ item, zoom, selected, editable = false, onSelect, onMove, onResize, lang = "en" }: Props) {
  const draggingRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const resizingRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);
  const dragRafRef = useRef<number | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const pendingDragRef = useRef<{ x: number; y: number } | null>(null);
  const pendingResizeRef = useRef<{ width: number; height: number } | null>(null);
  const text = getTableUiText(lang);

  const objectLabel = useMemo(
    () => item.object_name?.trim() || getFloorObjectTypeLabel(lang, item.object_type) || text.objectLabelFallback,
    [item.object_name, item.object_type, lang, text.objectLabelFallback]
  );

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
    onMove?.(item.id, pending.x, pending.y);
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
    onResize?.(item.id, pending.width, pending.height);
  }

  function queueResize(width: number, height: number) {
    pendingResizeRef.current = { width, height };
    if (resizeRafRef.current !== null) {
      return;
    }
    resizeRafRef.current = requestAnimationFrame(flushResize);
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!editable) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: item.position_x,
      originY: item.position_y
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
      onMove?.(item.id, pending.x, pending.y);
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
      width: item.width,
      height: item.height
    };
  }

  function moveResize(event: ReactPointerEvent<HTMLSpanElement>) {
    const resizing = resizingRef.current;
    if (!resizing) return;
    const nextWidth = Math.max(24, resizing.width + (event.clientX - resizing.startX) / zoom);
    const nextHeight = Math.max(24, resizing.height + (event.clientY - resizing.startY) / zoom);
    queueResize(nextWidth, nextHeight);
  }

  function endResize() {
    if (resizeRafRef.current !== null) {
      cancelAnimationFrame(resizeRafRef.current);
      resizeRafRef.current = null;
    }
    const pending = pendingResizeRef.current;
    if (pending) {
      onResize?.(item.id, pending.width, pending.height);
      pendingResizeRef.current = null;
    }
    resizingRef.current = null;
  }

  return (
    <button
      type="button"
      className={`floor-object-node ${selected ? "is-selected" : ""} ${editable ? "is-editable" : ""}`}
      style={{
        left: `${item.position_x}px`,
        top: `${item.position_y}px`,
        width: `${item.width}px`,
        height: `${item.height}px`,
        transform: `rotate(${item.rotation}deg)`,
        background: item.color,
        zIndex: item.z_index
      }}
      onClick={() => onSelect?.(item)}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <span className="floor-object-node__glyph">{getObjectGlyph(item.object_type)}</span>
      <strong>{objectLabel}</strong>
      {editable ? (
        <span
          className="floor-object-node__resize"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        />
      ) : null}
    </button>
  );
}

export const DraggableFloorObjectNode = memo(DraggableFloorObjectNodeComponent, (prev, next) => {
  return (
    prev.item === next.item &&
    prev.zoom === next.zoom &&
    prev.selected === next.selected &&
    prev.editable === next.editable &&
    prev.lang === next.lang
  );
});
