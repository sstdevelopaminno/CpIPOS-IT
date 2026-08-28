"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";
import styles from "./store-provisioning-console.module.css";

export type ProvisioningPackageOption = {
  id: string;
  code: string;
  name: string;
  monthly_price: number;
  yearly_price: number;
  max_branches: number;
  max_devices: number;
  max_users: number;
  quota_mode: string;
};

type BillingInterval = "monthly" | "yearly";

type ProvisioningResult = {
  request_id: string;
  store_code: string;
  tenant: { id: string; name: string };
  branch: { id: string; code: string; name: string };
  package: {
    code: string;
    name: string;
    amount_per_cycle: number;
    billing_interval: string;
    currency: string;
    max_branches: number;
    max_devices: number;
    max_users: number;
  };
  owner: { user_id: string; name: string; email: string; employee_code: string; role: "owner" };
  activation: { status: "ready_for_device_enrollment"; next_step: "register_device" };
};

type ApiPayload = { data: ProvisioningResult | null; error: { code: string; message: string } | null };

type FormState = {
  storeName: string;
  packageId: string;
  billingInterval: BillingInterval;
  branchCode: string;
  branchName: string;
  branchAddress: string;
  ownerName: string;
  ownerEmail: string;
  ownerPhone: string;
  employeeCode: string;
  pin: string;
};

const copy = {
  th: {
    flow: "Tenant → Store Code → Trial Package → สาขาหลัก → Owner → Login Policy → Device Enrollment",
    request: "Request ID",
    sectionStore: "1. ร้านและแพ็กเกจ",
    sectionBranch: "2. สาขาหลัก",
    sectionOwner: "3. Owner คนแรก",
    storeName: "ชื่อร้าน",
    package: "แพ็กเกจ",
    billing: "รอบราคาอ้างอิง",
    monthly: "รายเดือน",
    yearly: "รายปี",
    trialOnly: "เปิดร้านใหม่เป็น Trial เท่านั้น",
    paidApproval: "การเปิดใช้งานแบบชำระเงินต้องผ่าน approval flow เดิมหลังจากสร้างร้านแล้ว",
    branchCode: "รหัสสาขา",
    branchName: "ชื่อสาขา",
    branchAddress: "ที่อยู่สาขา",
    ownerName: "ชื่อ Owner",
    email: "อีเมล",
    phone: "โทรศัพท์",
    employeeCode: "รหัสพนักงาน",
    pin: "PIN 4–8 หลัก",
    pinNote: "PIN จะถูก hash ด้วย bcrypt ฝั่ง server และไม่ถูกเก็บเป็น plaintext ใน provisioning ledger",
    create: "ตรวจสอบก่อนเปิดร้าน",
    submitting: "กำลังเปิดร้าน…",
    emptyTitle: "ยังไม่มีแพ็กเกจที่เปิดร้านได้",
    emptyDesc: "Fast Provisioning ใช้เฉพาะแพ็กเกจ standard ที่ Active และมีราคาสำหรับรอบบิลอย่างน้อยหนึ่งแบบ",
    invalidPackage: "แพ็กเกจนี้ยังไม่พร้อมสำหรับ Fast Provisioning",
    successTitle: "เปิดร้านสำเร็จ",
    storeCode: "Store Code สำหรับลูกค้า",
    nextStep: "ขั้นถัดไป",
    deviceEnrollment: "Device Enrollment / Android / Print Agent",
    openNext: "เปิดร้านถัดไป",
    viewStores: "ดูร้านค้าทั้งหมด",
    retrySame: "หากเกิด network error หรือ Owner step ล้มเหลว ให้ใช้ Request ID เดิมเพื่อป้องกัน Tenant ซ้ำ",
    confirmTitle: "ยืนยันการเปิดร้านใหม่",
    confirmDesc: "การยืนยันจะสร้างข้อมูลจริงใน CpiPOS-001 รวม Tenant, Store Code, Trial contract, สาขาหลัก และ Owner account",
    confirmStore: "ร้าน",
    confirmPackage: "แพ็กเกจ / Trial",
    confirmBranch: "สาขาหลัก",
    confirmOwner: "Owner",
    confirmPin: "PIN",
    pinHidden: "กำหนดแล้ว · ไม่แสดงค่า",
    cancel: "ยกเลิก",
    confirm: "ยืนยันและสร้างร้าน",
    standardOnly: "Fast Provisioning",
    branches: "สาขา",
    devices: "อุปกรณ์",
    users: "ผู้ใช้"
  },
  en: {
    flow: "Tenant → Store Code → Trial Package → Main Branch → Owner → Login Policy → Device Enrollment",
    request: "Request ID",
    sectionStore: "1. Store & package",
    sectionBranch: "2. Main branch",
    sectionOwner: "3. First Owner",
    storeName: "Store name",
    package: "Package",
    billing: "Reference billing interval",
    monthly: "Monthly",
    yearly: "Yearly",
    trialOnly: "New stores start as Trial only",
    paidApproval: "Paid activation remains behind the existing approval flow after the store is provisioned.",
    branchCode: "Branch code",
    branchName: "Branch name",
    branchAddress: "Branch address",
    ownerName: "Owner name",
    email: "Email",
    phone: "Phone",
    employeeCode: "Employee code",
    pin: "PIN · 4–8 digits",
    pinNote: "The PIN is bcrypt-hashed on the server and is never stored as plaintext in the provisioning ledger.",
    create: "Review before provisioning",
    submitting: "Provisioning…",
    emptyTitle: "No package is eligible for provisioning",
    emptyDesc: "Fast Provisioning only accepts active standard packages with at least one priced billing interval.",
    invalidPackage: "This package is not eligible for Fast Provisioning",
    successTitle: "Store provisioned",
    storeCode: "Customer Store Code",
    nextStep: "Next step",
    deviceEnrollment: "Device Enrollment / Android / Print Agent",
    openNext: "Provision another store",
    viewStores: "View all stores",
    retrySame: "For a network error or Owner-step failure, retry with the same Request ID to prevent duplicate tenants.",
    confirmTitle: "Confirm new store provisioning",
    confirmDesc: "Confirmation creates real CpiPOS-001 records for the Tenant, Store Code, Trial contract, main branch, and Owner account.",
    confirmStore: "Store",
    confirmPackage: "Package / Trial",
    confirmBranch: "Main branch",
    confirmOwner: "Owner",
    confirmPin: "PIN",
    pinHidden: "Configured · value hidden",
    cancel: "Cancel",
    confirm: "Confirm and provision",
    standardOnly: "Fast Provisioning",
    branches: "branches",
    devices: "devices",
    users: "users"
  }
} as const;

function newRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function money(value: number, language: Language, currency = "THB") {
  return new Intl.NumberFormat(language === "th" ? "th-TH" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0
  }).format(value);
}

function eligibleIntervals(item: ProvisioningPackageOption | null): BillingInterval[] {
  if (!item || item.quota_mode !== "standard") return [];
  const intervals: BillingInterval[] = [];
  if (item.monthly_price > 0) intervals.push("monthly");
  if (item.yearly_price > 0) intervals.push("yearly");
  return intervals;
}

function initialForm(packages: ProvisioningPackageOption[]): FormState {
  const defaultPackage = packages.find((item) => eligibleIntervals(item).length > 0) ?? null;
  return {
    storeName: "",
    packageId: defaultPackage?.id ?? "",
    billingInterval: eligibleIntervals(defaultPackage)[0] ?? "monthly",
    branchCode: "001",
    branchName: "สาขาหลัก",
    branchAddress: "",
    ownerName: "",
    ownerEmail: "",
    ownerPhone: "",
    employeeCode: "100001",
    pin: ""
  };
}

export function StoreProvisioningConsole({ packages, language }: { packages: ProvisioningPackageOption[]; language: Language }) {
  const text = copy[language];
  const eligiblePackages = useMemo(
    () => packages.filter((item) => item.quota_mode === "standard" && eligibleIntervals(item).length > 0),
    [packages]
  );
  const [requestId, setRequestId] = useState(newRequestId);
  const [submitting, setSubmitting] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [result, setResult] = useState<ProvisioningResult | null>(null);
  const [form, setForm] = useState<FormState>(() => initialForm(packages));

  const selectedPackage = eligiblePackages.find((item) => item.id === form.packageId) ?? null;
  const intervals = eligibleIntervals(selectedPackage);
  const billingPrice =
    form.billingInterval === "yearly" ? selectedPackage?.yearly_price ?? 0 : selectedPackage?.monthly_price ?? 0;
  const packageBlocked = !selectedPackage || !intervals.includes(form.billingInterval) || billingPrice <= 0;

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updatePackage(packageId: string) {
    const nextPackage = eligiblePackages.find((item) => item.id === packageId) ?? null;
    const nextIntervals = eligibleIntervals(nextPackage);
    setForm((current) => ({
      ...current,
      packageId,
      billingInterval: nextIntervals.includes(current.billingInterval) ? current.billingInterval : nextIntervals[0] ?? "monthly"
    }));
  }

  function beginReview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || packageBlocked) return;
    setError(null);
    setReviewOpen(true);
  }

  async function submitProvisioning() {
    if (submitting || packageBlocked) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/it-admin/v1/store-provisioning", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          request_id: requestId,
          store: { name: form.storeName, owner_phone: form.ownerPhone || null },
          package_id: form.packageId,
          contract: { status: "trial", billing_interval: form.billingInterval },
          initial_branch: { code: form.branchCode, name: form.branchName, address: form.branchAddress || null },
          owner: {
            name: form.ownerName,
            email: form.ownerEmail,
            phone: form.ownerPhone || null,
            employee_code: form.employeeCode,
            pin: form.pin
          }
        })
      });
      const payload = (await response.json().catch(() => null)) as ApiPayload | null;
      if (!response.ok || !payload?.data) {
        setReviewOpen(false);
        setError(payload?.error ?? { code: "store_provisioning_failed", message: "Store provisioning failed." });
        return;
      }
      setReviewOpen(false);
      setResult(payload.data);
      setForm((current) => ({ ...current, pin: "" }));
    } catch {
      setReviewOpen(false);
      setError({
        code: "store_provisioning_network_failed",
        message:
          language === "th"
            ? "การเชื่อมต่อขัดข้อง กรุณาลองซ้ำด้วย Request ID เดิม ระบบ idempotency จะป้องกันการสร้าง Tenant ซ้ำ"
            : "Network failure. Retry with the same Request ID; idempotency prevents duplicate tenants."
      });
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setRequestId(newRequestId());
    setError(null);
    setResult(null);
    setReviewOpen(false);
    setForm(initialForm(packages));
  }

  if (eligiblePackages.length === 0) {
    return (
      <section className={styles.emptyState}>
        <span className={styles.emptyIcon}>!</span>
        <div>
          <h2>{text.emptyTitle}</h2>
          <p>{text.emptyDesc}</p>
        </div>
      </section>
    );
  }

  if (result) {
    return (
      <section className={styles.successState} aria-live="polite">
        <div className={styles.successHero}>
          <span className={styles.successMark}>✓</span>
          <div>
            <span>{text.successTitle}</span>
            <strong>{result.store_code}</strong>
            <small>{text.storeCode}</small>
          </div>
        </div>

        <div className={styles.successGrid}>
          <div><span>{text.confirmStore}</span><strong>{result.tenant.name}</strong></div>
          <div><span>{text.confirmBranch}</span><strong>{result.branch.code} · {result.branch.name}</strong></div>
          <div><span>{text.package}</span><strong>{result.package.name}</strong><small>{money(result.package.amount_per_cycle, language, result.package.currency)} · {result.package.billing_interval}</small></div>
          <div><span>{text.confirmOwner}</span><strong>{result.owner.employee_code}</strong><small>{result.owner.email}</small></div>
        </div>

        <div className={styles.nextStep}>
          <span>{text.nextStep}</span>
          <strong>{text.deviceEnrollment}</strong>
          <small>Device module will bind the approved terminal to this tenant/branch without rebuilding the POS app.</small>
        </div>

        <div className={styles.successActions}>
          <button type="button" onClick={reset}>{text.openNext}</button>
          <Link href="/it-admin/tenants">{text.viewStores}</Link>
        </div>
      </section>
    );
  }

  return (
    <>
      <form className={styles.console} onSubmit={beginReview}>
        <div className={styles.flowHeader}>
          <div>
            <span className={styles.flowBadge}>{text.standardOnly}</span>
            <p>{text.flow}</p>
          </div>
          <code title={requestId}>{text.request}: {requestId}</code>
        </div>

        <section className={styles.formSection}>
          <div className={styles.sectionHeading}>
            <h2>{text.sectionStore}</h2>
            <span className={styles.trialBadge}>Trial</span>
          </div>
          <div className={styles.formGrid}>
            <label>
              <span>{text.storeName}</span>
              <input required maxLength={180} value={form.storeName} onChange={(event) => update("storeName", event.target.value)} />
            </label>
            <label>
              <span>{text.package}</span>
              <select required value={form.packageId} onChange={(event) => updatePackage(event.target.value)}>
                {eligiblePackages.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.code}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{text.billing}</span>
              <select
                value={form.billingInterval}
                onChange={(event) => update("billingInterval", event.target.value as BillingInterval)}
              >
                <option value="monthly" disabled={!intervals.includes("monthly")}>{text.monthly}</option>
                <option value="yearly" disabled={!intervals.includes("yearly")}>{text.yearly}</option>
              </select>
            </label>
          </div>

          {selectedPackage ? (
            <div className={styles.packageSummary}>
              <div><span>{selectedPackage.name}</span><strong>{money(billingPrice, language)}</strong></div>
              <div><span>{text.branches}</span><strong>{selectedPackage.max_branches}</strong></div>
              <div><span>{text.devices}</span><strong>{selectedPackage.max_devices}</strong></div>
              <div><span>{text.users}</span><strong>{selectedPackage.max_users}</strong></div>
            </div>
          ) : (
            <div className={styles.inlineError}>{text.invalidPackage}</div>
          )}

          <div className={styles.policyNotice}>
            <strong>{text.trialOnly}</strong>
            <span>{text.paidApproval}</span>
          </div>
        </section>

        <section className={styles.formSection}>
          <div className={styles.sectionHeading}><h2>{text.sectionBranch}</h2></div>
          <div className={styles.formGrid}>
            <label>
              <span>{text.branchCode}</span>
              <input required maxLength={40} value={form.branchCode} onChange={(event) => update("branchCode", event.target.value)} />
            </label>
            <label>
              <span>{text.branchName}</span>
              <input required maxLength={180} value={form.branchName} onChange={(event) => update("branchName", event.target.value)} />
            </label>
            <label className={styles.fullField}>
              <span>{text.branchAddress}</span>
              <textarea maxLength={500} rows={3} value={form.branchAddress} onChange={(event) => update("branchAddress", event.target.value)} />
            </label>
          </div>
        </section>

        <section className={styles.formSection}>
          <div className={styles.sectionHeading}><h2>{text.sectionOwner}</h2></div>
          <div className={styles.formGrid}>
            <label>
              <span>{text.ownerName}</span>
              <input required maxLength={180} value={form.ownerName} onChange={(event) => update("ownerName", event.target.value)} />
            </label>
            <label>
              <span>{text.email}</span>
              <input required type="email" maxLength={254} autoComplete="email" value={form.ownerEmail} onChange={(event) => update("ownerEmail", event.target.value)} />
            </label>
            <label>
              <span>{text.phone}</span>
              <input maxLength={40} inputMode="tel" autoComplete="tel" value={form.ownerPhone} onChange={(event) => update("ownerPhone", event.target.value)} />
            </label>
            <label>
              <span>{text.employeeCode}</span>
              <input
                required
                inputMode="numeric"
                pattern="[0-9]{1,32}"
                value={form.employeeCode}
                onChange={(event) => update("employeeCode", event.target.value.replace(/\D/g, "").slice(0, 32))}
              />
            </label>
            <label>
              <span>{text.pin}</span>
              <input
                required
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                pattern="[0-9]{4,8}"
                value={form.pin}
                onChange={(event) => update("pin", event.target.value.replace(/\D/g, "").slice(0, 8))}
              />
            </label>
          </div>
          <p className={styles.securityNote}>{text.pinNote}</p>
        </section>

        {error ? (
          <div className={styles.errorState} role="alert">
            <strong>{error.code}</strong>
            <span>{error.message}</span>
            <small>{text.retrySame}</small>
          </div>
        ) : null}

        <div className={styles.formFooter}>
          <span>{text.retrySame}</span>
          <button disabled={submitting || packageBlocked} type="submit">
            {submitting ? text.submitting : text.create}
          </button>
        </div>
      </form>

      {reviewOpen && selectedPackage ? (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={() => !submitting && setReviewOpen(false)}>
          <section
            className={styles.confirmDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="store-provisioning-confirm-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className={styles.confirmHeader}>
              <span className={styles.confirmIcon}>!</span>
              <div>
                <h2 id="store-provisioning-confirm-title">{text.confirmTitle}</h2>
                <p>{text.confirmDesc}</p>
              </div>
            </div>

            <dl className={styles.reviewList}>
              <div><dt>{text.confirmStore}</dt><dd>{form.storeName}</dd></div>
              <div><dt>{text.confirmPackage}</dt><dd>{selectedPackage.name} · Trial · {money(billingPrice, language)} / {form.billingInterval}</dd></div>
              <div><dt>{text.confirmBranch}</dt><dd>{form.branchCode} · {form.branchName}</dd></div>
              <div><dt>{text.confirmOwner}</dt><dd>{form.ownerName} · {form.ownerEmail} · #{form.employeeCode}</dd></div>
              <div><dt>{text.confirmPin}</dt><dd>{text.pinHidden}</dd></div>
            </dl>

            <div className={styles.confirmFooter}>
              <button type="button" className={styles.secondaryButton} disabled={submitting} onClick={() => setReviewOpen(false)}>
                {text.cancel}
              </button>
              <button type="button" className={styles.primaryButton} disabled={submitting} onClick={() => void submitProvisioning()}>
                {submitting ? text.submitting : text.confirm}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
