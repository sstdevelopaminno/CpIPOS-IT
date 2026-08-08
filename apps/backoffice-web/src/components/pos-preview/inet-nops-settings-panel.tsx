"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BranchSettings } from "@/lib/services/pos-settings-service";
import type { Language } from "@/lib/i18n";

type InetNopsSettings = {
  branch_id: string;
  environment: "uat" | "production";
  merchant_id: string;
  is_active: boolean;
  connection_status: "not_configured" | "ready" | "error" | "disabled";
  last_connection_checked_at: string | null;
  last_connection_error: string;
  last_test_order_id: string;
  callback_url: string;
  callback_is_public: boolean;
  merchant_key_configured: boolean;
  feature_enabled: boolean;
  schema_ready: boolean;
};

type ApiResponse = {
  data?: { settings?: InetNopsSettings };
  error?: { message?: string };
};

const POS_PAYMENT_SETTINGS_UPDATED_EVENT = "pos:payment-settings-updated";
const POS_PAYMENT_SETTINGS_UPDATED_KEY = "pos_payment_settings_updated_at_v001";

function signalPaymentSettingsUpdated() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(POS_PAYMENT_SETTINGS_UPDATED_KEY, new Date().toISOString());
  } catch {
    // The settings save already succeeded; storage only wakes other POS tabs.
  }
  window.dispatchEvent(new CustomEvent(POS_PAYMENT_SETTINGS_UPDATED_EVENT));
}

async function fetchJson(input: RequestInfo | URL, init?: RequestInit) {
  const response = await fetch(input, { credentials: "include", cache: "no-store", ...init });
  const body = (await response.json().catch(() => ({}))) as ApiResponse;
  if (!response.ok || body.error || !body.data?.settings) {
    throw new Error(body.error?.message || "INET QR settings request failed.");
  }
  return body.data.settings;
}

export function InetNopsSettingsPanel({
  lang,
  branches,
  activeBranchId,
  canManage,
  onBack,
  reportStatus
}: {
  lang: Language;
  branches: BranchSettings[];
  activeBranchId: string | null;
  canManage: boolean;
  onBack: () => void;
  reportStatus: (message: string, options?: { popup?: boolean }) => void;
}) {
  const copy = lang === "en"
    ? {
        title: "INET QR",
        back: "Back",
        branch: "Branch",
        uat: "UAT",
        production: "Production",
        merchantId: "Merchant ID",
        merchantKey: "Merchant Key",
        keyReady: "Configured on server",
        keyMissing: "Not configured on server",
        enabled: "Enable INET QR",
        callback: "Callback URL",
        callbackPublic: "Public HTTPS URL",
        callbackLocal: "Public HTTPS URL required for INET callback",
        copy: "Copy",
        save: "Save settings",
        testing: "Testing...",
        testUat: "Test UAT connection",
        status: "Connection status",
        packageLocked: "INET QR is not included in this branch package.",
        migrationMissing: "INET QR migration is not installed.",
        saved: "INET QR settings saved.",
        copied: "Callback URL copied.",
        testReady: "UAT connection succeeded.",
        notChecked: "Not checked",
        ready: "Ready",
        error: "Connection error",
        disabled: "Disabled"
      }
    : {
        title: "INET QR",
        back: "กลับ",
        branch: "สาขา",
        uat: "UAT",
        production: "Production",
        merchantId: "Merchant ID",
        merchantKey: "Merchant Key",
        keyReady: "ตั้งค่าไว้บนเซิร์ฟเวอร์แล้ว",
        keyMissing: "ยังไม่ได้ตั้งค่าบนเซิร์ฟเวอร์",
        enabled: "เปิดใช้ INET QR",
        callback: "Callback URL",
        callbackPublic: "Public HTTPS URL",
        callbackLocal: "ต้องใช้ Public HTTPS URL สำหรับ callback ของ INET",
        copy: "คัดลอก",
        save: "บันทึกการตั้งค่า",
        testing: "กำลังทดสอบ...",
        testUat: "ทดสอบการเชื่อมต่อ UAT",
        status: "สถานะการเชื่อมต่อ",
        packageLocked: "แพ็กเกจของสาขานี้ยังไม่ได้เปิดใช้ INET QR",
        migrationMissing: "ยังไม่ได้ติดตั้ง migration ของ INET QR",
        saved: "บันทึกการตั้งค่า INET QR แล้ว",
        copied: "คัดลอก Callback URL แล้ว",
        testReady: "เชื่อมต่อ UAT สำเร็จ",
        notChecked: "ยังไม่ได้ทดสอบ",
        ready: "พร้อมใช้งาน",
        error: "เชื่อมต่อไม่สำเร็จ",
        disabled: "ปิดใช้งาน"
      };

  const initialBranchId = activeBranchId || branches.find((branch) => branch.is_active)?.id || "";
  const [branchId, setBranchId] = useState(initialBranchId);
  const [settings, setSettings] = useState<InetNopsSettings | null>(null);
  const [merchantId, setMerchantId] = useState("");
  const [environment, setEnvironment] = useState<"uat" | "production">("uat");
  const [isActive, setIsActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nextBranchId: string) => {
    if (!nextBranchId) return;
    setLoading(true);
    setError("");
    try {
      const next = await fetchJson(`/api/pos/settings/inet-nops?branch_id=${encodeURIComponent(nextBranchId)}`);
      setSettings(next);
      setMerchantId(next.merchant_id);
      setEnvironment(next.environment);
      setIsActive(next.is_active);
    } catch (loadError) {
      setSettings(null);
      setError(loadError instanceof Error ? loadError.message : "INET QR settings request failed.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(branchId);
  }, [branchId, load]);

  const statusText = useMemo(() => {
    if (!settings || !isActive) return copy.disabled;
    if (settings.connection_status === "ready") return copy.ready;
    if (settings.connection_status === "error") return copy.error;
    return copy.notChecked;
  }, [copy.disabled, copy.error, copy.notChecked, copy.ready, isActive, settings]);

  async function save() {
    if (!branchId) return;
    setSaving(true);
    setError("");
    try {
      const next = await fetchJson("/api/pos/settings/inet-nops", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch_id: branchId, merchant_id: merchantId, environment, is_active: isActive })
      });
      setSettings(next);
      setMerchantId(next.merchant_id);
      setEnvironment(next.environment);
      setIsActive(next.is_active);
      signalPaymentSettingsUpdated();
      reportStatus(copy.saved, { popup: true });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "INET QR settings request failed.");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    if (!branchId) return;
    setTesting(true);
    setError("");
    try {
      const next = await fetchJson("/api/pos/settings/inet-nops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch_id: branchId, action: "test_connection" })
      });
      setSettings(next);
      reportStatus(copy.testReady, { popup: true });
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "INET UAT connection failed.");
    } finally {
      setTesting(false);
    }
  }

  async function copyCallbackUrl() {
    if (!settings?.callback_url) return;
    try {
      await navigator.clipboard.writeText(settings.callback_url);
      reportStatus(copy.copied);
    } catch {
      setError(settings.callback_url);
    }
  }

  const disabled = loading || saving || testing || !canManage || !settings?.feature_enabled || !settings?.schema_ready;
  return (
    <section className="grid gap-5">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-lg font-black text-slate-950">{copy.title}</h2>
          <p className="mt-1 text-sm text-slate-500">{statusText}</p>
        </div>
        <button type="button" onClick={onBack} className="min-h-10 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">
          {copy.back}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <label className="grid gap-1.5 text-sm font-bold text-slate-700">
          <span>{copy.branch}</span>
          <select value={branchId} disabled={loading || saving || testing} onChange={(event) => setBranchId(event.target.value)} className="min-h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950">
            {branches.filter((branch) => branch.is_active).map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </label>
        <div className="grid gap-1.5 text-sm font-bold text-slate-700">
          <span>{copy.merchantKey}</span>
          <div className={`flex min-h-11 items-center rounded-lg border px-3 text-sm ${settings?.merchant_key_configured ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
            {settings?.merchant_key_configured ? copy.keyReady : copy.keyMissing}
          </div>
        </div>
      </div>

      {!loading && settings && !settings.feature_enabled ? <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">{copy.packageLocked}</p> : null}
      {!loading && settings && !settings.schema_ready ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{copy.migrationMissing}</p> : null}
      {error ? <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</p> : null}

      <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid gap-2">
          <span className="text-sm font-bold text-slate-700">Environment</span>
          <div className="inline-flex w-fit rounded-lg border border-slate-200 p-1">
            <button type="button" disabled={disabled} onClick={() => setEnvironment("uat")} className={`min-h-9 rounded-md px-4 text-sm font-bold ${environment === "uat" ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"}`}>{copy.uat}</button>
            <button type="button" disabled={disabled} onClick={() => setEnvironment("production")} className={`min-h-9 rounded-md px-4 text-sm font-bold ${environment === "production" ? "bg-blue-600 text-white" : "text-slate-700 hover:bg-slate-50"}`}>{copy.production}</button>
          </div>
        </div>
        <label className="grid gap-1.5 text-sm font-bold text-slate-700">
          <span>{copy.merchantId}</span>
          <input value={merchantId} disabled={disabled} onChange={(event) => setMerchantId(event.target.value)} className="min-h-11 rounded-lg border border-slate-200 px-3 text-sm text-slate-950" />
        </label>
        <label className="inline-flex min-h-11 items-center gap-3 text-sm font-bold text-slate-800">
          <input type="checkbox" checked={isActive} disabled={disabled} onChange={(event) => setIsActive(event.target.checked)} />
          {copy.enabled}
        </label>
      </div>

      <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm font-bold text-slate-800">{copy.callback}</span>
          <span className={`text-xs font-bold ${settings?.callback_is_public ? "text-emerald-700" : "text-amber-700"}`}>{settings?.callback_is_public ? copy.callbackPublic : copy.callbackLocal}</span>
        </div>
        <div className="flex gap-2">
          <input readOnly value={settings?.callback_url ?? ""} className="min-h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700" />
          <button type="button" onClick={() => void copyCallbackUrl()} disabled={!settings?.callback_url} className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">{copy.copy}</button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void save()} disabled={disabled} className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? "..." : copy.save}</button>
        <button type="button" onClick={() => void testConnection()} disabled={disabled || environment !== "uat" || !isActive} className="min-h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 hover:bg-slate-50 disabled:opacity-50">{testing ? copy.testing : copy.testUat}</button>
      </div>
      {settings?.last_connection_checked_at ? <p className="text-xs font-medium text-slate-500">{settings.last_connection_checked_at}</p> : null}
    </section>
  );
}
