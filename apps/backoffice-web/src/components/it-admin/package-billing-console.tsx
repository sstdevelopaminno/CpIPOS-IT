"use client";

import { useEffect, useMemo, useState } from "react";
import type { PackageBillingInterval, PackageContractType, PackageDeploymentMode } from "@pos/shared-types";

type PackageItem = {
  id?: string;
  code: string;
  name: string;
  baseMonthlyPrice: number;
  maxBranchesIncluded: number;
  maxTerminalsPerBranchIncluded: number;
};

type FeatureItem = {
  code: string;
  name: string;
  description: string;
  defaultMonthlyPrice: number;
  defaultYearlyPrice: number;
  defaultPerpetualPrice: number;
  includedByDefault: boolean;
  pricedPerBranch: boolean;
};

type QuoteLine = {
  code: string;
  label: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

type QuotePayload = {
  contractType: PackageContractType;
  billingInterval: PackageBillingInterval;
  deploymentMode: PackageDeploymentMode;
  lines: QuoteLine[];
  subtotal: number;
  discountAmount: number;
  total: number;
  effectiveFeatures: string[];
};

type CatalogResponse = {
  data: {
    packages: PackageItem[];
    features: FeatureItem[];
  };
  error: null | { code: string; message: string };
};

type QuoteResponse = {
  data: {
    quote: QuotePayload;
    package: PackageItem;
  };
  error: null | { code: string; message: string };
};

function formatMoney(value: number): string {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 2 }).format(value);
}

export function PackageBillingConsole() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [features, setFeatures] = useState<FeatureItem[]>([]);
  const [packageCode, setPackageCode] = useState("");
  const [contractType, setContractType] = useState<PackageContractType>("saas");
  const [billingInterval, setBillingInterval] = useState<PackageBillingInterval>("monthly");
  const [deploymentMode, setDeploymentMode] = useState<PackageDeploymentMode>("cloud");
  const [branchCount, setBranchCount] = useState(1);
  const [terminalCountPerBranch, setTerminalCountPerBranch] = useState(1);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [quoting, setQuoting] = useState(false);
  const [quote, setQuote] = useState<QuotePayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadCatalog() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/it-admin/packages", { cache: "no-store" });
        const payload = (await response.json()) as CatalogResponse;
        if (!response.ok || payload.error) {
          throw new Error(payload.error?.message ?? "Failed to load package catalog.");
        }
        if (cancelled) return;
        const nextPackages = payload.data.packages ?? [];
        const nextFeatures = payload.data.features ?? [];
        setPackages(nextPackages);
        setFeatures(nextFeatures);
        if (nextPackages.length > 0) {
          setPackageCode((current) => current || nextPackages[0].code);
        }
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : "Failed to load package catalog.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void loadCatalog();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedPackage = useMemo(() => packages.find((item) => item.code === packageCode) ?? null, [packages, packageCode]);

  async function calculateQuote() {
    if (!packageCode) return;
    setQuoting(true);
    setError(null);
    try {
      const response = await fetch("/api/it-admin/packages/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          package_code: packageCode,
          contract_type: contractType,
          billing_interval: billingInterval,
          deployment_mode: deploymentMode,
          branch_count: branchCount,
          terminal_count_per_branch: terminalCountPerBranch,
          selected_feature_codes: selectedFeatures
        })
      });
      const payload = (await response.json()) as QuoteResponse;
      if (!response.ok || payload.error) {
        throw new Error(payload.error?.message ?? "Failed to calculate quote.");
      }
      setQuote(payload.data.quote);
    } catch (quoteError) {
      setError(quoteError instanceof Error ? quoteError.message : "Failed to calculate quote.");
    } finally {
      setQuoting(false);
    }
  }

  function toggleFeature(code: string, checked: boolean) {
    setSelectedFeatures((current) => {
      if (checked) return [...new Set([...current, code])];
      return current.filter((item) => item !== code);
    });
  }

  return (
    <section className="surface" style={{ display: "grid", gap: 12 }}>
      <h2 style={{ margin: 0 }}>Package Billing Console</h2>
      <p style={{ margin: 0, color: "#475569" }}>
        ตั้งราคาและจำลองแพ็กเกจ: รายเดือน, รายปี, ซื้อขาด, แบบออนไลน์/ออฟไลน์ พร้อมเลือกฟีเจอร์เสริม
      </p>

      {loading ? <p>Loading package catalog...</p> : null}
      {error ? <p style={{ color: "#b91c1c", margin: 0 }}>{error}</p> : null}

      {!loading && packages.length > 0 ? (
        <>
          <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
            <label style={{ display: "grid", gap: 4 }}>
              <span>Package</span>
              <select value={packageCode} onChange={(event) => setPackageCode(event.target.value)}>
                {packages.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name} ({item.code})
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span>Contract</span>
              <select value={contractType} onChange={(event) => setContractType(event.target.value as PackageContractType)}>
                <option value="saas">SaaS</option>
                <option value="perpetual">Perpetual</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span>Billing</span>
              <select value={billingInterval} onChange={(event) => setBillingInterval(event.target.value as PackageBillingInterval)}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span>Deployment</span>
              <select value={deploymentMode} onChange={(event) => setDeploymentMode(event.target.value as PackageDeploymentMode)}>
                <option value="cloud">Cloud</option>
                <option value="desktop_online">Desktop Online</option>
                <option value="desktop_offline">Desktop Offline</option>
                <option value="hybrid">Hybrid</option>
              </select>
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span>Branches</span>
              <input
                type="number"
                min={1}
                value={branchCount}
                onChange={(event) => setBranchCount(Math.max(1, Number(event.target.value || 1)))}
              />
            </label>
            <label style={{ display: "grid", gap: 4 }}>
              <span>Terminals / Branch</span>
              <input
                type="number"
                min={1}
                value={terminalCountPerBranch}
                onChange={(event) => setTerminalCountPerBranch(Math.max(1, Number(event.target.value || 1)))}
              />
            </label>
          </div>

          {selectedPackage ? (
            <p style={{ margin: 0, color: "#334155" }}>
              Base: {formatMoney(selectedPackage.baseMonthlyPrice)} / month, รวม {selectedPackage.maxBranchesIncluded} สาขา และ{" "}
              {selectedPackage.maxTerminalsPerBranchIncluded} เครื่องต่อสาขา
            </p>
          ) : null}

          <div style={{ border: "1px solid #dbe3ef", borderRadius: 10, padding: 10, display: "grid", gap: 8 }}>
            <strong>Feature Add-ons</strong>
            <div style={{ display: "grid", gap: 6 }}>
              {features.map((feature) => (
                <label key={feature.code} style={{ display: "grid", gap: 2 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={selectedFeatures.includes(feature.code)}
                      onChange={(event) => toggleFeature(feature.code, event.target.checked)}
                    />
                    <strong>{feature.name}</strong>
                  </span>
                  <small style={{ color: "#64748b" }}>
                    {feature.description} | {formatMoney(feature.defaultMonthlyPrice)} / month
                    {feature.pricedPerBranch ? " / branch" : ""}
                  </small>
                </label>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => void calculateQuote()} disabled={quoting} className="pos-monitor-btn pos-monitor-btn--primary">
              {quoting ? "Calculating..." : "Calculate Quote"}
            </button>
          </div>

          {quote ? (
            <div style={{ border: "1px solid #dbe3ef", borderRadius: 10, padding: 10, display: "grid", gap: 8 }}>
              <strong>Quote Result</strong>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0", padding: "6px 4px" }}>Item</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #e2e8f0", padding: "6px 4px" }}>Qty</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #e2e8f0", padding: "6px 4px" }}>Unit</th>
                      <th style={{ textAlign: "right", borderBottom: "1px solid #e2e8f0", padding: "6px 4px" }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.lines.map((line) => (
                      <tr key={line.code}>
                        <td style={{ padding: "6px 4px", borderBottom: "1px solid #f1f5f9" }}>{line.label}</td>
                        <td style={{ padding: "6px 4px", textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>{line.quantity}</td>
                        <td style={{ padding: "6px 4px", textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>{formatMoney(line.unitPrice)}</td>
                        <td style={{ padding: "6px 4px", textAlign: "right", borderBottom: "1px solid #f1f5f9" }}>{formatMoney(line.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p style={{ margin: 0 }}>Subtotal: {formatMoney(quote.subtotal)}</p>
              <p style={{ margin: 0 }}>Discount: {formatMoney(quote.discountAmount)}</p>
              <p style={{ margin: 0, fontWeight: 800 }}>Total: {formatMoney(quote.total)}</p>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
