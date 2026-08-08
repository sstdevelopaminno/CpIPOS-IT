"use client";

import { Children } from "react";
import type { ReactNode } from "react";

type Props = {
  children: ReactNode;
  emptyLabel?: string;
};

export function PosProductGrid({ children, emptyLabel = "No products in this category." }: Props) {
  const hasChildren = Children.count(children) > 0;
  return (
    <section className="posui-product-grid-wrap" aria-label="Product catalog">
      {hasChildren ? <div className="posui-product-grid">{children}</div> : <p className="posui-empty">{emptyLabel}</p>}
    </section>
  );
}
