
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const PRIMARY_URL = "https://deejlitaivfnsbwqdugy.supabase.co";
const PRIMARY_PUBLISHABLE_KEY = "sb_publishable_nGX5abZtEmd7Ynzyofop1A_caORaUII";
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const ALLOWED_STATUSES = new Set(["new","in_progress","contacted","closed"]);

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

function text(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
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
    .select("platform_role,is_active,full_name")
    .eq("id", userResult.user.id)
    .maybeSingle();
  if (profileError || !profile?.is_active) return null;
  const role = String(profile.platform_role ?? "");
  if (!["it_admin","it_support"].includes(role)) return null;
  return {
    id: userResult.user.id,
    role,
    name: String(profile.full_name ?? userResult.user.email ?? role).slice(0, 180)
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const action = text(body?.action, 40);
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const admin = createClient(url, readAdminKey(), {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    if (action === "create") {
      const name = text(body?.name, 120);
      const phone = text(body?.phone, 50);
      const email = text(body?.email, 120);
      const message = text(body?.message, 2000);
      const localeRaw = text(body?.locale, 8).toLowerCase();
      const locale = ["th","en","lo"].includes(localeRaw) ? localeRaw : "th";

      if (!name) return json({ error: "name_required" }, 422);
      if (!phone) return json({ error: "phone_required" }, 422);
      if (message.length < 5) return json({ error: "message_too_short" }, 422);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json({ error: "invalid_email" }, 422);
      }

      const { data, error } = await admin
        .from("website_contact_requests")
        .insert({
          name,
          phone,
          email: email || null,
          message,
          locale,
          source: "company_website",
          status: "new"
        })
        .select("id,created_at")
        .single();
      if (error || !data) throw new Error(`contact_insert_failed:${error?.code ?? "unknown"}`);

      await admin.from("website_contact_request_events").insert({
        contact_request_id: data.id,
        action: "created",
        actor_role: "public_website",
        snapshot: { name, phone, email: email || null, message, locale, source: "company_website" }
      });

      return json({ ok: true, id: data.id, created_at: data.created_at }, 201);
    }

    const actor = await authorizePrimaryItUser(bearerToken(req));
    if (!actor) return json({ error: "forbidden" }, 403);

    if (action === "list") {
      const search = text(body?.search, 160).toLowerCase();
      const status = text(body?.status, 30);
      let query = admin
        .from("website_contact_requests")
        .select("id,name,phone,email,message,locale,source,status,internal_note,assigned_user_id,assigned_user_name,created_at,updated_at,last_contacted_at")
        .order("created_at", { ascending: false })
        .limit(300);
      if (status && status !== "all" && ALLOWED_STATUSES.has(status)) query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw new Error(`contact_list_failed:${error.code ?? "unknown"}`);
      const rows = (data ?? []).filter((row: Record<string, unknown>) => {
        if (!search) return true;
        return ["name","phone","email","message","status"].some((key) =>
          String(row[key] ?? "").toLowerCase().includes(search)
        );
      });
      const summary = {
        total: (data ?? []).length,
        new: (data ?? []).filter((row: Record<string, unknown>) => row.status === "new").length,
        active: (data ?? []).filter((row: Record<string, unknown>) => ["new","in_progress"].includes(String(row.status))).length,
        closed: (data ?? []).filter((row: Record<string, unknown>) => row.status === "closed").length
      };
      return json({ rows, summary, actor });
    }

    const id = text(body?.id, 80);
    if (!id) return json({ error: "id_required" }, 422);

    const { data: existing, error: existingError } = await admin
      .from("website_contact_requests")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (existingError) throw new Error(`contact_lookup_failed:${existingError.code ?? "unknown"}`);
    if (!existing) return json({ error: "not_found" }, 404);

    if (action === "update") {
      const patchInput = (body?.patch && typeof body.patch === "object" && !Array.isArray(body.patch))
        ? body.patch as Record<string, unknown>
        : {};
      const patch: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
        updated_by: actor.id
      };
      if ("name" in patchInput) {
        const value = text(patchInput.name,120); if (!value) return json({error:"name_required"},422); patch.name=value;
      }
      if ("phone" in patchInput) {
        const value = text(patchInput.phone,50); if (!value) return json({error:"phone_required"},422); patch.phone=value;
      }
      if ("email" in patchInput) {
        const value = text(patchInput.email,120);
        if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return json({error:"invalid_email"},422);
        patch.email=value || null;
      }
      if ("message" in patchInput) {
        const value = text(patchInput.message,2000); if (value.length<5) return json({error:"message_too_short"},422); patch.message=value;
      }
      if ("internal_note" in patchInput) patch.internal_note = text(patchInput.internal_note,3000) || null;
      if ("status" in patchInput) {
        const value = text(patchInput.status,30);
        if (!ALLOWED_STATUSES.has(value)) return json({error:"invalid_status"},422);
        patch.status=value;
        if (value === "contacted") patch.last_contacted_at = new Date().toISOString();
      }
      if (patchInput.assign_to_me === true) {
        patch.assigned_user_id = actor.id;
        patch.assigned_user_name = actor.name;
      }

      const { data, error } = await admin
        .from("website_contact_requests")
        .update(patch)
        .eq("id", id)
        .select("id,name,phone,email,message,locale,source,status,internal_note,assigned_user_id,assigned_user_name,created_at,updated_at,last_contacted_at")
        .single();
      if (error) throw new Error(`contact_update_failed:${error.code ?? "unknown"}`);

      await admin.from("website_contact_request_events").insert({
        contact_request_id: id,
        action: "updated",
        actor_user_id: actor.id,
        actor_role: actor.role,
        snapshot: { before: existing, after: data }
      });
      return json({ row: data });
    }

    if (action === "delete") {
      await admin.from("website_contact_request_events").insert({
        contact_request_id: id,
        action: "deleted",
        actor_user_id: actor.id,
        actor_role: actor.role,
        snapshot: existing
      });
      const { error } = await admin.from("website_contact_requests").delete().eq("id", id);
      if (error) throw new Error(`contact_delete_failed:${error.code ?? "unknown"}`);
      return json({ deleted: true, id });
    }

    return json({ error: "unsupported_action" }, 422);
  } catch (error) {
    console.error("[website-contact-api] failed", error instanceof Error ? error.message : "unknown_error");
    return json({ error: "website_contact_api_unavailable" }, 503);
  }
});
