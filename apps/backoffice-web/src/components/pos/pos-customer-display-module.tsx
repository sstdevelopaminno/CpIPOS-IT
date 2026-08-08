"use client";

import { useEffect, useMemo, useState } from "react";
import type { Language } from "@/lib/i18n";

type CartItem = {
  product_id: string;
  name: string;
  quantity: number;
  price: number;
};

type ActiveOrder = {
  order_no?: string | null;
};

type SalesSnapshot = {
  operator_name?: string;
  branch_name?: string;
};

type CustomerDisplayPayload = {
  order_no?: string | null;
  operator_name?: string | null;
  branch_name?: string | null;
  total_amount?: number | null;
  items?: CartItem[];
  updated_at?: string | null;
};

type CustomerDisplayApiResponse = {
  data?: {
    channel?: string;
    data?: {
      payload?: CustomerDisplayPayload;
      updated_at?: string;
    } | null;
  } | null;
  error?: {
    code?: string;
    message?: string;
  } | null;
};

const CART_KEY = "pos_sales_cart_v012";
const SALES_SNAPSHOT_KEY = "pos_sales_snapshot_v001";
const ACTIVE_ORDER_KEY = "pos_active_order_v001";
const DEVICE_TOKEN_KEY = "pos_customer_display_device_token_v001";
const DEVICE_CHANNEL_KEY = "pos_customer_display_channel_v001";

function readStoredJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function formatMoney(value: number): string {
  return `THB ${Number((Number.isFinite(value) ? value : 0).toFixed(2)).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function normalizeChannel(raw: string | null): string {
  const value = String(raw ?? "main").trim().toLowerCase();
  return value || "main";
}

export function PosCustomerDisplayModule({ lang }: { lang: Language }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [operatorName, setOperatorName] = useState("-");
  const [branchName, setBranchName] = useState("-");
  const [billNo, setBillNo] = useState("-");
  const [channel, setChannel] = useState("main");
  const [deviceToken, setDeviceToken] = useState<string | null>(null);
  const [pairingCodeInput, setPairingCodeInput] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [totalOverride, setTotalOverride] = useState<number | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncSource, setSyncSource] = useState<"server" | "local" | "-">("-");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const queryChannel = normalizeChannel(params.get("channel"));
    const savedToken = localStorage.getItem(DEVICE_TOKEN_KEY);
    const savedChannel = localStorage.getItem(DEVICE_CHANNEL_KEY);
    setDeviceToken(savedToken || null);
    setChannel(savedChannel ? normalizeChannel(savedChannel) : queryChannel);
  }, []);

  async function claimPairing(code: string) {
    const normalizedCode = String(code).replace(/\D/g, "").slice(0, 6);
    if (normalizedCode.length !== 6) {
      setPairingError(lang === "th" ? "กรอกรหัสจับคู่ 6 หลัก" : "Pairing code must be 6 digits.");
      return false;
    }
    setPairingBusy(true);
    setPairingError(null);
    try {
      const response = await fetch("/api/pos/customer-display/pairings/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pairing_code: normalizedCode,
          device_name: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 120) : null
        })
      });
      const payload = (await response.json()) as {
        data?: { device_token?: string; channel?: string };
        error?: { message?: string };
      };
      if (!response.ok || !payload.data?.device_token) {
        throw new Error(payload.error?.message ?? "Failed to claim pairing.");
      }
      const nextToken = payload.data.device_token;
      const nextChannel = normalizeChannel(payload.data.channel ?? "main");
      localStorage.setItem(DEVICE_TOKEN_KEY, nextToken);
      localStorage.setItem(DEVICE_CHANNEL_KEY, nextChannel);
      setDeviceToken(nextToken);
      setChannel(nextChannel);
      setPairingCodeInput("");
      return true;
    } catch (error) {
      setPairingError(error instanceof Error ? error.message : "Failed to claim pairing.");
      return false;
    } finally {
      setPairingBusy(false);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const codeFromQuery = String(params.get("pairing_code") ?? "").replace(/\D/g, "").slice(0, 6);
    if (!codeFromQuery || deviceToken) return;
    void claimPairing(codeFromQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceToken]);

  useEffect(() => {
    let disposed = false;

    function applyPayload(payload: CustomerDisplayPayload, source: "server" | "local", updatedAt?: string | null) {
      setCart(Array.isArray(payload.items) ? payload.items : []);
      setOperatorName(String(payload.operator_name ?? "-"));
      setBranchName(String(payload.branch_name ?? "-"));
      setBillNo(String(payload.order_no ?? "-"));
      setTotalOverride(Number.isFinite(payload.total_amount) ? Number(payload.total_amount) : null);
      setLastSyncAt(updatedAt ?? payload.updated_at ?? new Date().toISOString());
      setSyncSource(source);
    }

    function syncFromStorage() {
      const nextCart = readStoredJson<CartItem[]>(CART_KEY) ?? [];
      const nextSnapshot = readStoredJson<SalesSnapshot>(SALES_SNAPSHOT_KEY);
      const nextActiveOrder = readStoredJson<ActiveOrder>(ACTIVE_ORDER_KEY);
      applyPayload(
        {
          items: nextCart,
          operator_name: String(nextSnapshot?.operator_name ?? "-"),
          branch_name: String(nextSnapshot?.branch_name ?? "-"),
          order_no: String(nextActiveOrder?.order_no ?? "-"),
          total_amount: nextCart.reduce((sum, item) => sum + item.quantity * item.price, 0),
          updated_at: new Date().toISOString()
        },
        "local"
      );
    }

    async function syncFromServer(): Promise<boolean> {
      if (!deviceToken) return false;
      try {
        const response = await fetch(`/api/pos/customer-display?channel=${encodeURIComponent(channel)}`, {
          method: "GET",
          cache: "no-store",
          headers: {
            "x-customer-display-token": deviceToken
          }
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) {
            localStorage.removeItem(DEVICE_TOKEN_KEY);
            localStorage.removeItem(DEVICE_CHANNEL_KEY);
            setDeviceToken(null);
            setPairingError(lang === "th" ? "อุปกรณ์นี้หมดสิทธิ์เข้าจอ กรุณาจับคู่ใหม่" : "This device access expired. Please pair again.");
          }
          return false;
        }
        const payload = (await response.json()) as CustomerDisplayApiResponse;
        const state = payload.data?.data;
        if (!state?.payload) {
          return false;
        }
        if (disposed) return false;
        applyPayload(state.payload, "server", state.updated_at);
        return true;
      } catch {
        return false;
      }
    }

    function onStorage(event: StorageEvent) {
      if (!event.key) return;
      if (event.key !== CART_KEY && event.key !== SALES_SNAPSHOT_KEY && event.key !== ACTIVE_ORDER_KEY) return;
      syncFromStorage();
    }

    const tick = async () => {
      const hasServerData = await syncFromServer();
      if (!hasServerData) {
        syncFromStorage();
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, 1000);
    window.addEventListener("storage", onStorage);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, [channel, deviceToken, lang]);

  const computedTotal = useMemo(() => Number(cart.reduce((sum, item) => sum + item.quantity * item.price, 0).toFixed(2)), [cart]);
  const totalAmount = totalOverride ?? computedTotal;
  const itemCount = useMemo(() => cart.reduce((sum, item) => sum + item.quantity, 0), [cart]);

  const text = lang === "th"
    ? {
        title: "จอแสดงผลลูกค้า",
        branch: "สาขา",
        seller: "พนักงานขาย",
        billNo: "เลขที่บิล",
        channel: "ช่องจอ",
        items: "รายการ",
        qty: "จำนวน",
        total: "ยอดรวม",
        waiting: "กำลังรอข้อมูลจากหน้าขาย...",
        syncedAt: "ซิงก์ล่าสุด",
        source: "แหล่งข้อมูล",
        pairingTitle: "จับคู่จอลูกค้า",
        pairingHint: "กรอกรหัสจับคู่ 6 หลักจากหน้าขาย POS",
        pairingPlaceholder: "รหัส 6 หลัก",
        pairingAction: "ยืนยันจับคู่",
        resetPairing: "จับคู่ใหม่"
      }
    : {
        title: "Customer Display",
        branch: "Branch",
        seller: "Cashier",
        billNo: "Bill No.",
        channel: "Channel",
        items: "Items",
        qty: "Qty",
        total: "Total",
        waiting: "Waiting for POS cart data...",
        syncedAt: "Last sync",
        source: "Source",
        pairingTitle: "Pair Customer Display",
        pairingHint: "Enter 6-digit pairing code from POS sales screen.",
        pairingPlaceholder: "6-digit code",
        pairingAction: "Claim Pairing",
        resetPairing: "Re-pair"
      };

  return (
    <section
      style={{
        minHeight: "100vh",
        background: "linear-gradient(165deg,#0f172a 0%,#1e3a8a 45%,#0f172a 100%)",
        color: "#ffffff",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        gap: 12,
        padding: 16
      }}
    >
      <header
        style={{
          border: "1px solid rgba(255,255,255,0.22)",
          borderRadius: 14,
          background: "rgba(255,255,255,0.08)",
          padding: 12,
          display: "grid",
          gap: 8
        }}
      >
        <h1 style={{ margin: 0, fontSize: 28, fontWeight: 800 }}>{text.title}</h1>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8, fontSize: 14 }}>
          <p style={{ margin: 0 }}>{text.branch}: <strong>{branchName}</strong></p>
          <p style={{ margin: 0 }}>{text.seller}: <strong>{operatorName}</strong></p>
          <p style={{ margin: 0 }}>{text.billNo}: <strong>{billNo}</strong></p>
          <p style={{ margin: 0 }}>{text.channel}: <strong>{channel}</strong></p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => {
              localStorage.removeItem(DEVICE_TOKEN_KEY);
              localStorage.removeItem(DEVICE_CHANNEL_KEY);
              setDeviceToken(null);
              setPairingError(null);
              setSyncSource("-");
            }}
            style={{
              border: "1px solid rgba(255,255,255,0.32)",
              background: "rgba(15,23,42,0.35)",
              color: "#fff",
              borderRadius: 8,
              minHeight: 34,
              padding: "0 10px",
              fontWeight: 700
            }}
          >
            {text.resetPairing}
          </button>
          {pairingError ? <small style={{ color: "#fecaca" }}>{pairingError}</small> : null}
        </div>
      </header>

      <main
        style={{
          border: "1px solid rgba(255,255,255,0.22)",
          borderRadius: 14,
          background: "rgba(255,255,255,0.06)",
          padding: 12,
          overflow: "auto"
        }}
      >
        {!deviceToken ? (
          <section
            style={{
              border: "1px solid rgba(255,255,255,0.2)",
              borderRadius: 12,
              background: "rgba(15,23,42,0.5)",
              padding: 12,
              display: "grid",
              gap: 8,
              marginBottom: 10
            }}
          >
            <strong>{text.pairingTitle}</strong>
            <p style={{ margin: 0, opacity: 0.9 }}>{text.pairingHint}</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text"
                inputMode="numeric"
                value={pairingCodeInput}
                onChange={(event) => setPairingCodeInput(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder={text.pairingPlaceholder}
                style={{
                  minHeight: 36,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.25)",
                  background: "rgba(255,255,255,0.12)",
                  color: "#fff",
                  padding: "0 10px"
                }}
              />
              <button
                type="button"
                disabled={pairingBusy}
                onClick={() => {
                  void claimPairing(pairingCodeInput);
                }}
                style={{
                  minHeight: 36,
                  borderRadius: 8,
                  border: "1px solid #60a5fa",
                  background: "#1d4ed8",
                  color: "#fff",
                  padding: "0 12px",
                  fontWeight: 700
                }}
              >
                {pairingBusy ? "..." : text.pairingAction}
              </button>
            </div>
          </section>
        ) : null}

        {cart.length === 0 ? (
          <p style={{ margin: 0, opacity: 0.9, fontSize: 20 }}>{text.waiting}</p>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {cart.map((item) => (
              <article
                key={`${item.product_id}-${item.name}`}
                style={{
                  border: "1px solid rgba(255,255,255,0.16)",
                  borderRadius: 12,
                  background: "rgba(255,255,255,0.08)",
                  padding: 10,
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) auto",
                  gap: 8,
                  alignItems: "center"
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <h2 style={{ margin: 0, fontSize: 22, lineHeight: 1.2, fontWeight: 700, wordBreak: "break-word" }}>{item.name}</h2>
                  <p style={{ margin: "4px 0 0", opacity: 0.88, fontSize: 14 }}>
                    {text.qty}: {item.quantity} x {formatMoney(item.price)}
                  </p>
                </div>
                <strong style={{ fontSize: 26, whiteSpace: "nowrap" }}>{formatMoney(item.quantity * item.price)}</strong>
              </article>
            ))}
          </div>
        )}
      </main>

      <footer
        style={{
          border: "1px solid rgba(255,255,255,0.22)",
          borderRadius: 14,
          background: "rgba(15,23,42,0.45)",
          padding: 12,
          display: "flex",
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap"
        }}
      >
        <strong style={{ fontSize: 18 }}>
          {text.items}: {itemCount}
        </strong>
        <strong style={{ fontSize: 32 }}>
          {text.total}: {formatMoney(totalAmount)}
        </strong>
        <small style={{ opacity: 0.9 }}>
          {text.syncedAt}: {lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString(lang === "th" ? "th-TH" : "en-US") : "-"} | {text.source}: {syncSource}
        </small>
      </footer>
    </section>
  );
}

