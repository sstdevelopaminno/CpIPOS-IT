import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarizeStorePresence } from "../../../../supabase/control-plane-functions/cpipos-it-dashboard-primary/store-presence.ts";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const tenants = [
  { id: "a", code: "T-A", name: "ร้าน ก", display_name: null, is_active: true },
  { id: "b", code: "T-B", name: "ร้าน ข", display_name: "ร้าน ข สาขาหลัก", is_active: true },
  { id: "c", code: "T-C", name: "ร้าน ค", display_name: null, is_active: false }
];

const cutoff = "2026-11-14T10:30:00.000Z";

describe("IT store online presence, 5-minute heartbeat window", () => {
  it("shows every store including offline and closed stores, without inventing online activity", () => {
    const rows = summarizeStorePresence(tenants, [
      { tenant_id: "a", last_seen_at: "2026-11-14T10:20:00Z" },
      { tenant_id: "a", last_seen_at: null },
      { tenant_id: "b", last_seen_at: "2026-11-14T10:30:00Z" },
      { tenant_id: "b", last_seen_at: "2026-11-14T10:31:00Z" }
    ], cutoff);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      tenant_id: "b", name: "ร้าน ข สาขาหลัก",
      total_devices: 2, online_devices: 2,
      latest_seen_at: "2026-11-14T10:31:00.000Z"
    });
    expect(rows.find((row) => row.tenant_id === "a")).toMatchObject({
      total_devices: 2, online_devices: 0,
      latest_seen_at: "2026-11-14T10:20:00.000Z"
    });
    expect(rows.find((row) => row.tenant_id === "c")).toMatchObject({
      is_active: false, total_devices: 0, online_devices: 0, latest_seen_at: null
    });
  });

  it("treats the cutoff as inclusive and ignores invalid/unassigned telemetry", () => {
    const rows = summarizeStorePresence(tenants, [
      { tenant_id: "a", last_seen_at: cutoff },
      { tenant_id: "a", last_seen_at: "invalid" },
      { tenant_id: "nonexistent", last_seen_at: cutoff },
      { tenant_id: null, last_seen_at: cutoff }
    ], cutoff);
    expect(rows.find((row) => row.tenant_id === "a")).toMatchObject({
      total_devices: 2, online_devices: 1
    });
    expect(rows.reduce((sum, row) => sum + row.online_devices, 0)).toBe(1);
    expect(() => summarizeStorePresence(tenants, [], "invalid")).toThrow("invalid_presence_cutoff");
  });

  it("all devices outside window produces all offline rows, not an empty list", () => {
    const rows = summarizeStorePresence(tenants, [
      { tenant_id: "a", last_seen_at: "2026-11-14T10:03:00Z" }
    ], cutoff);
    expect(rows).toHaveLength(3);
    expect(rows.every((store) => store.online_devices === 0)).toBe(true);
  });
});

describe("IT dashboard store-presence contract", () => {
  const edge = src("../../supabase/control-plane-functions/cpipos-it-dashboard-primary/index.ts");
  const service = src("src/lib/services/it-admin/dashboard-overview-service.ts");
  const dashboard = src("src/components/it-admin/it-admin-dashboard.tsx");

  it("keeps the authoritative POS primary-bridge check and hides incomplete snapshots", () => {
    expect(edge).toContain("summarizeStorePresence");
    expect(edge).toContain("store_presence: presenceComplete");
    expect(edge).toContain("totalDevices <= DEVICE_DETAIL_LIMIT");
    expect(service).toContain("presence: devicePayload?.store_presence ?? null");
  });

  it("opens device-specific popup with filter, store links and unavailable state", () => {
    expect(dashboard).toContain('onClick={() => setModal("devices")}');
    expect(dashboard).toContain("data.stores.presence === null");
    expect(dashboard).toContain("store.online_devices > 0");
    expect(dashboard).toContain("/it-admin/tenants/\${store.tenant_id}");
  });
});
