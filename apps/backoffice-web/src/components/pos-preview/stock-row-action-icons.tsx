"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";

type ActionKey = "delete" | "stock";

type ActionMeta = {
  key: ActionKey;
  label: string;
  className: string;
  icon: ReactNode;
  disabled?: boolean;
};

type Props = {
  th: boolean;
  onDelete: () => void;
  onStock: () => void;
  busy?: boolean;
  disabled?: boolean;
};

function ActionIcon({ name }: { name: ActionKey }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };

  if (name === "delete") {
    return (
      <svg {...common} aria-hidden>
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M19 6l-1 14H6L5 6" />
        <path d="M10 11v6" />
        <path d="M14 11v6" />
      </svg>
    );
  }

  return (
    <svg {...common} aria-hidden>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

export function StockRowActionIcons({ th, onDelete, onStock, busy = false, disabled = false }: Props) {
  const actions = useMemo<ActionMeta[]>(
    () => [
      {
        key: "delete",
        label: th ? "ลบสินค้า" : "Delete Product",
        className: "border-red-200 text-red-700 hover:bg-red-50",
        icon: <ActionIcon name="delete" />
      },
      {
        key: "stock",
        label: th ? "ปรับสต๊อก" : "Adjust Stock",
        className: "border-emerald-200 text-emerald-700 hover:bg-emerald-50",
        icon: <ActionIcon name="stock" />
      }
    ],
    [th]
  );

  function handleClick(key: ActionKey) {
    if (busy || disabled) return;
    if (key === "delete") onDelete();
    if (key === "stock") onStock();
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {actions.map((action) => (
        <button
          key={action.key}
          type="button"
          onClick={() => handleClick(action.key)}
          className={`inline-flex min-h-8 items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-55 ${action.className}`}
          title={action.label}
          aria-label={action.label}
          disabled={busy || disabled}
        >
          <span className="inline-flex h-4 w-4 items-center justify-center">{action.icon}</span>
        </button>
      ))}
    </div>
  );
}
