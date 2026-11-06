
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PRIMARY_URL = "https://deejlitaivfnsbwqdugy.supabase.co";
const PRIMARY_PUBLISHABLE_KEY = "sb_publishable_nGX5abZtEmd7Ynzyofop1A_caORaUII";
const PRIMARY_DELETE_VERIFY_URL = `${PRIMARY_URL}/functions/v1/cpipos-it-dashboard-primary`;
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

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
}

async function authorizePrimaryItUser(token: string) {
  const primary = createClient(PRIMARY_URL, PRIMARY_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data: userResult, error: userError } = await primary.auth.getUser(token);
  if (userError || !userResult.user) return null;
  const { data: profile, error: profileError } = await primary
    .from("users_profiles")
    .select("platform_role,is_active")
    .eq("id", userResult.user.id)
    .maybeSingle();
  if (profileError || !profile?.is_active) return null;
  const role = String(profile.platform_role ?? "");
  if (!["it_admin", "it_support"].includes(role)) return null;
  return { userId: userResult.user.id, role };
}

async function metrics(admin: ReturnType<typeof createClient>) {
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

  return {
    plane: "operational",
    role: "communications",
    checked_at: new Date().toISOString(),
    database: databaseResult.data,
    communications: {
      conversations: conversations.count ?? 0,
      messages: messages.count ?? 0,
      attachments: attachments.count ?? 0
    }
  };
}

async function deleteTenantCommunications(
  admin: ReturnType<typeof createClient>,
  token: string,
  tenantId: string
) {
  const verificationResponse = await fetch(PRIMARY_DELETE_VERIFY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      action: "verify_tenant_deletion_receipt",
      tenant_id: tenantId
    })
  });
  const verification = await verificationResponse.json().catch(() => null) as {
    verified?: boolean;
    reason?: string;
  } | null;
  if (!verificationResponse.ok || verification?.verified !== true) {
    return json({
      error: "primary_deletion_not_verified",
      reason: verification?.reason ?? "verification_unavailable"
    }, 409);
  }

  const deleted = await admin.rpc("it_delete_tenant_communications", {
    p_tenant_id: tenantId
  });
  if (deleted.error) {
    console.error("[cpipos-it-dashboard-operational] communications delete failed", deleted.error.code ?? "rpc_failed");
    return json({ error: "communications_delete_failed" }, 503);
  }

  const payload = deleted.data && typeof deleted.data === "object" && !Array.isArray(deleted.data)
    ? deleted.data as Record<string, unknown>
    : {};
  const files = Array.isArray(payload.storage_objects)
    ? payload.storage_objects as Array<{ bucket?: unknown; path?: unknown }>
    : [];

  let storageRemoved = 0;
  const byBucket = new Map<string, string[]>();
  for (const item of files) {
    const bucket = typeof item.bucket === "string" ? item.bucket.trim() : "";
    const path = typeof item.path === "string" ? item.path.trim() : "";
    if (!bucket || !path || !path.startsWith(tenantId + "/")) {
      return json({ error: "communications_cleanup_path_invalid" }, 409);
    }
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), path]);
  }

  for (const [bucket, paths] of byBucket) {
    for (let offset = 0; offset < paths.length; offset += 100) {
      const result = await admin.storage.from(bucket).remove(paths.slice(offset, offset + 100));
      if (result.error) {
        console.error("[cpipos-it-dashboard-operational] storage remove failed", {
          bucket,
          code: result.error.name ?? "storage_remove_failed"
        });
        return json({
          deleted: true,
          completed: false,
          error: "communications_storage_cleanup_failed",
          storage_removed: storageRemoved
        }, 503);
      }
      storageRemoved += Math.min(100, paths.length - offset);
    }
  }

  return json({
    deleted: true,
    completed: true,
    tenant_id: tenantId,
    conversations: Number(payload.conversations ?? 0),
    messages: Number(payload.messages ?? 0),
    participants: Number(payload.participants ?? 0),
    attachments: Number(payload.attachments ?? 0),
    call_sessions: Number(payload.call_sessions ?? 0),
    storage_removed: storageRemoved
  });
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const token = bearerToken(req);
  if (!token) return json({ error: "unauthorized" }, 401);

  try {
    const actor = await authorizePrimaryItUser(token);
    if (!actor) return json({ error: "forbidden" }, 403);

    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const admin = createClient(url, readAdminKey(), {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    if (req.method === "POST") {
      const body = await req.json().catch(() => null) as {
        action?: unknown;
        tenant_id?: unknown;
      } | null;
      const action = typeof body?.action === "string" ? body.action.trim() : "";

      if (action === "delete_tenant_communications") {
        if (actor.role !== "it_support") return json({ error: "it_support_required" }, 403);
        if (!isUuid(body?.tenant_id)) return json({ error: "invalid_tenant_id" }, 422);
        return await deleteTenantCommunications(admin, token, body.tenant_id);
      }
    }

    return json(await metrics(admin));
  } catch (error) {
    console.error(
      "[cpipos-it-dashboard-operational] failed",
      error instanceof Error ? error.message : "unknown_error"
    );
    return json({ error: "communications_operation_unavailable" }, 503);
  }
});
