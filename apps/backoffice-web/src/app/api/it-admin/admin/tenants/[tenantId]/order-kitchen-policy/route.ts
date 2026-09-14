import { getAuthContext } from "@/lib/auth-context";
import { appendAuditLog } from "@/lib/audit-log";
import { fail, ok } from "@/lib/http";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

type OverrideMode = "inherit" | "force_on" | "force_off";

type SettingsRow = {
  branch_id: string;
  table_qr_popup_enabled: boolean | null;
  table_qr_popup_store_enabled: boolean | null;
  table_qr_kitchen_auto_send_enabled: boolean | null;
  table_qr_kitchen_auto_print_enabled: boolean | null;
  table_qr_popup_override: string | null;
  table_qr_kitchen_auto_send_override: string | null;
  table_qr_kitchen_auto_print_override: string | null;
};

function normalizeOverride(value: unknown): OverrideMode | null {
  return value === "inherit" || value === "force_on" || value === "force_off" ? value : null;
}

function resolve(base: boolean, mode: OverrideMode) {
  if (mode === "force_on") return true;
  if (mode === "force_off") return false;
  return base;
}

function mapPolicy(branchId: string, row?: SettingsRow | null) {
  const popupStore = row?.table_qr_popup_store_enabled ?? row?.table_qr_popup_enabled ?? true;
  const sendStore = row?.table_qr_kitchen_auto_send_enabled ?? true;
  const printStore = row?.table_qr_kitchen_auto_print_enabled ?? true;
  const popupOverride = normalizeOverride(row?.table_qr_popup_override) ?? "inherit";
  const sendOverride = normalizeOverride(row?.table_qr_kitchen_auto_send_override) ?? "inherit";
  const printOverride = normalizeOverride(row?.table_qr_kitchen_auto_print_override) ?? "inherit";
  return {
    branch_id: branchId,
    store: {
      popup_enabled: popupStore,
      kitchen_auto_send_enabled: sendStore,
      kitchen_auto_print_enabled: printStore
    },
    override: {
      popup: popupOverride,
      kitchen_auto_send: sendOverride,
      kitchen_auto_print: printOverride
    },
    effective: {
      popup_enabled: resolve(popupStore, popupOverride),
      kitchen_auto_send_enabled: resolve(sendStore, sendOverride),
      kitchen_auto_print_enabled: resolve(printStore, printOverride)
    }
  };
}

async function requireItAdmin() {
  const auth = await getAuthContext({ requireBranchScope: false });
  if (auth.platformRole !== "it_admin") throw new Error("forbidden");
  return auth;
}

export async function GET(_request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    await requireItAdmin();
    const { tenantId } = await context.params;
    if (!tenantId) return fail("missing_tenant", "tenantId is required.", 422);
    const supabase = getPrimarySupabaseServiceClient();
    const [{ data: branches, error: branchError }, { data: rows, error: settingsError }] = await Promise.all([
      supabase.from("branches").select("id,code,name,is_active").eq("tenant_id", tenantId).order("name", { ascending: true }),
      supabase
        .from("tenant_pos_notification_settings")
        .select("branch_id,table_qr_popup_enabled,table_qr_popup_store_enabled,table_qr_kitchen_auto_send_enabled,table_qr_kitchen_auto_print_enabled,table_qr_popup_override,table_qr_kitchen_auto_send_override,table_qr_kitchen_auto_print_override")
        .eq("tenant_id", tenantId)
    ]);
    if (branchError) return fail("branch_query_failed", branchError.message, 500);
    if (settingsError) return fail("policy_query_failed", settingsError.message, 500);
    const rowMap = new Map(((rows ?? []) as SettingsRow[]).map((row) => [row.branch_id, row]));
    return ok({
      tenant_id: tenantId,
      branches: (branches ?? []).map((branch) => ({
        ...branch,
        policy: mapPolicy(String(branch.id), rowMap.get(String(branch.id)))
      }))
    });
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") return fail("forbidden", "Only IT admin can view this policy.", 403);
    return fail("order_kitchen_policy_fetch_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}

export async function PUT(request: Request, context: { params: Promise<{ tenantId: string }> }) {
  try {
    const auth = await requireItAdmin();
    const { tenantId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const branchId = String(body.branch_id ?? "").trim();
    const popupOverride = normalizeOverride(body.popup_override);
    const sendOverride = normalizeOverride(body.kitchen_auto_send_override);
    const printOverride = normalizeOverride(body.kitchen_auto_print_override);
    if (!tenantId || !branchId || !popupOverride || !sendOverride || !printOverride) {
      return fail("invalid_payload", "branch_id and all override values are required.", 422);
    }

    const supabase = getPrimarySupabaseServiceClient();
    const { data: branch, error: branchError } = await supabase
      .from("branches")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", branchId)
      .maybeSingle<{ id: string }>();
    if (branchError) return fail("branch_query_failed", branchError.message, 500);
    if (!branch) return fail("branch_not_found", "Branch was not found in this tenant.", 404);

    const { data: existing, error: readError } = await supabase
      .from("tenant_pos_notification_settings")
      .select("branch_id,table_qr_popup_enabled,table_qr_popup_store_enabled,table_qr_kitchen_auto_send_enabled,table_qr_kitchen_auto_print_enabled,table_qr_popup_override,table_qr_kitchen_auto_send_override,table_qr_kitchen_auto_print_override")
      .eq("tenant_id", tenantId)
      .eq("branch_id", branchId)
      .maybeSingle<SettingsRow>();
    if (readError) return fail("policy_query_failed", readError.message, 500);

    const before = mapPolicy(branchId, existing);
    const effectivePopup = resolve(before.store.popup_enabled, popupOverride);
    const nowIso = new Date().toISOString();
    const { error: saveError } = await supabase.from("tenant_pos_notification_settings").upsert(
      {
        tenant_id: tenantId,
        branch_id: branchId,
        table_qr_popup_store_enabled: before.store.popup_enabled,
        table_qr_popup_enabled: effectivePopup,
        table_qr_kitchen_auto_send_enabled: before.store.kitchen_auto_send_enabled,
        table_qr_kitchen_auto_print_enabled: before.store.kitchen_auto_print_enabled,
        table_qr_popup_override: popupOverride,
        table_qr_kitchen_auto_send_override: sendOverride,
        table_qr_kitchen_auto_print_override: printOverride,
        updated_at: nowIso,
        updated_by: auth.userId
      },
      { onConflict: "tenant_id,branch_id" }
    );
    if (saveError) return fail("policy_save_failed", saveError.message, 500);

    const after = {
      branch_id: branchId,
      store: before.store,
      override: { popup: popupOverride, kitchen_auto_send: sendOverride, kitchen_auto_print: printOverride },
      effective: {
        popup_enabled: resolve(before.store.popup_enabled, popupOverride),
        kitchen_auto_send_enabled: resolve(before.store.kitchen_auto_send_enabled, sendOverride),
        kitchen_auto_print_enabled: resolve(before.store.kitchen_auto_print_enabled, printOverride)
      }
    };

    await appendAuditLog({
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: "table_qr_automation_override_updated",
      targetTable: "tenant_pos_notification_settings",
      tenantId,
      branchId,
      targetId: `${tenantId}:${branchId}`,
      metadata: { before, after }
    });
    return ok({ policy: after, updated_at: nowIso });
  } catch (error) {
    if (error instanceof Error && error.message === "forbidden") return fail("forbidden", "Only IT admin can update this policy.", 403);
    return fail("order_kitchen_policy_update_failed", error instanceof Error ? error.message : "Unknown error", 500);
  }
}
