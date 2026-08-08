"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEFAULT_BUFFET_PRICE_PLANS,
  buildBuffetCartItem,
  calculateBuffetPlanTotal,
  type PosBuffetCartItem,
  type PosBuffetPricePlan,
  type PosBuffetPricingMode
} from "@/lib/pos-buffet-pricing";

type Lang = "th" | "en";

type Props = {
  open: boolean;
  lang?: Lang;
  tableCode?: string | null;
  plans?: PosBuffetPricePlan[];
  isBusy?: boolean;
  onClose: () => void;
  onConfirm: (item: PosBuffetCartItem, plan: PosBuffetPricePlan) => void;
};

type BuffetOption = {
  mode: PosBuffetPricingMode;
  plan: PosBuffetPricePlan | null;
  title: string;
  subtitle: string;
  unitLabel: string;
  icon: ReactNode;
};

type BuffetProductResolveBody = {
  error?: {
    code?: string;
    message?: string;
  } | null;
  data?: {
    product_id?: string | null;
  } | null;
};

function PerPersonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-8 w-8">
      <path d="M8.5 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM15.8 12.2a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.8 20.2v-1.4c0-3 2.1-5.2 4.7-5.2s4.7 2.2 4.7 5.2v1.4H3.8ZM13.5 20.2v-1.6c0-1.7-.5-3.2-1.5-4.4.8-.5 1.9-.8 3.1-.8 2.8 0 5.1 2 5.1 4.8v2h-6.7Z" fill="currentColor" />
    </svg>
  );
}

function BuffetSetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-8 w-8">
      <path d="M11 4.25a1 1 0 1 1 2 0v1.02a8.01 8.01 0 0 1 7 7.93H4a8.01 8.01 0 0 1 7-7.93V4.25ZM3 15.2h18v1.3a3.25 3.25 0 0 1-3.25 3.25H6.25A3.25 3.25 0 0 1 3 16.5v-1.3Z" fill="currentColor" />
      <path d="M6.8 11.2c.7-1.9 2.6-3.2 5.2-3.2s4.5 1.3 5.2 3.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </svg>
  );
}

function QuantityKeypadIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6">
      <path d="M5 4.5h14A1.5 1.5 0 0 1 20.5 6v12A1.5 1.5 0 0 1 19 19.5H5A1.5 1.5 0 0 1 3.5 18V6A1.5 1.5 0 0 1 5 4.5Zm2 3v2h2v-2H7Zm4 0v2h2v-2h-2Zm4 0v2h2v-2h-2Zm-8 4v2h2v-2H7Zm4 0v2h2v-2h-2Zm4 0v2h2v-2h-2Zm-8 4v2h6v-2H7Zm8 0v2h2v-2h-2Z" fill="currentColor" />
    </svg>
  );
}

function rememberBuffetMode() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem("cpipos_active_sales_mode_label", "buffet_table");
  window.dispatchEvent(new CustomEvent("cpipos:sales-mode-label-change", { detail: { mode: "buffet_table" } }));
}

async function resolveBuffetProductId(plan: PosBuffetPricePlan): Promise<string> {
  const response = await fetch("/api/pos/buffet-products/resolve", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      plan_id: plan.id,
      code: plan.code,
      name: plan.name,
      mode: plan.mode,
      price: plan.price
    })
  });
  const body = (await response.json().catch(() => null)) as BuffetProductResolveBody | null;
  if (!response.ok || body?.error) {
    throw new Error(body?.error?.message ?? "Failed to resolve buffet product.");
  }
  const productId = String(body?.data?.product_id ?? "").trim();
  if (!productId) {
    throw new Error("Buffet product resolver returned no product_id.");
  }
  return productId;
}

export function PosBuffetPricePickerModal({
  open,
  lang = "th",
  tableCode,
  plans = DEFAULT_BUFFET_PRICE_PLANS,
  isBusy = false,
  onClose,
  onConfirm
}: Props) {
  const activePlans = useMemo(() => plans.filter((plan) => plan.is_active), [plans]);
  const [selectedPlan, setSelectedPlan] = useState<PosBuffetPricePlan | null>(null);
  const [quantityInput, setQuantityInput] = useState("1");
  const [resolvingProduct, setResolvingProduct] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedPlan(null);
    setQuantityInput("1");
    setResolvingProduct(false);
    setResolveError(null);
  }, [open]);

  if (!open) return null;

  const actionBusy = isBusy || resolvingProduct;
  const money = (value: number) =>
    value.toLocaleString(lang === "th" ? "th-TH" : "en-US", { style: "currency", currency: "THB" });

  const perPersonPlan = activePlans.find((plan) => plan.mode === "per_person") ?? null;
  const setPlan = activePlans.find((plan) => plan.mode === "set") ?? null;
  const packageOptions: BuffetOption[] = [
    {
      mode: "per_person",
      plan: perPersonPlan,
      title: lang === "th" ? "บุฟเฟ่รายท่าน" : "Per-person buffet",
      subtitle: lang === "th" ? "คิดราคาตามจำนวนลูกค้า" : "Charge by guest count",
      unitLabel: lang === "th" ? "ท่าน" : "person",
      icon: <PerPersonIcon />
    },
    {
      mode: "set",
      plan: setPlan,
      title: lang === "th" ? "บุฟเฟ่แบบชุด" : "Buffet set",
      subtitle: lang === "th" ? "คิดราคาตามจำนวนชุด" : "Charge by set count",
      unitLabel: lang === "th" ? "ชุด" : "set",
      icon: <BuffetSetIcon />
    }
  ];

  const selectedOption = packageOptions.find((option) => option.plan?.id === selectedPlan?.id) ?? null;
  const quantity = quantityInput.trim() ? Math.max(0, Math.trunc(Number(quantityInput))) : 0;
  const total = selectedPlan && quantity > 0 ? calculateBuffetPlanTotal(selectedPlan, quantity) : 0;
  const keypadKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "00"];

  const closeModal = () => {
    if (actionBusy) return;
    setSelectedPlan(null);
    setQuantityInput("1");
    setResolveError(null);
    onClose();
  };

  const appendKey = (key: string) => {
    if (actionBusy) return;
    setResolveError(null);
    setQuantityInput((current) => {
      const next = `${current}${key}`.replace(/[^0-9]/g, "").replace(/^0+(?=\d)/u, "");
      return next.slice(0, 3);
    });
  };

  const clearQuantity = () => {
    if (actionBusy) return;
    setResolveError(null);
    setQuantityInput("");
  };

  const deleteQuantity = () => {
    if (actionBusy) return;
    setResolveError(null);
    setQuantityInput((current) => current.slice(0, -1));
  };

  const confirmQuantity = async () => {
    if (!selectedPlan || actionBusy || quantity <= 0) return;
    setResolvingProduct(true);
    setResolveError(null);
    try {
      const productId = await resolveBuffetProductId(selectedPlan);
      rememberBuffetMode();
      const virtualItem = buildBuffetCartItem({ plan: selectedPlan, quantity, tableCode });
      onConfirm({ ...virtualItem, product_id: productId }, selectedPlan);
      setSelectedPlan(null);
      setQuantityInput("1");
    } catch (error) {
      setResolveError(error instanceof Error ? error.message : "Failed to prepare buffet product.");
    } finally {
      setResolvingProduct(false);
    }
  };

  return (
    <div className="posui-modal-backdrop" role="presentation">
      <section className="posui-modal posui-modal--buffet w-[min(820px,94vw)]" role="dialog" aria-modal="true" aria-labelledby="pos-buffet-price-title">
        <header className="posui-modal__header items-start gap-5 pb-5">
          <div className="min-w-0">
            <p className="posui-modal__eyebrow">CpIPOS Buffet</p>
            <h2 id="pos-buffet-price-title">
              {selectedPlan ? (lang === "th" ? "ใส่จำนวนบุฟเฟ่" : "Enter buffet quantity") : lang === "th" ? "เลือกชุดราคาบุฟเฟ่" : "Select buffet price"}
            </h2>
            <p className="mt-1 max-w-xl text-sm font-semibold text-slate-500">
              {selectedPlan
                ? lang === "th"
                  ? "ใช้แป้นตัวเลขเพื่อใส่จำนวน แล้วกดยืนยัน"
                  : "Use the keypad to enter quantity, then confirm."
                : lang === "th"
                  ? "เลือกประเภทราคาก่อน แล้วใส่จำนวนในขั้นถัดไป"
                  : "Select a buffet price type first, then enter quantity."}
            </p>
          </div>
          <button type="button" className="posui-icon-button shrink-0" onClick={closeModal} disabled={actionBusy} aria-label={lang === "th" ? "ปิด" : "Close"}>
            ×
          </button>
        </header>

        {!selectedPlan ? (
          <div className="mt-2 grid gap-5 md:grid-cols-2" role="list" aria-label={lang === "th" ? "เลือกประเภทราคาบุฟเฟ่" : "Buffet price type"}>
            {packageOptions.map((option) => {
              const plan = option.plan;
              const disabled = !plan || actionBusy;
              return (
                <button
                  key={option.mode}
                  type="button"
                  role="listitem"
                  className={`group rounded-3xl border p-6 text-left shadow-sm transition ${disabled ? "border-slate-200 bg-slate-50 opacity-60" : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-blue-300 hover:bg-blue-50/60 hover:shadow-lg"}`}
                  onClick={() => {
                    if (!plan) return;
                    setSelectedPlan(plan);
                    setQuantityInput("1");
                    setResolveError(null);
                  }}
                  disabled={disabled}
                >
                  <span className="mb-6 grid h-16 w-16 place-items-center rounded-3xl bg-blue-50 text-blue-700 transition group-hover:bg-blue-600 group-hover:text-white">
                    {option.icon}
                  </span>
                  <span className="block text-xl font-black text-slate-950">{option.title}</span>
                  <span className="mt-2 block text-sm font-semibold text-slate-500">{option.subtitle}</span>
                  <span className="mt-7 flex items-end justify-between gap-3">
                    <strong className="text-3xl font-black text-orange-600">{plan ? money(plan.price) : "-"}</strong>
                    <small className="rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-600">
                      / {option.unitLabel}
                    </small>
                  </span>
                  {plan?.description ? <span className="mt-4 block text-xs font-bold text-slate-400">{plan.description}</span> : null}
                </button>
              );
            })}
            {activePlans.length === 0 ? (
              <div className="posui-empty-state md:col-span-2">
                {lang === "th" ? "ยังไม่มีชุดราคาบุฟเฟ่ที่เปิดใช้งาน" : "No active buffet price plan."}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-2 grid gap-6 lg:grid-cols-[minmax(0,1fr)_250px]">
            <section className="rounded-3xl border border-slate-200 bg-slate-50 p-6">
              <div className="flex items-start gap-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-3xl bg-blue-600 text-white">
                  {selectedOption?.icon ?? <QuantityKeypadIcon />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-black text-slate-500">{selectedOption?.title ?? selectedPlan.name}</p>
                  <h3 className="truncate text-2xl font-black text-slate-950">{selectedPlan.name}</h3>
                  <p className="mt-1 text-sm font-bold text-slate-500">
                    {money(selectedPlan.price)} / {selectedOption?.unitLabel ?? (lang === "th" ? "หน่วย" : "unit")}
                  </p>
                </div>
              </div>

              <div className="mt-7 rounded-3xl border border-dashed border-blue-200 bg-white p-6">
                <p className="text-sm font-black text-slate-500">{lang === "th" ? "จำนวน" : "Quantity"}</p>
                <div className="mt-3 text-6xl font-black tracking-tight text-blue-700">{quantityInput || "0"}</div>
              </div>

              <div className="mt-6 flex items-center justify-between rounded-3xl bg-white p-6 shadow-sm">
                <span className="text-sm font-black text-slate-500">{lang === "th" ? "รวมรายการบุฟเฟ่" : "Buffet total"}</span>
                <strong className="text-4xl font-black text-orange-600">{money(total)}</strong>
              </div>
              {resolveError ? <p className="mt-4 rounded-2xl bg-red-50 p-3 text-sm font-bold text-red-700">{resolveError}</p> : null}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm" aria-label={lang === "th" ? "แป้นตัวเลข" : "Numeric keypad"}>
              <div className="mb-4 flex items-center gap-2 px-1 text-sm font-black text-slate-500">
                <QuantityKeypadIcon />
                <span>{lang === "th" ? "แป้นตัวเลข" : "Keypad"}</span>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {keypadKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="h-14 rounded-2xl border border-slate-200 bg-slate-50 text-xl font-black text-slate-950 transition hover:border-blue-300 hover:bg-blue-50"
                    onClick={() => appendKey(key)}
                    disabled={actionBusy}
                  >
                    {key}
                  </button>
                ))}
                <button
                  type="button"
                  className="h-14 rounded-2xl border border-slate-200 bg-white text-sm font-black text-slate-700 transition hover:bg-slate-50"
                  onClick={clearQuantity}
                  disabled={actionBusy}
                >
                  {lang === "th" ? "ล้าง" : "Clear"}
                </button>
                <button
                  type="button"
                  className="col-span-2 h-14 rounded-2xl border border-slate-200 bg-white text-sm font-black text-slate-700 transition hover:bg-slate-50"
                  onClick={deleteQuantity}
                  disabled={actionBusy}
                >
                  {lang === "th" ? "ลบ" : "Delete"}
                </button>
              </div>
            </section>
          </div>
        )}

        <footer className="posui-modal__actions mt-7 flex flex-wrap justify-end gap-4 pt-2">
          {selectedPlan ? (
            <button type="button" className="posui-btn posui-btn--ghost min-w-28" onClick={() => setSelectedPlan(null)} disabled={actionBusy}>
              {lang === "th" ? "ย้อนกลับ" : "Back"}
            </button>
          ) : null}
          <button type="button" className="posui-btn posui-btn--ghost min-w-28" onClick={closeModal} disabled={actionBusy}>
            {lang === "th" ? "ยกเลิก" : "Cancel"}
          </button>
          {selectedPlan ? (
            <button type="button" className="posui-btn posui-btn--primary min-w-28" disabled={actionBusy || quantity <= 0} onClick={() => { void confirmQuantity(); }}>
              {resolvingProduct ? (lang === "th" ? "กำลังเตรียม..." : "Preparing...") : lang === "th" ? "ยืนยัน" : "Confirm"}
            </button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}
