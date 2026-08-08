"use client";

import { ReactNode, useEffect, useState } from "react";

type Props = {
  topBar?: ReactNode;
  categoryNav: ReactNode;
  productGrid: ReactNode;
  cartPanel: ReactNode;
  cartSummaryBar?: ReactNode;
  cartDrawer?: ReactNode;
};

export function PosShell({
  topBar,
  categoryNav,
  productGrid,
  cartPanel,
  cartSummaryBar,
  cartDrawer
}: Props) {
  const [orientation, setOrientation] = useState<"portrait" | "landscape">("landscape");

  useEffect(() => {
    const media = window.matchMedia("(orientation: portrait)");
    const sync = () => setOrientation(media.matches ? "portrait" : "landscape");
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  return (
    <section className="posui-shell" data-orientation={orientation}>
      <div className="posui-body">
        <section className="posui-catalog-col">
          {topBar ? <header className="posui-topbar">{topBar}</header> : null}
          <aside className="posui-category-col">{categoryNav}</aside>
          <div className="posui-product-col">{productGrid}</div>
        </section>
        <aside className="posui-cart-col">{cartPanel}</aside>
      </div>
      {cartSummaryBar ? <div className="posui-cart-summary-bar">{cartSummaryBar}</div> : null}
      {cartDrawer}
    </section>
  );
}
