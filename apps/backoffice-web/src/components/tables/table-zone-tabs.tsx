"use client";

import { useRef, type PointerEvent } from "react";
import type { TableZoneItem } from "@/components/tables/types";
import type { Language } from "@/lib/i18n";
import { getTableUiText } from "@/components/tables/table-i18n";

type Props = {
  zones: TableZoneItem[];
  activeZoneId: string;
  onChange: (zoneId: string) => void;
  includeAll?: boolean;
  lang?: Language;
};

export function TableZoneTabs({ zones, activeZoneId, onChange, includeAll = true, lang = "en" }: Props) {
  const text = getTableUiText(lang);
  const dragStateRef = useRef<{ pointerId: number; startX: number; scrollLeft: number } | null>(null);
  const didDragRef = useRef(false);

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft
    };
    didDragRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.startX;
    if (Math.abs(deltaX) > 4) {
      didDragRef.current = true;
      event.currentTarget.scrollLeft = dragState.scrollLeft - deltaX;
    }
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      window.setTimeout(() => {
        didDragRef.current = false;
      }, 0);
    }
  }

  function selectZone(zoneId: string) {
    if (didDragRef.current) return;
    onChange(zoneId);
  }

  return (
    <div
      className="table-zone-tabs"
      role="tablist"
      aria-label={`${text.zone} tabs`}
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
    >
      {includeAll ? (
        <button
          type="button"
          role="tab"
          className={activeZoneId === "all" ? "is-active" : ""}
          onClick={() => selectZone("all")}
        >
          {text.all}
        </button>
      ) : null}
      {zones.map((zone) => (
        <button
          key={zone.id}
          type="button"
          role="tab"
          className={activeZoneId === zone.id ? "is-active" : ""}
          onClick={() => selectZone(zone.id)}
          style={{
            borderColor: zone.color
          }}
        >
          {zone.zone_name}
        </button>
      ))}
    </div>
  );
}
