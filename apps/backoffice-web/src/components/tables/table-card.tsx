"use client";

import type { DiningTableItem } from "@/components/tables/types";
import type { Language } from "@/lib/i18n";
import { getTableUiText } from "@/components/tables/table-i18n";
import { TableStatusBadge } from "@/components/tables/table-status-badge";

type Props = {
  table: DiningTableItem;
  zoneName?: string;
  selected?: boolean;
  onSelect?: (table: DiningTableItem) => void;
  onEdit?: (table: DiningTableItem) => void;
  onDelete?: (table: DiningTableItem) => void;
  readOnly?: boolean;
  lang?: Language;
};

export function TableCard({ table, zoneName, selected, onSelect, onEdit, onDelete, readOnly = false, lang = "en" }: Props) {
  const text = getTableUiText(lang);
  return (
    <article className={`table-card ${selected ? "is-selected" : ""}`}>
      <button type="button" className="table-card__main" onClick={() => onSelect?.(table)}>
        <div className="table-card__top">
          <strong>{table.table_code}</strong>
          <TableStatusBadge status={table.status} lang={lang} />
        </div>
        <p>{table.table_name?.trim() || "-"}</p>
        <p>
          {text.zone}: <strong>{zoneName ?? text.unassigned}</strong>
        </p>
        <p>
          {text.seats}: {table.capacity}
        </p>
      </button>
      {!readOnly ? (
        <footer className="table-card__actions">
          <button type="button" onClick={() => onEdit?.(table)}>
            {text.edit}
          </button>
          <button type="button" onClick={() => onDelete?.(table)} className="is-danger">
            {text.delete}
          </button>
        </footer>
      ) : null}
    </article>
  );
}
