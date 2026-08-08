"use client";

import { useEffect, useMemo, useState } from "react";
import type { DiningTableItem, TableZoneItem } from "@/components/tables/types";
import type { Language } from "@/lib/i18n";
import { getTableStatusLabel, getTableUiText } from "@/components/tables/table-i18n";
import { naturalCompareTableCode } from "@/lib/table-management";

type Props = {
  tables: DiningTableItem[];
  zones: TableZoneItem[];
  selectedTableId?: string | null;
  onSelect?: (table: DiningTableItem) => void;
  onEdit?: (table: DiningTableItem) => void;
  onDelete?: (table: DiningTableItem) => void;
  readOnly?: boolean;
  sortMode?: "natural" | "capacity_desc" | "status";
  lang?: Language;
};

export function TableListGrid({
  tables,
  zones,
  selectedTableId,
  onSelect,
  onEdit,
  onDelete,
  readOnly = false,
  sortMode = "natural",
  lang = "en"
}: Props) {
  const text = getTableUiText(lang);
  const pageSize = 10;
  const [currentPage, setCurrentPage] = useState(1);

  const sortedRows = useMemo(() => {
    const rows = [...tables];
    rows.sort((a, b) => {
      if (sortMode === "capacity_desc") {
        return b.capacity - a.capacity || naturalCompareTableCode(a.table_code, b.table_code);
      }
      if (sortMode === "status") {
        return a.status.localeCompare(b.status) || naturalCompareTableCode(a.table_code, b.table_code);
      }
      return naturalCompareTableCode(a.table_code, b.table_code);
    });
    return rows;
  }, [sortMode, tables]);

  const zoneMap = useMemo(() => new Map(zones.map((zone) => [zone.id, zone])), [zones]);

  const totalItems = sortedRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

  useEffect(() => {
    setCurrentPage(1);
  }, [sortMode, tables]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return sortedRows.slice(start, start + pageSize);
  }, [currentPage, sortedRows]);

  const rangeStart = totalItems === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const rangeEnd = totalItems === 0 ? 0 : Math.min(currentPage * pageSize, totalItems);
  const showPagination = totalItems > pageSize;

  return (
    <div className="table-list-sheet">
      <header className="table-list-sheet__head">
        <span>{text.tableCode}</span>
        <span>{text.tableName}</span>
        <span>{text.status}</span>
        <span>{text.seats}</span>
        <span>{text.zone}</span>
        <span>Actions</span>
      </header>
      <div className="table-list-sheet__body">
        {paginatedRows.map((table) => {
          const zoneName = table.zone_id ? zoneMap.get(table.zone_id)?.zone_name ?? text.unassigned : text.unassigned;
          return (
            <article key={table.id} className={`table-list-row ${selectedTableId === table.id ? "is-selected" : ""}`}>
              <button type="button" className="table-list-row__cell table-list-row__cell--code" onClick={() => onSelect?.(table)}>
                <i aria-hidden>{table.shape === "circle" ? "O" : table.shape === "square" ? "S" : "R"}</i>
                <strong>{table.table_code}</strong>
              </button>
              <button type="button" className="table-list-row__cell" onClick={() => onSelect?.(table)}>
                {table.table_name?.trim() || "-"}
              </button>
              <span className={`table-list-status status-${table.status}`}>{getTableStatusLabel(lang, table.status)}</span>
              <span className="table-list-row__cell">{table.capacity}</span>
              <span className="table-list-row__cell">{zoneName}</span>
              <div className="table-list-row__actions">
                {readOnly ? (
                  <button type="button" onClick={() => onSelect?.(table)}>
                    {text.selectTable}
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => onEdit?.(table)}>
                      {text.edit}
                    </button>
                    <button type="button" className="is-danger" onClick={() => onDelete?.(table)}>
                      {text.delete}
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <footer className="table-list-sheet__foot">
        <span>{`${rangeStart} - ${rangeEnd} / ${totalItems}`}</span>
        {showPagination ? (
          <div className="table-list-sheet__pagination">
            <button type="button" aria-label="prev" onClick={() => setCurrentPage((page) => Math.max(1, page - 1))} disabled={currentPage === 1}>
              {"<"}
            </button>
            {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
              <button key={page} type="button" className={page === currentPage ? "is-active" : ""} onClick={() => setCurrentPage(page)}>
                {page}
              </button>
            ))}
            <button
              type="button"
              aria-label="next"
              onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
              disabled={currentPage === totalPages}
            >
              {">"}
            </button>
          </div>
        ) : null}
      </footer>
    </div>
  );
}
