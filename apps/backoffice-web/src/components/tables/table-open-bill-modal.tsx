"use client";

import { useEffect, useMemo, useState } from "react";
import { FloorPlanCanvas } from "@/components/tables/floor-plan-canvas";
import { getTableStatusLabel, getTableUiText } from "@/components/tables/table-i18n";
import { FloorPlanToolbar } from "@/components/tables/floor-plan-toolbar";
import { TableBillSummaryPanel } from "@/components/tables/table-bill-summary-panel";
import { TableListGrid } from "@/components/tables/table-list-grid";
import { TableZoneTabs } from "@/components/tables/table-zone-tabs";
import type { DiningTableItem, TableZoneItem } from "@/components/tables/types";
import type { Language } from "@/lib/i18n";

type BillSummaryData = {
  session: { id: string; status: string; opened_at: string } | null;
  order: { id: string; order_no: string; total_amount: number; status: string; customer_name: string | null; notes: string | null } | null;
  items: Array<{ id: string; quantity: number; line_total: number; products?: { name?: string } | null }>;
  payments: Array<{ id: string; method: string; amount: number }>;
};

type Props = {
  open: boolean;
  tables: DiningTableItem[];
  zones: TableZoneItem[];
  onClose: () => void;
  onOpenBill: (table: DiningTableItem) => Promise<void> | void;
  lang?: Language;
};

export function TableOpenBillModal({ open, tables, zones, onClose, onOpenBill, lang = "th" }: Props) {
  const text = getTableUiText(lang);
  const [viewMode, setViewMode] = useState<"sorted" | "floor">("sorted");
  const [activeZoneId, setActiveZoneId] = useState<string>("all");
  const [selectedTable, setSelectedTable] = useState<DiningTableItem | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(false);
  const [billData, setBillData] = useState<BillSummaryData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setViewMode("sorted");
    setActiveZoneId("all");
    setSelectedTable(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setBillData(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!selectedTable) return;

    const controller = new AbortController();
    const loadBillSummary = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/pos/tables/${selectedTable.id}/bill`, {
          cache: "no-store",
          signal: controller.signal
        });
        const body = await response.json();
        if (!response.ok || body.error) {
          throw new Error(body.error?.message ?? (lang === "th" ? "โหลดรายละเอียดบิลไม่สำเร็จ" : "Failed to load bill details."));
        }
        setBillData(body.data as BillSummaryData);
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }
        setBillData(null);
        setError(fetchError instanceof Error ? fetchError.message : lang === "th" ? "เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ" : "Unknown error");
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    };

    void loadBillSummary();

    return () => {
      controller.abort();
    };
  }, [lang, selectedTable]);

  const visibleTables = useMemo(() => {
    if (activeZoneId === "all") return tables;
    return tables.filter((table) => table.zone_id === activeZoneId);
  }, [activeZoneId, tables]);

  if (!open) return null;

  return (
    <div className="table-modal-overlay" role="dialog" aria-modal="true" aria-label={text.tableSelector}>
      <div className="table-modal">
        <header className="table-modal__header">
          <div>
            <h3>{text.tableSelector}</h3>
            <p>{text.chooseTableForBill}</p>
          </div>
          <button type="button" onClick={onClose}>
            {text.close}
          </button>
        </header>

        <div className="table-modal__view-switch">
          <button type="button" className={viewMode === "sorted" ? "is-active" : ""} onClick={() => setViewMode("sorted")}>
            {text.tableList}
          </button>
          <button type="button" className={viewMode === "floor" ? "is-active" : ""} onClick={() => setViewMode("floor")}>
            {text.floorPlan}
          </button>
        </div>

        <TableZoneTabs zones={zones} activeZoneId={activeZoneId} onChange={setActiveZoneId} lang={lang} />

        <div className="table-modal__body">
          <section className="table-modal__main">
            {viewMode === "sorted" ? (
              <TableListGrid tables={visibleTables} zones={zones} selectedTableId={selectedTable?.id} onSelect={setSelectedTable} readOnly lang={lang} />
            ) : (
              <>
                <FloorPlanToolbar
                  zoom={zoom}
                  lang={lang}
                  onZoomIn={() => setZoom((value) => Math.min(2.4, value + 0.1))}
                  onZoomOut={() => setZoom((value) => Math.max(0.4, value - 0.1))}
                  onResetViewport={() => {
                    setZoom(1);
                    setPan({ x: 0, y: 0 });
                  }}
                />
                <FloorPlanCanvas
                  tables={visibleTables}
                  zones={zones}
                  lang={lang}
                  selectedTableId={selectedTable?.id}
                  editable={false}
                  zoom={zoom}
                  pan={pan}
                  onPanChange={setPan}
                  onSelect={setSelectedTable}
                />
              </>
            )}
          </section>

          <aside className="table-modal__side">
            <h4>{text.selectedTable}</h4>
            {selectedTable ? (
              <>
                <p>
                  <strong>{selectedTable.table_code}</strong> {selectedTable.table_name ? `(${selectedTable.table_name})` : ""}
                </p>
                <p>
                  {text.status}: {getTableStatusLabel(lang, selectedTable.status)}
                </p>
                <p>
                  {text.seats}: {selectedTable.capacity}
                </p>
                <div className="table-modal__actions">
                  <button
                    type="button"
                    disabled={selectedTable.status !== "available"}
                    onClick={() => void onOpenBill(selectedTable)}
                    className="is-primary"
                  >
                    {text.openBill}
                  </button>
                </div>
              </>
            ) : (
              <p>{text.selectTable}</p>
            )}
            {error ? <p className="table-modal__error">{error}</p> : null}
            {loading ? <p>{text.loadingBill}</p> : null}
            <TableBillSummaryPanel data={billData} />
          </aside>
        </div>
      </div>
    </div>
  );
}
