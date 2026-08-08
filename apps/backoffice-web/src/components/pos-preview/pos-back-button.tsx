"use client";

import Link from "next/link";
import type { Language } from "@/lib/i18n";

export function PosBackButton({
  lang,
  href = "/preview/pos",
  label,
  className = ""
}: {
  lang: Language;
  href?: string;
  label?: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-black text-slate-800 shadow-sm transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 ${className}`}
    >
      <span aria-hidden>{"<"}</span>
      <span>{label ?? (lang === "th" ? "กลับหน้าขาย" : "Back to Sales")}</span>
    </Link>
  );
}
