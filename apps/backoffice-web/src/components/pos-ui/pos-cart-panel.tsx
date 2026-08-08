"use client";

import type { ReactNode } from "react";

type Props = {
  title: string;
  itemCount: number;
  onClear?: () => void;
  clearLabel?: string;
  itemsLabel?: string;
  children: ReactNode;
};

export function PosCartPanel({
  title,
  itemCount,
  onClear,
  clearLabel = "Clear",
  itemsLabel = "items",
  children
}: Props) {
  return (
    <section className="posui-cart-panel" aria-label="Cart and payment panel">
      <header className="posui-cart-panel__header">
        <h3>
          {title} ({itemCount})
        </h3>
        <span className="sr-only">{itemsLabel}</span>
        {onClear ? (
          <button type="button" className="posui-inline-action" onClick={onClear}>
            {clearLabel}
          </button>
        ) : null}
      </header>
      <div className="posui-cart-panel__body">{children}</div>
    </section>
  );
}
