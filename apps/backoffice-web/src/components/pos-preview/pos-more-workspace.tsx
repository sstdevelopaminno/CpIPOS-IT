"use client";

import Link from "next/link";
import { MouseEvent, useEffect, useState } from "react";
import { PackageLockDialog } from "@/components/pos-preview/package-lock-dialog";
import { t, type Language } from "@/lib/i18n";
import { featureForPosRoute } from "@/lib/pos-feature-map";

type MoreIconName = "summary" | "receipt" | "tables" | "stock" | "members";
type PosRole = "owner" | "manager" | "staff" | "accountant";

type MoreItem = {
  href: string;
  icon: MoreIconName;
  labelKey: "pos_menu_sales_summary" | "pos_menu_receipts" | "pos_menu_tables" | "pos_menu_stock" | "pos_menu_members";
  roles: PosRole[];
  desc: Record<Language, string>;
};

const MORE_ITEMS: MoreItem[] = [
  {
    href: "/preview/pos/sales-summary",
    icon: "summary",
    labelKey: "pos_menu_sales_summary",
    roles: ["owner", "manager", "accountant"],
    desc: { th: "ดูยอดขาย ภาษี เงินสด/โอน และรายงานประจำกะ", en: "Review sales, tax, cash/transfer, and shift reports" }
  },
  {
    href: "/preview/pos/receipts",
    icon: "receipt",
    labelKey: "pos_menu_receipts",
    roles: ["owner", "manager", "accountant"],
    desc: { th: "ค้นหาใบเสร็จและสั่งพิมพ์ย้อนหลัง 58mm", en: "Search receipts and reprint 58mm receipts" }
  },
  {
    href: "/preview/pos/tables",
    icon: "tables",
    labelKey: "pos_menu_tables",
    roles: ["owner", "manager"],
    desc: { th: "จัดการโต๊ะ โซน และผังร้านสำหรับโหมดนั่งโต๊ะ", en: "Manage dine-in tables, zones, and floor layout" }
  },
  {
    href: "/preview/pos/stock",
    icon: "stock",
    labelKey: "pos_menu_stock",
    roles: ["owner", "manager"],
    desc: { th: "สินค้า สต็อก วัตถุดิบ ราคา และหมวดหมู่", en: "Products, stock, ingredients, prices, and categories" }
  },
  {
    href: "/preview/pos/members",
    icon: "members",
    labelKey: "pos_menu_members",
    roles: ["owner", "manager", "accountant"],
    desc: { th: "ค้นหาและจัดการข้อมูลสมาชิกหน้าร้าน", en: "Search and manage store member records" }
  }
];

function MoreIcon({ name }: { name: MoreIconName }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const
  };

  if (name === "summary") {
    return (
      <svg {...common}>
        <path d="M4 19h16" />
        <path d="M7 16V9" />
        <path d="M12 16V5" />
        <path d="M17 16v-4" />
      </svg>
    );
  }
  if (name === "receipt") {
    return (
      <svg {...common}>
        <path d="M7 3h10v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2-2 1.2V3z" />
        <path d="M9 8h6" />
        <path d="M9 12h6" />
      </svg>
    );
  }
  if (name === "tables") {
    return (
      <svg {...common}>
        <path d="M4 7h16v4H4z" />
        <path d="M7 11v7" />
        <path d="M17 11v7" />
        <path d="M5 18h14" />
      </svg>
    );
  }
  if (name === "stock") {
    return (
      <svg {...common}>
        <path d="M5 7h14v12H5z" />
        <path d="M8 7V5h8v2" />
        <path d="M8 12h8" />
        <path d="M8 16h5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20c.7-3.2 2.9-5 5.5-5s4.8 1.8 5.5 5" />
      <circle cx="17" cy="10" r="2.2" />
      <path d="M14.5 17.5c.7-1.4 1.9-2.2 3.5-2.2 1.3 0 2.4.5 3.1 1.5" />
    </svg>
  );
}

export function PosMoreWorkspace({ lang, role }: { lang: Language; role: PosRole }) {
  const [enabledFeatures, setEnabledFeatures] = useState<Record<string, boolean> | null>(null);
  const [packageLockOpen, setPackageLockOpen] = useState(false);
  const items = MORE_ITEMS.filter((item) => item.roles.includes(role));

  useEffect(() => {
    let cancelled = false;
    async function loadFeatures() {
      try {
        const response = await fetch("/api/pos/features", { cache: "no-store" });
        const body = (await response.json().catch(() => null)) as { data?: { features?: Record<string, boolean> } | null } | null;
        if (!cancelled && response.ok) setEnabledFeatures(body?.data?.features ?? {});
      } catch {
        if (!cancelled) setEnabledFeatures({});
      }
    }
    void loadFeatures();
    return () => {
      cancelled = true;
    };
  }, []);

  function isLocked(href: string) {
    const feature = featureForPosRoute(href);
    return Boolean(enabledFeatures !== null && feature && enabledFeatures[feature] === false);
  }

  function handleLocked(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    setPackageLockOpen(true);
  }

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-slate-50 p-3 sm:p-5">
      <section className="min-h-full rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-black text-slate-950">{t(lang, "pos_menu_more_title")}</h1>
            <p className="mt-1 text-sm font-semibold text-slate-500">{t(lang, "pos_menu_more_desc")}</p>
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => {
            const locked = isLocked(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                onClick={(event) => {
                  if (locked) handleLocked(event);
                }}
                aria-disabled={locked}
                className={`group grid min-h-[92px] grid-cols-[42px_1fr_24px] items-center gap-3 rounded-lg border p-4 text-left transition ${
                  locked ? "border-slate-200 bg-slate-50 text-slate-500 hover:border-blue-200" : "border-slate-200 bg-white hover:border-blue-200 hover:bg-blue-50/50"
                }`}
              >
                <span className={`inline-flex h-10 w-10 items-center justify-center rounded-lg ${locked ? "bg-slate-100 text-slate-400" : "bg-slate-100 text-slate-700 group-hover:bg-blue-100 group-hover:text-blue-700"}`}>
                  <MoreIcon name={item.icon} />
                </span>
                <span className="min-w-0">
                  <span className="block text-base font-black text-slate-950">{t(lang, item.labelKey)}</span>
                  <span className="mt-1 block text-sm font-medium leading-5 text-slate-500">{item.desc[lang]}</span>
                </span>
                <span className="text-slate-400">&gt;</span>
              </Link>
            );
          })}
        </div>
      </section>
      <PackageLockDialog lang={lang} open={packageLockOpen} onClose={() => setPackageLockOpen(false)} />
    </main>
  );
}
