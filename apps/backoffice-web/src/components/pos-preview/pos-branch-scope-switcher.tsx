"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { Language } from "@/lib/i18n";

type BranchScopeItem = {
  id: string;
  code: string;
  name: string;
  role: "owner" | "manager" | "staff";
  isDefault: boolean;
};

type BranchScopeResponse = {
  data?: {
    currentBranchId?: string | null;
    items?: BranchScopeItem[];
  } | null;
};

export function PosBranchScopeSwitcher({ lang, collapsed }: { lang: Language; collapsed: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<BranchScopeItem[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [draftBranchId, setDraftBranchId] = useState<string>("");
  const [error, setError] = useState("");

  const text = useMemo(
    () => ({
      label: lang === "th" ? "สาขาที่ใช้งาน" : "Active Branch",
      placeholder: lang === "th" ? "กำลังโหลด..." : "Loading...",
      apply: lang === "th" ? "เปลี่ยนสาขา" : "Switch",
      updating: lang === "th" ? "กำลังเปลี่ยน..." : "Updating...",
      failed: lang === "th" ? "เปลี่ยนสาขาไม่สำเร็จ" : "Unable to switch branch"
    }),
    [lang]
  );

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const response = await fetch("/api/backoffice/branch-scope", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as BranchScopeResponse | null;
        if (!mounted || !response.ok || !body?.data) return;
        const nextItems = body.data.items ?? [];
        const nextBranchId = String(body.data.currentBranchId ?? nextItems[0]?.id ?? "");
        setItems(nextItems);
        setSelectedBranchId(nextBranchId);
        setDraftBranchId(nextBranchId);
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const canSwitch = items.length > 1;
  const hasChanges = draftBranchId && draftBranchId !== selectedBranchId;

  async function applyBranchScope() {
    if (!hasChanges || !draftBranchId) return;
    setError("");
    const response = await fetch("/api/backoffice/branch-scope", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branch_id: draftBranchId })
    });

    if (!response.ok) {
      setError(text.failed);
      return;
    }

    setSelectedBranchId(draftBranchId);
    startTransition(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (pathname === "/preview/pos/stock") {
        params.set("branch_id", draftBranchId);
      }
      const nextQuery = params.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname);
      router.refresh();
    });
  }

  if (collapsed) {
    return null;
  }

  return (
    <div className="mt-3 rounded-xl border border-white/15 bg-slate-900/35 p-2.5">
      <p className="text-[11px] font-semibold text-slate-200">{text.label}</p>
      <div className="mt-1.5 flex items-center gap-2">
        <select
          value={draftBranchId}
          onChange={(event) => setDraftBranchId(event.target.value)}
          disabled={loading || !canSwitch || isPending}
          className="h-9 min-w-0 flex-1 rounded-lg border border-white/20 bg-slate-950/50 px-2 text-xs font-semibold text-white outline-none focus:border-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? <option value="">{text.placeholder}</option> : null}
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} ({item.code})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={applyBranchScope}
          disabled={!hasChanges || loading || isPending}
          className="inline-flex h-9 items-center rounded-lg border border-blue-300/40 bg-blue-500/25 px-2.5 text-xs font-bold text-blue-100 transition hover:bg-blue-500/35 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {isPending ? text.updating : text.apply}
        </button>
      </div>
      {error ? <p className="mt-1 text-[11px] font-semibold text-rose-300">{error}</p> : null}
    </div>
  );
}
