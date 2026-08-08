"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BranchOption = {
  id: string;
  name: string;
  code: string | null;
};

type BestSellerItem = {
  rank: number;
  tier: "gold" | "silver" | "bronze" | "standard";
  product_id: string;
  sku: string | null;
  name: string;
  category: string | null;
  units: number;
  revenue: number;
  branches: string[];
};

type BestSellerResponse = {
  days: number;
  branch_id: string;
  branch_options: BranchOption[];
  items: BestSellerItem[];
  summary: {
    units: number;
    revenue: number;
  };
};

type ApiEnvelope<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

type Props = {
  th: boolean;
  branchId: string;
  branchOptions: BranchOption[];
  canViewAllBranches: boolean;
};

const tierMeta = {
  gold: {
    th: "ระดับ 1",
    en: "Level 1",
    className: "border-amber-300 bg-amber-50 text-amber-800",
    medal: "1"
  },
  silver: {
    th: "ระดับ 2",
    en: "Level 2",
    className: "border-slate-300 bg-slate-50 text-slate-700",
    medal: "2"
  },
  bronze: {
    th: "ระดับ 3",
    en: "Level 3",
    className: "border-orange-300 bg-orange-50 text-orange-800",
    medal: "3"
  },
  standard: {
    th: "อันดับถัดไป",
    en: "Next",
    className: "border-blue-100 bg-blue-50 text-blue-700",
    medal: ""
  }
} as const;

function formatMoney(value: number) {
  return Number(value ?? 0).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

function formatUnits(value: number) {
  return Number(value ?? 0).toLocaleString("th-TH", {
    maximumFractionDigits: 3
  });
}

export function BestSellersPopupButton({ th, branchId, branchOptions, canViewAllBranches }: Props) {
  const [open, setOpen] = useState(false);
  const [visible, setVisible] = useState(false);
  const [selectedBranchId, setSelectedBranchId] = useState(canViewAllBranches ? "all" : branchId);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [payload, setPayload] = useState<BestSellerResponse | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const effectiveBranchOptions = useMemo(() => {
    if (branchOptions.length > 0) return branchOptions;
    return [{ id: branchId, name: branchId, code: null }];
  }, [branchId, branchOptions]);

  const load = useCallback(async () => {
    setLoading(true);
    setErrorText("");
    try {
      const params = new URLSearchParams({
        view: "best_sellers",
        branch_id: selectedBranchId,
        days: String(days)
      });
      const response = await fetch(`/api/backoffice/catalog?${params.toString()}`, {
        cache: "no-store"
      });
      const body = (await response.json().catch(() => null)) as ApiEnvelope<BestSellerResponse> | null;
      if (!response.ok || !body?.data || body.error) {
        throw new Error(body?.error?.message ?? "Unable to load best sellers.");
      }
      setPayload(body.data);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : th ? "โหลดสินค้าขายดีไม่สำเร็จ" : "Failed to load best sellers.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [days, selectedBranchId, th]);

  function openPopup() {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
    window.requestAnimationFrame(() => setVisible(true));
  }

  function closePopup() {
    setVisible(false);
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      setErrorText("");
    }, 180);
  }

  useEffect(() => {
    if (!open) return;
    void load();
  }, [load, open]);

  const topThree = (payload?.items ?? []).slice(0, 3);
  const remaining = (payload?.items ?? []).slice(3);

  return (
    <>
      <button
        type="button"
        onClick={openPopup}
        className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-bold text-indigo-700 hover:bg-indigo-100"
      >
        {th ? "สินค้าขายดี" : "Best Sellers"}
      </button>

      {open ? (
        <div
          className={`fixed inset-0 z-[136] grid place-items-center p-4 transition-all duration-200 ${
            visible ? "bg-slate-900/55 opacity-100" : "bg-slate-900/0 opacity-0"
          }`}
          onClick={closePopup}
        >
          <section
            onClick={(event) => event.stopPropagation()}
            className={`max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-200 ${
              visible ? "translate-y-0 scale-100 opacity-100" : "translate-y-1 scale-[0.98] opacity-0"
            }`}
          >
            <header className="border-b border-slate-200 bg-[linear-gradient(135deg,#f8fafc_0%,#eef5ff_58%,#fff7ed_100%)] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-lg font-black text-slate-900">{th ? "สินค้าขายดี" : "Best Sellers"}</h3>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    {th ? "จัดอันดับสินค้าที่ขายดีที่สุดตามยอดขายจริง แบ่งเป็น 3 ระดับแรก" : "Rank products by completed sales with the top three highlighted."}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={closePopup}
                  className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  {th ? "ปิด" : "Close"}
                </button>
              </div>

              <div className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-white/80 p-3 md:grid-cols-[minmax(0,1fr)_160px_auto] md:items-end">
                <label className="grid gap-1 text-xs font-bold text-slate-600">
                  <span>{th ? "สาขา" : "Branch"}</span>
                  <select
                    value={selectedBranchId}
                    onChange={(event) => setSelectedBranchId(event.target.value)}
                    className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900"
                  >
                    {canViewAllBranches ? <option value="all">{th ? "ทุกสาขา" : "All branches"}</option> : null}
                    {effectiveBranchOptions.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.name ?? branch.code ?? branch.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-1 text-xs font-bold text-slate-600">
                  <span>{th ? "ช่วงเวลา" : "Period"}</span>
                  <select
                    value={days}
                    onChange={(event) => setDays(Number(event.target.value))}
                    className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900"
                  >
                    <option value={7}>{th ? "7 วัน" : "7 days"}</option>
                    <option value={30}>{th ? "30 วัน" : "30 days"}</option>
                    <option value={90}>{th ? "90 วัน" : "90 days"}</option>
                  </select>
                </label>
                <button
                  type="button"
                  onClick={() => void load()}
                  disabled={loading}
                  className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-900 bg-slate-900 px-4 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "..." : th ? "รีเฟรช" : "Refresh"}
                </button>
              </div>
            </header>

            <div className="max-h-[64vh] overflow-y-auto p-4">
              {errorText ? <p className="mb-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{errorText}</p> : null}

              <div className="grid gap-3 md:grid-cols-3">
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-500">{th ? "ยอดขายรวม" : "Revenue"}</p>
                  <p className="mt-1 text-xl font-black text-slate-900">฿{formatMoney(payload?.summary.revenue ?? 0)}</p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-500">{th ? "จำนวนขายรวม" : "Units"}</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{formatUnits(payload?.summary.units ?? 0)}</p>
                </article>
                <article className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-500">{th ? "จำนวนสินค้าในอันดับ" : "Ranked Products"}</p>
                  <p className="mt-1 text-xl font-black text-slate-900">{payload?.items.length ?? 0}</p>
                </article>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-3">
                {topThree.map((item) => {
                  const meta = tierMeta[item.tier];
                  return (
                    <article key={item.product_id} className={`rounded-xl border p-4 ${meta.className}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-black uppercase tracking-[0.12em]">{th ? meta.th : meta.en}</p>
                          <h4 className="mt-2 text-base font-black text-slate-950">{item.name}</h4>
                          <p className="mt-1 text-xs font-semibold opacity-80">{item.category ?? (th ? "ไม่ระบุหมวดหมู่" : "Uncategorized")}</p>
                        </div>
                        <span className="grid h-10 w-10 place-items-center rounded-full border border-current bg-white/70 text-lg font-black">
                          {meta.medal}
                        </span>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <p className="text-xs font-semibold opacity-70">{th ? "จำนวนขาย" : "Units"}</p>
                          <p className="font-black">{formatUnits(item.units)}</p>
                        </div>
                        <div>
                          <p className="text-xs font-semibold opacity-70">{th ? "ยอดขาย" : "Revenue"}</p>
                          <p className="font-black">฿{formatMoney(item.revenue)}</p>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>

              {loading ? <p className="mt-4 text-sm font-semibold text-slate-500">{th ? "กำลังโหลด..." : "Loading..."}</p> : null}
              {!loading && (payload?.items.length ?? 0) === 0 ? (
                <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm font-semibold text-slate-500">
                  {th ? "ยังไม่มีข้อมูลการขายในช่วงเวลานี้" : "No completed sales in this period."}
                </p>
              ) : null}

              {remaining.length > 0 ? (
                <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200">
                  <table className="min-w-[760px] w-full border-collapse text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-bold text-slate-500">
                      <tr>
                        <th className="px-3 py-3">{th ? "อันดับ" : "Rank"}</th>
                        <th className="px-3 py-3">{th ? "สินค้า" : "Product"}</th>
                        <th className="px-3 py-3">{th ? "หมวดหมู่" : "Category"}</th>
                        <th className="px-3 py-3 text-right">{th ? "จำนวนขาย" : "Units"}</th>
                        <th className="px-3 py-3 text-right">{th ? "ยอดขาย" : "Revenue"}</th>
                        <th className="px-3 py-3">{th ? "สาขา" : "Branches"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {remaining.map((item) => (
                        <tr key={item.product_id} className="border-t border-slate-100">
                          <td className="px-3 py-3 font-black text-slate-800">#{item.rank}</td>
                          <td className="px-3 py-3">
                            <p className="font-bold text-slate-900">{item.name}</p>
                            <p className="text-xs text-slate-500">{item.sku ?? "-"}</p>
                          </td>
                          <td className="px-3 py-3 text-slate-600">{item.category ?? "-"}</td>
                          <td className="px-3 py-3 text-right font-bold text-slate-900">{formatUnits(item.units)}</td>
                          <td className="px-3 py-3 text-right font-bold text-slate-900">฿{formatMoney(item.revenue)}</td>
                          <td className="px-3 py-3 text-slate-600">{item.branches.join(", ") || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
