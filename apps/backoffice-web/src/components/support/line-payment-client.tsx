"use client";

import Image from "next/image";
import Script from "next/script";
import { FormEvent, useCallback, useEffect, useState } from "react";

type LiffApi = {
  init(input: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(input?: { redirectUri?: string }): void;
  getIDToken(): string | null;
  isInClient(): boolean;
  closeWindow(): void;
};

declare global {
  interface Window {
    liff?: LiffApi;
  }
}

type Store = {
  code: string;
  name: string;
  logo_url: string | null;
};

type PublicPaymentAccount = {
  bank_name: string;
  account_name: string;
  account_number: string;
  promptpay_id: string;
  bank_transfer_ready: boolean;
  promptpay_ready: boolean;
};

type PackagePayment = {
  store: { code: string; name: string };
  package: {
    code: string | null;
    name: string;
    billing_interval: string | null;
    service_end: string | null;
  };
  due: null | {
    cycle_id: string;
    amount_due: number;
    amount_paid: number;
    outstanding_amount: number;
    currency: string;
    period_start: string;
    period_end: string;
  };
  payment_account: PublicPaymentAccount;
  qr_url: string | null;
  qr_page_url: string | null;
};

type AuthResult =
  | { state: "ready"; store: Store }
  | {
      state: "verification_required";
      challenge_id: string;
      masked_email: string;
      expires_in_seconds: number;
      store: Store;
    };

type Envelope<T> = {
  data?: T;
  error?: { code?: string; message?: string };
};

type Stage = "boot" | "home" | "package-store" | "otp" | "package-payment" | "general";

const LIFF_SCRIPT = "https://static.line-scdn.net/liff/edge/2/sdk.js";
const DEFAULT_LIFF_ID = "2011852850-5tjQo09l";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });
  const body = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || !body?.data) {
    throw new Error(body?.error?.message || "ทำรายการไม่สำเร็จ กรุณาลองใหม่");
  }
  return body.data;
}

function money(value: number, currency = "THB") {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2
  }).format(value);
}

function thaiDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value.length <= 10 ? value + "T00:00:00+07:00" : value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeZone: "Asia/Bangkok"
  }).format(parsed);
}

function maskPromptPay(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return digits;
  return "••••••" + digits.slice(-4);
}

function CopyButton({ value, label = "คัดลอก" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard can be blocked in some LINE/WebView contexts.
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600"
    >
      {copied ? "คัดลอกแล้ว" : label}
    </button>
  );
}

export function LinePaymentClient() {
  const liffId = process.env.NEXT_PUBLIC_LINE_LIFF_ID || DEFAULT_LIFF_ID;
  const [stage, setStage] = useState<Stage>("boot");
  const [idToken, setIdToken] = useState("");
  const [storeCode, setStoreCode] = useState("");
  const [store, setStore] = useState<Store | null>(null);
  const [challengeId, setChallengeId] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [packagePayment, setPackagePayment] = useState<PackagePayment | null>(null);
  const [generalAccount, setGeneralAccount] = useState<PublicPaymentAccount | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const boot = useCallback(async () => {
    setError("");
    try {
      if (!window.liff) throw new Error("โหลด LINE LIFF ไม่สำเร็จ");
      await window.liff.init({ liffId });
      if (!window.liff.isLoggedIn()) {
        window.liff.login({ redirectUri: window.location.href });
        return;
      }
      const token = window.liff.getIDToken();
      if (!token) throw new Error("LINE Login ไม่ได้อนุญาต openid กรุณาเปิดเมนูชำระเงินใหม่");
      setIdToken(token);
      const remembered = window.localStorage.getItem("cpipos_line_support_store_code") || "";
      if (/^\d{6}$/.test(remembered)) setStoreCode(remembered);
      setStage("home");
    } catch (cause) {
      setStage("home");
      setError(cause instanceof Error ? cause.message : "เริ่มระบบชำระเงินไม่สำเร็จ");
    }
  }, [liffId]);

  useEffect(() => {
    if (window.liff) void boot();
  }, [boot]);

  async function loadPackagePayment() {
    const result = await api<{ payment: PackagePayment }>("/api/support/line/payment/package");
    setPackagePayment(result.payment);
    setStage("package-payment");
  }

  async function startPackage(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(storeCode)) {
      setError("กรุณากรอกรหัสร้าน 6 หลัก");
      return;
    }
    if (!idToken) {
      setError("ยังไม่ได้เชื่อม LINE Login กรุณาเปิดเมนูชำระเงินใหม่");
      return;
    }

    setBusy("package-auth");
    setError("");
    try {
      const result = await api<AuthResult>("/api/support/line/payment/auth", {
        method: "POST",
        body: JSON.stringify({ action: "start", id_token: idToken, store_code: storeCode })
      });
      setStore(result.store);
      window.localStorage.setItem("cpipos_line_support_store_code", storeCode);
      if (result.state === "verification_required") {
        setChallengeId(result.challenge_id);
        setMaskedEmail(result.masked_email);
        setStage("otp");
      } else {
        await loadPackagePayment();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ตรวจสอบร้านไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function verifyOtp(event: FormEvent) {
    event.preventDefault();
    setBusy("verify");
    setError("");
    try {
      const result = await api<AuthResult>("/api/support/line/payment/auth", {
        method: "POST",
        body: JSON.stringify({
          action: "verify",
          id_token: idToken,
          store_code: storeCode,
          challenge_id: challengeId,
          otp
        })
      });
      setStore(result.store);
      await loadPackagePayment();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ยืนยัน OTP ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function openGeneral() {
    if (!idToken) {
      setError("ยังไม่ได้เชื่อม LINE Login กรุณาเปิดเมนูชำระเงินใหม่");
      return;
    }
    setBusy("general");
    setError("");
    try {
      const result = await api<{ account: PublicPaymentAccount }>("/api/support/line/payment/general", {
        method: "POST",
        body: JSON.stringify({ id_token: idToken })
      });
      setGeneralAccount(result.account);
      setStage("general");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดบัญชีรับชำระไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  function backHome() {
    setError("");
    setOtp("");
    setChallengeId("");
    setMaskedEmail("");
    setStage("home");
  }

  return (
    <>
      <Script src={LIFF_SCRIPT} strategy="afterInteractive" onLoad={() => void boot()} />
      <main className="min-h-dvh bg-gradient-to-b from-blue-50 via-white to-slate-100 px-4 py-5 text-slate-950">
        <section className="mx-auto flex min-h-[calc(100dvh-2.5rem)] w-full max-w-md flex-col overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-xl">
          <header className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-5 py-4">
            <div className="grid h-12 w-12 place-items-center overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
              <Image src="/brand/cpipos-symbol-sidebar.png" alt="CpIPOS" width={42} height={42} className="h-10 w-10 object-contain" priority />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-black">CpIPOS Payment</div>
              <div className="text-xs text-slate-500">ชำระค่าบริการและบัญชีบริษัท</div>
            </div>
            {stage !== "home" && stage !== "boot" ? (
              <button type="button" onClick={backHome} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-600">
                กลับ
              </button>
            ) : null}
          </header>

          {stage === "boot" ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <div>
                <div className="mx-auto h-9 w-9 animate-spin rounded-full border-4 border-blue-100 border-t-blue-600" />
                <div className="mt-4 text-sm font-bold text-slate-700">กำลังเปิด Payment Center…</div>
              </div>
            </div>
          ) : null}

          {stage === "home" ? (
            <div className="flex flex-1 flex-col justify-center p-5">
              <div>
                <p className="text-xs font-black tracking-[0.18em] text-blue-600">PAYMENT CENTER</p>
                <h1 className="mt-2 text-2xl font-black">เลือกประเภทการชำระเงิน</h1>
                <p className="mt-2 text-sm leading-6 text-slate-500">เลือกชำระแพ็กเกจ CpIPOS ของร้าน หรือดูบัญชีบริษัทสำหรับการชำระทั่วไป</p>
              </div>

              <div className="mt-7 grid gap-4">
                <button
                  type="button"
                  onClick={() => { setError(""); setStage("package-store"); }}
                  className="rounded-3xl border border-blue-200 bg-gradient-to-br from-blue-600 to-blue-700 p-5 text-left text-white shadow-lg shadow-blue-100"
                >
                  <div className="text-3xl">🧾</div>
                  <div className="mt-5 text-lg font-black">ชำระแพ็กเกจ CpIPOS</div>
                  <div className="mt-1 text-sm leading-6 text-blue-100">ตรวจรหัสร้าน ดึงยอดค้างรอบล่าสุด และสร้าง QR พร้อมเพย์แบบล็อกยอด</div>
                </button>

                <button
                  type="button"
                  disabled={busy === "general"}
                  onClick={() => void openGeneral()}
                  className="rounded-3xl border border-slate-200 bg-white p-5 text-left shadow-sm disabled:opacity-50"
                >
                  <div className="text-3xl">🏦</div>
                  <div className="mt-5 text-lg font-black text-slate-900">ชำระเงินทั่วไป</div>
                  <div className="mt-1 text-sm leading-6 text-slate-500">ดูชื่อบัญชี ธนาคาร และเลขที่บัญชีรับชำระของบริษัท</div>
                </button>
              </div>

              {error ? <div className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
            </div>
          ) : null}

          {stage === "package-store" ? (
            <div className="flex flex-1 flex-col justify-center p-6">
              <div className="text-2xl font-black">ชำระแพ็กเกจ CpIPOS</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">กรอกรหัสร้าน 6 หลัก ระบบจะตรวจรอบชำระล่าสุดจาก Billing โดยตรง</p>
              <form onSubmit={startPackage} className="mt-6 space-y-4">
                <label className="block">
                  <span className="mb-2 block text-xs font-black text-slate-600">รหัสร้าน</span>
                  <input
                    value={storeCode}
                    onChange={(event) => setStoreCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    placeholder="000000"
                    className="w-full rounded-2xl border border-slate-300 px-4 py-4 text-center text-2xl font-black tracking-[0.28em] outline-none focus:border-blue-500"
                  />
                </label>
                {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
                <button
                  type="submit"
                  disabled={busy === "package-auth" || !idToken}
                  className="w-full rounded-2xl bg-blue-600 px-4 py-4 text-sm font-black text-white disabled:opacity-50"
                >
                  {busy === "package-auth" ? "กำลังตรวจสอบ…" : "ตรวจสอบยอดชำระ"}
                </button>
              </form>
              <p className="mt-5 text-center text-[11px] leading-5 text-slate-400">หาก LINE นี้ยังไม่เคยผูกกับร้าน ระบบจะยืนยัน OTP กับ Owner ครั้งแรก</p>
            </div>
          ) : null}

          {stage === "otp" ? (
            <div className="flex flex-1 flex-col justify-center p-6">
              <div className="text-2xl font-black">ยืนยันร้านครั้งแรก</div>
              <p className="mt-2 text-sm leading-6 text-slate-500">ส่ง OTP ไปที่ <span className="font-black text-slate-800">{maskedEmail}</span> แล้ว</p>
              <form onSubmit={verifyOtp} className="mt-6 space-y-4">
                <input
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="OTP 6 หลัก"
                  className="w-full rounded-2xl border border-slate-300 px-4 py-4 text-center text-2xl font-black tracking-[0.28em] outline-none focus:border-blue-500"
                />
                {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
                <button type="submit" disabled={busy === "verify" || otp.length !== 6} className="w-full rounded-2xl bg-blue-600 px-4 py-4 text-sm font-black text-white disabled:opacity-50">
                  {busy === "verify" ? "กำลังยืนยัน…" : "ยืนยันและดูยอดชำระ"}
                </button>
              </form>
            </div>
          ) : null}

          {stage === "package-payment" && packagePayment ? (
            <div className="flex-1 overflow-y-auto p-5">
              <div className="rounded-2xl bg-slate-50 p-4">
                <div className="text-xs font-bold text-slate-500">ร้านค้า</div>
                <div className="mt-1 text-lg font-black">{packagePayment.store.name}</div>
                <div className="mt-1 text-xs text-slate-500">รหัสร้าน {packagePayment.store.code} · {packagePayment.package.name}</div>
              </div>

              {!packagePayment.due ? (
                <div className="mt-5 rounded-3xl border border-emerald-200 bg-emerald-50 p-6 text-center">
                  <div className="text-4xl">✓</div>
                  <div className="mt-3 text-xl font-black text-emerald-800">ยังไม่มียอดชำระ</div>
                  <p className="mt-2 text-sm leading-6 text-emerald-700">ระบบยังไม่พบ Billing Cycle ที่มียอดค้าง จึงยังไม่สร้าง QR ชำระเงิน</p>
                  {packagePayment.package.service_end ? (
                    <div className="mt-4 rounded-2xl bg-white/70 px-4 py-3 text-sm text-emerald-900">วันสิ้นสุดบริการปัจจุบัน: <strong>{thaiDate(packagePayment.package.service_end)}</strong></div>
                  ) : null}
                </div>
              ) : (
                <>
                  <div className="mt-5 rounded-3xl border border-blue-100 bg-blue-50 p-5 text-center">
                    <div className="text-xs font-black tracking-[0.14em] text-blue-600">ยอดค้างชำระล่าสุด</div>
                    <div className="mt-2 text-4xl font-black text-slate-950">{money(packagePayment.due.outstanding_amount, packagePayment.due.currency)}</div>
                    <div className="mt-2 text-xs text-slate-500">รอบ {thaiDate(packagePayment.due.period_start)} – {thaiDate(packagePayment.due.period_end)}</div>
                  </div>

                  {packagePayment.qr_url ? (
                    <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5 text-center shadow-sm">
                      <div className="text-sm font-black">สแกน QR พร้อมเพย์</div>
                      <div className="mx-auto mt-4 w-fit rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
                        <Image
                          src={packagePayment.qr_url}
                          alt={"PromptPay QR ยอด " + packagePayment.due.outstanding_amount + " บาท"}
                          width={260}
                          height={260}
                          unoptimized
                          className="h-[260px] w-[260px] object-contain"
                        />
                      </div>
                      <div className="mt-3 text-xs text-slate-500">พร้อมเพย์ {maskPromptPay(packagePayment.payment_account.promptpay_id)}</div>
                      <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-semibold leading-5 text-amber-800">QR นี้ล็อกจำนวนเงินตามยอดค้างของร้าน ลูกค้าไม่ต้องกรอกยอดเอง</div>
                    </div>
                  ) : (
                    <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-800">
                      พบยอดค้างชำระแล้ว แต่ฝั่ง IT ยังไม่ได้ตั้งค่าหมายเลขพร้อมเพย์ จึงยังไม่สามารถสร้าง QR ได้
                    </div>
                  )}
                </>
              )}
            </div>
          ) : null}

          {stage === "general" && generalAccount ? (
            <div className="flex flex-1 flex-col justify-center p-5">
              <div>
                <p className="text-xs font-black tracking-[0.16em] text-blue-600">GENERAL PAYMENT</p>
                <h1 className="mt-2 text-2xl font-black">บัญชีรับชำระ</h1>
                <p className="mt-2 text-sm leading-6 text-slate-500">ใช้สำหรับการชำระเงินทั่วไปที่ไม่ได้ผูกกับรอบแพ็กเกจของร้าน</p>
              </div>

              {generalAccount.bank_transfer_ready ? (
                <div className="mt-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-lg shadow-slate-100">
                  <div className="bg-gradient-to-br from-slate-900 to-slate-700 p-5 text-white">
                    <div className="text-xs font-bold text-white/60">ธนาคาร</div>
                    <div className="mt-1 text-xl font-black">{generalAccount.bank_name}</div>
                  </div>
                  <div className="space-y-4 p-5">
                    <div>
                      <div className="text-xs font-bold text-slate-400">ชื่อบัญชี</div>
                      <div className="mt-1 text-base font-black text-slate-900">{generalAccount.account_name}</div>
                    </div>
                    <div>
                      <div className="text-xs font-bold text-slate-400">เลขที่บัญชี</div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="break-all text-xl font-black tracking-[0.08em] text-slate-950">{generalAccount.account_number}</div>
                        <CopyButton value={generalAccount.account_number} />
                      </div>
                    </div>
                    {generalAccount.promptpay_ready ? (
                      <div className="border-t border-slate-100 pt-4">
                        <div className="text-xs font-bold text-slate-400">พร้อมเพย์รับชำระ</div>
                        <div className="mt-2 flex items-center justify-between gap-3">
                          <div className="font-black text-slate-800">{generalAccount.promptpay_id}</div>
                          <CopyButton value={generalAccount.promptpay_id} />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-800">ฝั่ง IT ยังตั้งค่าบัญชีธนาคารไม่ครบ กรุณาติดต่อ Support</div>
              )}
            </div>
          ) : null}

          {store && stage === "package-payment" ? (
            <footer className="shrink-0 border-t border-slate-100 bg-white px-5 py-3 text-center text-[11px] text-slate-400">ข้อมูลยอดชำระดึงจากระบบ Billing ของ {store.name}</footer>
          ) : null}
        </section>
      </main>
    </>
  );
}
