"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type BranchOption = {
  id: string;
  name: string;
  code: string | null;
};

type Props = {
  th: boolean;
  canManageCatalog: boolean;
  branchOptions: BranchOption[];
  selectedBranchId: string;
};

export function StockBranchSelector({
  th,
  canManageCatalog,
  branchOptions,
  selectedBranchId
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [nextBranchId, setNextBranchId] = useState(selectedBranchId);

  useEffect(() => {
    setNextBranchId(selectedBranchId);
  }, [selectedBranchId]);

  const hasPendingBranchChange = useMemo(() => nextBranchId !== selectedBranchId, [nextBranchId, selectedBranchId]);

  function applyBranch(branchId: string) {
    if (!canManageCatalog) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("branch_id", branchId);
    const nextQuery = params.toString();
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;
    startTransition(() => {
      router.replace(nextUrl);
    });
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label className="text-xs font-semibold text-slate-600">{th ? "ดูข้อมูลสาขา" : "View Branch"}</label>
      <select
        value={nextBranchId}
        disabled={!canManageCatalog || isPending}
        onChange={(event) => {
          const value = event.target.value;
          setNextBranchId(value);
          applyBranch(value);
        }}
        className="min-h-9 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-900 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
      >
        {branchOptions.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
            {branch.code ? ` (${branch.code})` : ""}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={!canManageCatalog || isPending || !hasPendingBranchChange}
        onClick={() => applyBranch(nextBranchId)}
        className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
      >
        {isPending ? (th ? "กำลังเปลี่ยน..." : "Switching...") : th ? "เลือกสาขา" : "Select"}
      </button>
      {!canManageCatalog ? (
        <span className="text-[11px] font-semibold text-amber-700">
          {th ? "สิทธิ์ปัจจุบัน: ดูข้อมูลเท่านั้น (staff)" : "Current role: view only (staff)."}
        </span>
      ) : null}
    </div>
  );
}
