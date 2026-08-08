"use client";

import type { ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  closeLabel?: string;
  onClose: () => void;
  children: ReactNode;
};

export function PosCartDrawer({ open, title, closeLabel = "Close", onClose, children }: Props) {
  if (!open) return null;

  return (
    <div className="posui-cart-drawer-backdrop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="posui-cart-drawer">
        <header className="posui-cart-drawer__header">
          <h3>{title}</h3>
          <button type="button" className="posui-inline-action" onClick={onClose}>
            {closeLabel}
          </button>
        </header>
        <div className="posui-cart-drawer__body">{children}</div>
      </section>
    </div>
  );
}
