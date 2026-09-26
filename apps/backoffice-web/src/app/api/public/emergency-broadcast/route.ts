import { NextResponse } from "next/server";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

type Target = "company_web" | "pos";
type BroadcastRow = {
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
  updated_at: string;
};

const SELECT = "id,enabled,severity,title_th,title_en,message_th,message_en,action_label_th,action_label_en,action_url,bar_color,text_color,button_color,button_text_color,target_company_web,target_pos,dismissible,starts_at,ends_at,updated_at";

function withPublicHeaders(response: NextResponse) {
  response.headers.set("access-control-allow-origin", "*");
  response.headers.set("access-control-allow-methods", "GET, OPTIONS");
  response.headers.set("access-control-allow-headers", "content-type");
  response.headers.set("cache-control", "public, max-age=30, stale-while-revalidate=60");
  return response;
}

export function OPTIONS() {
  return withPublicHeaders(new NextResponse(null, { status: 204 }));
}

export async function GET(request: Request) {
  const targetRaw = new URL(request.url).searchParams.get("target") ?? "company_web";
  const target: Target | null = targetRaw === "company_web" || targetRaw === "pos" ? targetRaw : null;
  if (!target) {
    return withPublicHeaders(NextResponse.json({ data: null, error: { code: "invalid_target", message: "Invalid broadcast target." } }, { status: 400 }));
  }

  try {
    const supabase = getPrimarySupabaseServiceClient();
    const result = await supabase.from("platform_emergency_broadcast").select(SELECT)
      .eq("id", "global").maybeSingle<BroadcastRow>();
    if (result.error) throw result.error;

    const row = result.data;
    const now = Date.now();
    const inWindow = Boolean(
      row &&
      row.enabled &&
      (target === "company_web" ? row.target_company_web : row.target_pos) &&
      (!row.starts_at || new Date(row.starts_at).getTime() <= now) &&
      (!row.ends_at || new Date(row.ends_at).getTime() > now)
    );

    const broadcast = inWindow && row ? {
      id: row.id,
      severity: row.severity,
      title_th: row.title_th,
      title_en: row.title_en,
      message_th: row.message_th,
      message_en: row.message_en,
      action_label_th: row.action_label_th,
      action_label_en: row.action_label_en,
      action_url: row.action_url,
      bar_color: row.bar_color,
      text_color: row.text_color,
      button_color: row.button_color,
      button_text_color: row.button_text_color,
      dismissible: row.dismissible,
      starts_at: row.starts_at,
      ends_at: row.ends_at,
      updated_at: row.updated_at
    } : null;

    return withPublicHeaders(NextResponse.json({ data: { broadcast }, error: null }));
  } catch {
    return withPublicHeaders(NextResponse.json({ data: { broadcast: null }, error: null }));
  }
}
