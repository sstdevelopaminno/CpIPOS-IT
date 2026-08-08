"use client";

function TagIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20.6 13.4L11 23l-9-9V5h9z" />
      <circle cx="7.5" cy="9.5" r="1.2" />
    </svg>
  );
}

function getNumericSku(sku: string | null) {
  const digits = String(sku ?? "").replace(/\D+/g, "");
  return digits || String(sku ?? "").trim();
}

export function StockSkuReveal({ sku, th }: { sku: string | null; th: boolean }) {
  const displaySku = getNumericSku(sku);

  if (!displaySku) {
    return <span className="text-sm font-semibold text-slate-400">-</span>;
  }

  return (
    <span
      className="inline-flex min-h-8 min-w-[72px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm font-extrabold tabular-nums text-slate-800"
      aria-label={th ? `รหัสสินค้า ${displaySku}` : `SKU ${displaySku}`}
      title={sku ?? displaySku}
    >
      <span className="inline-flex h-4 w-4 items-center justify-center">
        <TagIcon />
      </span>
      <span>{displaySku}</span>
    </span>
  );
}
