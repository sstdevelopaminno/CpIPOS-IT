import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PRIMARY_URL = "https://deejlitaivfnsbwqdugy.supabase.co";
const PRIMARY_PUBLISHABLE_KEY = "sb_publishable_nGX5abZtEmd7Ynzyofop1A_caORaUII";
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function readAdminKey() {
  const secretSet = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (secretSet) {
    try {
      const parsed = JSON.parse(secretSet) as Record<string, string>;
      if (parsed.default) return parsed.default;
    } catch {}
  }
  const legacy = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (legacy) return legacy;
  throw new Error("admin_key_missing");
}

function bearerToken(req: Request) {
  const value = req.headers.get("authorization") ?? "";
  return value.toLowerCase().startsWith("bearer ") ? value.slice(7).trim() : "";
}

async function authorizePrimaryItUser(token: string) {
  const primary = createClient(PRIMARY_URL, PRIMARY_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data: userResult, error: userError } = await primary.auth.getUser(token);
  if (userError || !userResult.user) return false;

  const { data: profile, error: profileError } = await primary
    .from("users_profiles")
    .select("platform_role,is_active")
    .eq("id", userResult.user.id)
    .maybeSingle();
  if (profileError) return false;
  return Boolean(profile?.is_active && ["it_admin", "it_support"].includes(String(profile.platform_role ?? "")));
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const token = bearerToken(req);
  if (!token) return json({ error: "unauthorized" }, 401);

  try {
    if (!(await authorizePrimaryItUser(token))) return json({ error: "forbidden" }, 403);

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const admin = createClient(url, readAdminKey(), { auth: { persistSession: false, autoRefreshToken: false } });

    const [databaseResult, conversations, messages, attachments] = await Promise.all([
      admin.rpc("get_it_database_metrics"),
      admin.from("support_conversations").select("id", { count: "exact", head: true }),
      admin.from("support_messages").select("id", { count: "exact", head: true }),
      admin.from("support_attachments").select("id", { count: "exact", head: true })
    ]);

    if (databaseResult.error) throw new Error(`database_metrics_failed:${databaseResult.error.code ?? "rpc_failed"}`);
    if (conversations.error) throw new Error(`conversation_count_failed:${conversations.error.code ?? "query_failed"}`);
    if (messages.error) throw new Error(`message_count_failed:${messages.error.code ?? "query_failed"}`);
    if (attachments.error) throw new Error(`attachment_count_failed:${attachments.error.code ?? "query_failed"}`);

    return json({
      plane: "operational",
      role: "communications",
      checked_at: new Date().toISOString(),
      database: databaseResult.data,
      communications: {
        conversations: conversations.count ?? 0,
        messages: messages.count ?? 0,
        attachments: attachments.count ?? 0
      }
    });
  } catch (error) {
    console.error("[cpipos-it-dashboard-operational] failed", error instanceof Error ? error.message : "unknown_error");
    return json({ error: "communications_metrics_unavailable" }, 503);
  }
});
