"use client";

import type { TableStatus } from "@pos/shared-types";
import type { Language } from "@/lib/i18n";
import { getTableStatusLabel } from "@/components/tables/table-i18n";
import { tableStatusColorMap } from "@/lib/table-management";

export function TableStatusBadge({ status, lang = "en" }: { status: TableStatus; lang?: Language }) {
  const color = tableStatusColorMap[status];
  return (
    <span
      className="table-status-badge"
      style={{
        borderColor: color,
        color
      }}
    >
      {getTableStatusLabel(lang, status)}
    </span>
  );
}
