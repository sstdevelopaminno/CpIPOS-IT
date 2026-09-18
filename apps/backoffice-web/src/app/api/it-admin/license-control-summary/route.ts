import { getAuthContext } from "@/lib/auth-context";
import { fail, ok } from "@/lib/http";
import { getOfflineLicenseSignerStatusServer } from "@/lib/offline-license-issuer";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireItAdmin() {
  const auth = await getAuthContext({ requireBranchScope: false });
  if (auth.platformRole !== "it_admin") throw new Error("FORBIDDEN");
  return auth;
}

async function safeCount(table: string, filter?: (query: any) => any) {
  try {
    const supabase = getPrimarySupabaseServiceClient();
    let query = supabase.from(table).select("id", { count: "exact", head: true });
    if (filter) query = filter(query);
    const { count, error } = await query;
    if (error) return { count: 0, ready: false, error: error.message };
    return { count: count ?? 0, ready: true, error: null };
  } catch (error) {
    return { count: 0, ready: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function GET() {
  try {
    await requireItAdmin();
    const signer = await getOfflineLicenseSignerStatusServer();
    const [contracts, activeContracts, devices, onlineDevices, auditRows, receipts, heartbeats] = await Promise.all([
      safeCount("desktop_license_contracts", (q) => q.is("deleted_at", null)),
      safeCount("desktop_license_contracts", (q) => q.is("deleted_at", null).eq("status", "active")),
      safeCount("desktop_license_devices"),
      safeCount("desktop_license_devices", (q) => q.eq("status", "online")),
      safeCount("audit_logs", (q) => q.eq("module", "desktop_license_control")),
      safeCount("desktop_license_sales_receipts"),
      safeCount("desktop_license_heartbeats")
    ]);

    const keyReady = Boolean(signer.configured && signer.keyMatchesDesktop);
    return ok({
      checked_at: new Date().toISOString(),
      desktop_version: "0.3.1",
      sections: [
        {
          id: "key-management",
          title: "Key Management",
          ready: keyReady,
          status: keyReady ? "ready" : "needs_private_key",
          count: keyReady ? 1 : 0,
          message: keyReady ? "Private Key ตรงกับ CpIPOS Desktop 0.3.1" : "ต้องบันทึก Private Key ที่ตรงกับ Public Key ใน Desktop 0.3.1"
        },
        {
          id: "license-preview",
          title: "License Preview",
          ready: true,
          status: "ready",
          count: 1,
          message: "ฟอร์ม Preview / ตรวจ Device / โหมดขาย / วันหมดอายุพร้อมใช้งาน"
        },
        {
          id: "license-history",
          title: "License History",
          ready: contracts.ready,
          status: contracts.ready ? "ready" : "schema_missing",
          count: contracts.count,
          message: `${contracts.count} licenses, ${activeContracts.count} active`
        },
        {
          id: "device-management",
          title: "Device Management",
          ready: devices.ready,
          status: devices.ready ? "ready" : "schema_missing",
          count: devices.count,
          message: `${devices.count} devices, ${onlineDevices.count} online`
        },
        {
          id: "trial-management",
          title: "Trial Management",
          ready: true,
          status: "desktop_enforced",
          count: 7,
          message: "CpIPOS Desktop 0.3.1 นับ Trial 7 วันจากการติดตั้งและล็อกให้ซื้อ License"
        },
        {
          id: "audit-log",
          title: "Audit Log / MDM",
          ready: auditRows.ready && heartbeats.ready,
          status: auditRows.ready && heartbeats.ready ? "ready" : "schema_missing",
          count: auditRows.count,
          message: `${auditRows.count} audit events, ${heartbeats.count} heartbeat snapshots, ${receipts.count} synced receipts`
        }
      ],
      signer: {
        configured: signer.configured,
        key_matches_desktop: signer.keyMatchesDesktop,
        public_key_fingerprint: signer.publicKeyFingerprint,
        expected_public_key_fingerprint: signer.expectedPublicKeyFingerprint,
        source: signer.source
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "FORBIDDEN") return fail("forbidden", "Only IT admin can inspect desktop license control readiness.", 403);
    return fail("desktop_license_control_summary_failed", message, 500);
  }
}
