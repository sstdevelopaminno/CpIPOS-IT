"use client";

import { useIsPosSupportedViewport } from "@/lib/viewport-hooks";

type Props = {
  lang: "th" | "en";
};

export function PosViewportGuard({ lang }: Props) {
  const viewport = useIsPosSupportedViewport();
  if (!viewport.hasSize || viewport.supported) return null;

  const isThai = lang === "th";
  const title = isThai ? "กรุณาหมุนหน้าจอเป็นแนวนอน" : "Please rotate your device to landscape mode";
  const subtitle = isThai
    ? "Please rotate your device to landscape mode"
    : "กรุณาหมุนหน้าจอเป็นแนวนอน";
  const description = isThai
    ? "ระบบ POS ออกแบบมาสำหรับใช้งานแนวนอน เพื่อให้แสดงเมนู รายการขาย และการชำระเงินได้ครบถ้วน"
    : "The POS workspace is designed for landscape use so menus, cart, sales lists, and payment actions stay visible.";
  const status = viewport.isNarrow
    ? isThai
      ? "ขนาดหน้าจอนี้แคบเกินไปสำหรับการใช้งาน POS"
      : "This screen is too narrow for POS usage."
    : isThai
      ? "ตรวจพบหน้าจอแนวตั้ง"
      : "Portrait viewport detected.";

  return (
    <div className="pos-viewport-guard" role="alertdialog" aria-modal="true" aria-labelledby="pos-viewport-guard-title">
      <section className="pos-viewport-guard__card">
        <div className="pos-viewport-guard__icon" aria-hidden="true">
          <svg width="92" height="92" viewBox="0 0 92 92" fill="none">
            <rect x="28" y="11" width="36" height="70" rx="9" stroke="currentColor" strokeWidth="5" />
            <rect x="22" y="25" width="48" height="42" rx="8" fill="currentColor" opacity="0.12" />
            <path d="M16 52c4 14 17 24 32 24 9 0 17-3 23-9" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
            <path d="M70 79l2-13-13 2" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <p className="pos-viewport-guard__status">{status}</p>
        <h1 id="pos-viewport-guard-title">{title}</h1>
        <p className="pos-viewport-guard__subtitle">{subtitle}</p>
        <p className="pos-viewport-guard__description">{description}</p>
        <div className="pos-viewport-guard__size">
          {viewport.width} x {viewport.height}
        </div>
      </section>
    </div>
  );
}
