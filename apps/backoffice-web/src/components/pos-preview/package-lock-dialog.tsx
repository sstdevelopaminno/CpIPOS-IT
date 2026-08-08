"use client";

import { useEffect } from "react";
import { type Language } from "@/lib/i18n";
import {
  POS_MENU_LOCK_BODY_EN,
  POS_MENU_LOCK_BODY_TH,
  POS_MENU_LOCK_TITLE_EN,
  POS_MENU_LOCK_TITLE_TH
} from "@/lib/pos-feature-map";

type Props = {
  lang: Language;
  open: boolean;
  onClose: () => void;
};

function ShieldIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 3 19 6.2v5.3c0 4.6-2.9 7.9-7 9.5-4.1-1.6-7-4.9-7-9.5V6.2L12 3z" />
      <path d="M9.5 12.2 11.2 14l3.5-4" />
    </svg>
  );
}

export function PackageLockDialog({ lang, open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  const title = lang === "th" ? POS_MENU_LOCK_TITLE_TH : POS_MENU_LOCK_TITLE_EN;
  const body = lang === "th" ? POS_MENU_LOCK_BODY_TH : POS_MENU_LOCK_BODY_EN;
  const action = lang === "th" ? "รับทราบ" : "Got it";
  const badge = lang === "th" ? "แพ็กเกจปัจจุบัน" : "Current package";
  const note = lang === "th" ? "ติดต่อผู้ดูแลระบบ IT เพื่อเปิดใช้งานฟีเจอร์นี้" : "Contact IT support to enable this feature.";

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/58 px-4 py-6 backdrop-blur-[2px]" role="presentation" onMouseDown={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="package-lock-title"
        className="w-full max-w-[460px] overflow-hidden rounded-[22px] border border-white/70 bg-white text-slate-950 shadow-[0_24px_80px_rgba(15,23,42,0.34)]"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="h-1.5 bg-[linear-gradient(90deg,#0ea5e9,#2563eb,#22c55e)]" />
        <div className="grid gap-5 p-6 sm:p-7">
          <div className="flex items-start gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700 ring-1 ring-blue-100">
              <ShieldIcon />
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700">{badge}</p>
              <h2 id="package-lock-title" className="text-[20px] font-bold leading-tight text-slate-950">
                {title}
              </h2>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-[14px] leading-6 text-slate-700">
            <p>{body}</p>
            <p className="mt-2 font-semibold text-slate-900">{note}</p>
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-11 min-w-[112px] items-center justify-center rounded-xl bg-blue-700 px-5 text-[14px] font-bold text-white shadow-[0_10px_22px_rgba(37,99,235,0.28)] transition hover:bg-blue-800 focus:outline-none focus:ring-4 focus:ring-blue-200"
            >
              {action}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
