"use client";

import { type PointerEvent as ReactPointerEvent, useEffect, useMemo, useRef } from "react";
import { DraggableFloorObjectNode } from "@/components/tables/draggable-floor-object-node";
import { getFloorObjectTypeLabel, getTableUiText } from "@/components/tables/table-i18n";
import { DraggableTableNode } from "@/components/tables/draggable-table-node";
import type { DiningTableItem, FloorPlanObjectItem, TableZoneItem } from "@/components/tables/types";
import type { Language } from "@/lib/i18n";

type Props = {
  tables: DiningTableItem[];
  objects?: FloorPlanObjectItem[];
  zones: TableZoneItem[];
  selectedTableId?: string | null;
  selectedObjectId?: string | null;
  editable?: boolean;
  zoom: number;
  pan: { x: number; y: number };
  onPanChange: (next: { x: number; y: number }) => void;
  onSelect: (table: DiningTableItem) => void;
  onTablePrefetch?: (table: DiningTableItem) => void;
  onSelectObject?: (item: FloorPlanObjectItem) => void;
  onTableMove?: (tableId: string, x: number, y: number) => void;
  onTableResize?: (tableId: string, width: number, height: number) => void;
  onObjectMove?: (itemId: string, x: number, y: number) => void;
  onObjectResize?: (itemId: string, width: number, height: number) => void;
  lang?: Language;
};

export function FloorPlanCanvas({
  tables,
  objects = [],
  zones,
  selectedTableId,
  selectedObjectId,
  editable = false,
  zoom,
  pan,
  onPanChange,
  onSelect,
  onTablePrefetch,
  onSelectObject,
  onTableMove,
  onTableResize,
  onObjectMove,
  onObjectResize,
  lang = "en"
}: Props) {
  const panningRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const panRafRef = useRef<number | null>(null);
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null);
  const text = getTableUiText(lang);

  const zoneNameById = useMemo(() => new Map(zones.map((zone) => [zone.id, zone.zone_name])), [zones]);
  const sortedObjects = useMemo(
    () => [...objects].sort((left, right) => left.z_index - right.z_index || left.object_type.localeCompare(right.object_type)),
    [objects]
  );

  useEffect(() => {
    return () => {
      if (panRafRef.current !== null) {
        cancelAnimationFrame(panRafRef.current);
      }
    };
  }, []);

  function flushPan() {
    panRafRef.current = null;
    const pending = pendingPanRef.current;
    if (!pending) return;
    pendingPanRef.current = null;
    onPanChange(pending);
  }

  function queuePan(nextPan: { x: number; y: number }) {
    pendingPanRef.current = nextPan;
    if (panRafRef.current !== null) {
      return;
    }
    panRafRef.current = requestAnimationFrame(flushPan);
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest(".floor-node, .floor-object-node")) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    panningRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y
    };
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const panning = panningRef.current;
    if (!panning) return;
    queuePan({
      x: panning.originX + (event.clientX - panning.startX),
      y: panning.originY + (event.clientY - panning.startY)
    });
  }

  function handlePointerUp() {
    if (panRafRef.current !== null) {
      cancelAnimationFrame(panRafRef.current);
      panRafRef.current = null;
    }
    if (pendingPanRef.current) {
      onPanChange(pendingPanRef.current);
      pendingPanRef.current = null;
    }
    panningRef.current = null;
  }

  return (
    <section className="floor-canvas-shell">
      <div className="floor-canvas-zones">
        {zones.map((zone) => (
          <span key={zone.id}>
            <i style={{ background: zone.color }} />
            {zone.zone_name}
          </span>
        ))}
      </div>
      <div className="floor-canvas" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onPointerCancel={handlePointerUp}>
        <div
          className="floor-canvas-stage"
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`
          }}
        >
          {sortedObjects.map((item) => (
            <DraggableFloorObjectNode
              key={item.id}
              item={item}
              zoom={zoom}
              selected={selectedObjectId === item.id}
              editable={editable}
              onSelect={onSelectObject}
              onMove={onObjectMove}
              onResize={onObjectResize}
              lang={lang}
            />
          ))}
          {tables.map((table) => (
            <DraggableTableNode
              key={table.id}
              table={table}
              zoom={zoom}
              selected={selectedTableId === table.id}
              editable={editable}
              onSelect={onSelect}
              onPrefetch={onTablePrefetch}
              onMove={onTableMove}
              onResize={onTableResize}
              lang={lang}
            />
          ))}
        </div>
      </div>
      <p className="floor-canvas-footnote">
        {text.floorHelp}
        {editable ? ` ${text.floorHelpEdit}` : ""}
      </p>
      <div className="floor-canvas-zone-summary">
        {objects.map((item) => (
          <span key={`zone-obj-${item.id}`}>
            {item.object_name || getFloorObjectTypeLabel(lang, item.object_type)} - {zoneNameById.get(item.zone_id ?? "") ?? text.unassigned}
          </span>
        ))}
        {tables.map((table) => (
          <span key={`zone-${table.id}`}>
            {table.table_code} - {zoneNameById.get(table.zone_id ?? "") ?? text.unassigned}
          </span>
        ))}
      </div>
    </section>
  );
}
