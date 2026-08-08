"use client";

import type { OrderType } from "@pos/shared-types";

const labels: Record<OrderType, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  delivery_manual: "Delivery"
};

export function PosOrderTypeSelector({
  value,
  onChange,
  labelMap
}: {
  value: OrderType;
  onChange: (value: OrderType) => void;
  labelMap?: Partial<Record<OrderType, string>>;
}) {
  const mergedLabels = { ...labels, ...(labelMap ?? {}) };
  return (
    <div className="posui-order-type" role="radiogroup" aria-label="Order type">
      {(Object.keys(mergedLabels) as OrderType[]).map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={`posui-chip ${value === option ? "is-active" : ""}`}
        >
          {mergedLabels[option]}
        </button>
      ))}
    </div>
  );
}
