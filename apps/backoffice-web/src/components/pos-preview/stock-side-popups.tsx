"use client";

import { useMemo, useState } from "react";

type TaskItem = {
  key: string;
  label: string;
  tone: "amber" | "blue" | "emerald";
};

type DeliveryConfigItem = {
  channelLabel: string;
  rateLabel: string;
  stale: boolean;
};

type Props = {
  th: boolean;
  lowStockCount: number;
  updatedToday: number;
  loadedProductsCount: number;
  deliveryConfigs: DeliveryConfigItem[];
};

function taskToneClass(tone: TaskItem["tone"]) {
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-900";
  if (tone === "blue") return "border-blue-200 bg-blue-50 text-blue-900";
  return "border-emerald-200 bg-emerald-50 text-emerald-900";
}

export function StockSidePopups(props: Props) {
  const { th, lowStockCount, updatedToday, loadedProductsCount, deliveryConfigs } = props;
  const [taskPopup, setTaskPopup] = useState<string | null>(null);
  const [deliveryPopup, setDeliveryPopup] = useState<string | null>(null);

  const tasks = useMemo<TaskItem[]>(
    () => [
      {
        key: "low_stock",
        tone: "amber",
        label: th ? `วัตถุดิบใกล้หมด ${lowStockCount} รายการ` : `${lowStockCount} low-stock ingredient items`
      },
      {
        key: "price_update",
        tone: "blue",
        label: th ? `ตรวจสอบราคาสินค้าอัปเดต ${updatedToday} รายการ` : `Review ${updatedToday} updated pricing records`
      },
      {
        key: "loaded_products",
        tone: "emerald",
        label: th ? `สินค้าแสดงในหน้านี้ ${loadedProductsCount} รายการ` : `${loadedProductsCount} products loaded on this screen`
      }
    ],
    [loadedProductsCount, lowStockCount, th, updatedToday]
  );

  const activeTask = taskPopup ? tasks.find((task) => task.key === taskPopup) ?? null : null;
  const activeDelivery = deliveryPopup ? deliveryConfigs.find((config) => config.channelLabel === deliveryPopup) ?? null : null;

  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white p-3 lg:p-4">
        <h3 className="text-base font-extrabold text-slate-900">{th ? "งานด่วนวันนี้" : "Today Priority"}</h3>
        <div className="mt-3 grid gap-2">
          {tasks.map((task) => (
            <button
              key={task.key}
              type="button"
              onClick={() => setTaskPopup(task.key)}
              className={`w-full rounded-xl border px-3 py-2 text-left text-sm font-semibold transition hover:brightness-95 ${taskToneClass(task.tone)}`}
            >
              {task.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 lg:p-4">
        <h3 className="text-base font-extrabold text-slate-900">{th ? "เดลิเวอรี่และคอมมิชชัน" : "Delivery & Commission"}</h3>
        <p className="mt-1 text-sm text-slate-600">
          {th
            ? "ข้อมูลนี้อ่านจากตารางตั้งค่า channel จริงในฐานข้อมูล เพื่อใช้คำนวณยอดสุทธิต่อบิล"
            : "Loaded from live delivery channel config table for per-order net payout calculation."}
        </p>
        <div className="mt-3 grid gap-2">
          {deliveryConfigs.map((config) => (
            <button
              key={config.channelLabel}
              type="button"
              onClick={() => setDeliveryPopup(config.channelLabel)}
              className="inline-flex min-h-10 items-center justify-between rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
            >
              <span>{config.channelLabel}</span>
              <span className={config.stale ? "text-amber-700" : "text-emerald-700"}>{config.rateLabel}</span>
            </button>
          ))}
        </div>
      </div>

      {activeTask ? (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
            <h4 className="text-lg font-extrabold text-slate-900">{th ? "รายละเอียดงานด่วน" : "Priority Task Detail"}</h4>
            <p className="mt-2 text-sm text-slate-700">{activeTask.label}</p>
            <p className="mt-2 text-xs text-slate-500">
              {th
                ? "คุณสามารถกดไปหน้าจัดการจริงเพื่อดำเนินการต่อได้ทันที"
                : "You can continue this action from the real management page now."}
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setTaskPopup(null)}
                className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                {th ? "ปิด" : "Close"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {activeDelivery ? (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-900/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
            <h4 className="text-lg font-extrabold text-slate-900">{th ? "รายละเอียดคอมมิชชัน" : "Commission Detail"}</h4>
            <p className="mt-2 text-sm text-slate-700">{activeDelivery.channelLabel}</p>
            <p className="mt-1 text-sm font-bold text-emerald-700">{activeDelivery.rateLabel}</p>
            <p className="mt-2 text-xs text-slate-500">
              {activeDelivery.stale
                ? th
                  ? "ข้อมูลนี้ควรตรวจสอบวันที่อัปเดตจากเอกสารล่าสุดของแพลตฟอร์ม"
                  : "This config is stale and should be validated against latest platform documents."
                : th
                  ? "ข้อมูลช่องทางนี้พร้อมใช้งานสำหรับคำนวณต่อบิล"
                  : "This channel config is ready for per-order calculation."}
            </p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setDeliveryPopup(null)}
                className="inline-flex min-h-9 items-center rounded-lg border border-slate-300 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                {th ? "ปิด" : "Close"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
