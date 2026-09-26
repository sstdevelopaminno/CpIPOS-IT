import { appendAuditLog } from "@/lib/audit-log";
import { guardItAdminError, ItAdminGuardError, requireItAdmin } from "@/lib/it-admin-guard";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";

type BroadcastSettings = {
  id: string;
  enabled: boolean;
  severity: "info" | "warning" | "danger" | "emergency";
  title_th: string;
  title_en: string;
  message_th: string;
  message_en: string;
  action_label_th: string;
  action_label_en: string;
  action_url: string | null;
  bar_color: string;
  text_color: string;
  button_color: string;
  button_text_color: string;
  target_company_web: boolean;
  target_pos: boolean;
  dismissible: boolean;
  starts_at: string | null;
  ends_at: string | null;
};

const SELECT = "id,enabled,severity,title_th,title_en,message_th,message_en,action_label_th,action_label_en,action_url,bar_color,text_color,button_color,button_text_color,target_company_web,target_pos,dismissible,starts_at,ends_at";
const HEX = /^#[0-9A-Fa-f]{6}$/;
const SEVERITIES = new Set(["info", "warning", "danger", "emergency"]);

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function bool(value: unknown) {
  return value === true;
}

function nullableIso(value: unknown, field: string) {
  const raw = text(value, 64);
  if (!raw) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) {
    throw new ItAdminGuardError("invalid_schedule", `${field} must be a valid date/time.`, 422);
  }
  return date.toISOString();
}

function normalizeUrl(value: unknown) {
  const raw = text(value, 1000);
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ItAdminGuardError("invalid_action_url", "Action URL must be a valid HTTPS URL.", 422);
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ItAdminGuardError("invalid_action_url", "Action URL must be a valid HTTPS URL.", 422);
  }
  return url.toString();
}

function color(value: unknown, field: string) {
  const raw = text(value, 7).toUpperCase();
  if (!HEX.test(raw)) {
    throw new ItAdminGuardError("invalid_color", `${field} must be a 6-digit HEX color.`, 422);
  }
  return raw;
}

export async function GET() {
  try {
    const { supabase } = await requireItAdmin();
    const result = await supabase.from("platform_emergency_broadcast").select(SELECT)
      .eq("id", "global").maybeSingle<BroadcastSettings>();
    if (result.error) throw new Error("emergency_broadcast_read_failed");
    const response = ok({ settings: result.data });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { auth, supabase, requestMeta } = await requireItAdmin();
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") {
      throw new ItAdminGuardError("invalid_body", "Emergency broadcast settings are required.", 422);
    }

    const severity = text(body.severity, 20);
    if (!SEVERITIES.has(severity)) {
      throw new ItAdminGuardError("invalid_severity", "Choose a valid severity.", 422);
    }

    const startsAt = nullableIso(body.starts_at, "Start time");
    const endsAt = nullableIso(body.ends_at, "End time");
    if (startsAt && endsAt && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      throw new ItAdminGuardError("invalid_schedule", "End time must be after start time.", 422);
    }

    const patch: Omit<BroadcastSettings, "id"> = {
      enabled: bool(body.enabled),
      severity: severity as BroadcastSettings["severity"],
      title_th: text(body.title_th, 180),
      title_en: text(body.title_en, 180),
      message_th: text(body.message_th, 1200),
      message_en: text(body.message_en, 1200),
      action_label_th: text(body.action_label_th, 80),
      action_label_en: text(body.action_label_en, 80),
      action_url: normalizeUrl(body.action_url),
      bar_color: color(body.bar_color, "Bar color"),
      text_color: color(body.text_color, "Text color"),
      button_color: color(body.button_color, "Button color"),
      button_text_color: color(body.button_text_color, "Button text color"),
      target_company_web: bool(body.target_company_web),
      target_pos: bool(body.target_pos),
      dismissible: true,
      starts_at: startsAt,
      ends_at: endsAt
    };

    if (!patch.message_th && !patch.message_en) {
      throw new ItAdminGuardError("missing_message", "Enter at least one message.", 422);
    }
    if (!patch.target_company_web && !patch.target_pos) {
      throw new ItAdminGuardError("missing_target", "Choose at least one destination.", 422);
    }
    if (patch.action_url && !patch.action_label_th && !patch.action_label_en) {
      throw new ItAdminGuardError("missing_action_label", "Enter a button label when an action URL is set.", 422);
    }

    const existing = await supabase.from("platform_emergency_broadcast").select(SELECT)
      .eq("id", "global").maybeSingle<BroadcastSettings>();
    if (existing.error) throw new Error("emergency_broadcast_read_failed");

    const saved = await supabase.from("platform_emergency_broadcast")
      .upsert({
        id: "global",
        ...patch,
        updated_by: auth.userId,
        updated_at: new Date().toISOString()
      }, { onConflict: "id" })
      .select(SELECT)
      .single<BroadcastSettings>();

    if (saved.error || !saved.data) throw new Error("emergency_broadcast_update_failed");

    await appendAuditLog({
      actorUserId: auth.userId,
      actorRole: "it_admin",
      action: "platform_emergency_broadcast_updated",
      targetTable: "platform_emergency_broadcast",
      module: "it_admin",
      beforeData: existing.data ? { ...existing.data } : undefined,
      afterData: { ...saved.data },
      ipAddress: requestMeta.ipAddress ?? undefined,
      userAgent: requestMeta.userAgent ?? undefined
    });

    return ok({ settings: saved.data });
  } catch (error) {
    return guardItAdminError(error);
  }
}
