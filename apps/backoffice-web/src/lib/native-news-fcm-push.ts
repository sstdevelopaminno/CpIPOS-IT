import "server-only";
import { createSign } from "node:crypto";
import { getPrimarySupabaseServiceClient } from "@/lib/supabase-admin";

type NewsPush = {
  id: string;
  title: string;
  body: string;
  target_tenant_id: string | null;
};
type Device = {
  tenant_id: string;
  branch_id: string;
  user_id: string;
  session_id: string;
  fcm_token: string;
};

let cachedToken: { value: string; expiresAt: number } | null = null;

function credentials() {
  const project = process.env.NATIVE_FCM_PROJECT_ID?.trim();
  const email = process.env.NATIVE_FCM_CLIENT_EMAIL?.trim();
  const key = process.env.NATIVE_FCM_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!project || !email || !key || !key.includes("BEGIN PRIVATE KEY")) return null;
  return { project, email, key };
}

async function accessToken(config: NonNullable<ReturnType<typeof credentials>>) {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 120_000) return cachedToken.value;
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const issuedAt = Math.floor(now / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: config.email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3300
  })).toString("base64url");
  const input = header + "." + payload;
  const signer = createSign("RSA-SHA256");
  signer.update(input);
  const assertion = input + "." + signer.sign(config.key, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion
    }),
    signal: AbortSignal.timeout(7000)
  });
  if (!response.ok) throw new Error("native_news_oauth_failed");
  const json = await response.json() as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new Error("native_news_token_missing");
  cachedToken = {
    value: json.access_token,
    expiresAt: now + Math.max(300, Number(json.expires_in ?? 3000)) * 1000
  };
  return json.access_token;
}

/** Best-effort immediate FCM; Android also polls the canonical news endpoint. */
export async function dispatchNativeNewsFcm(news: NewsPush): Promise<void> {
  const config = credentials();
  if (!config) return;
  try {
    const db = getPrimarySupabaseServiceClient();
    const authorization = await accessToken(config);
    const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
    let offset = 0;
    let failures = 0;
    while (true) {
      let query = db.from("native_pos_push_devices")
        .select("tenant_id,branch_id,user_id,session_id,fcm_token")
        .eq("enabled", true).gte("updated_at", cutoff)
        .order("updated_at", { ascending: false }).range(offset, offset + 199);
      if (news.target_tenant_id) query = query.eq("tenant_id", news.target_tenant_id);
      const result = await query;
      if (result.error) throw new Error("native_news_recipients_unavailable");
      const devices = (result.data ?? []) as Device[];
      if (!devices.length) break;
      const sessions = await db.from("pos_sessions")
        .select("id,tenant_id,branch_id,user_id")
        .eq("status", "active").gt("expires_at", new Date().toISOString())
        .in("id", [...new Set(devices.map(row => row.session_id))]);
      if (sessions.error) throw new Error("native_news_sessions_unavailable");
      const active = new Map((sessions.data ?? []).map(row => [String(row.id), row]));
      const recipients = devices.filter(device => {
        const session = active.get(device.session_id);
        return session?.tenant_id === device.tenant_id &&
          session?.branch_id === device.branch_id && session?.user_id === device.user_id;
      });
      for (let index = 0; index < recipients.length; index += 40) {
        const batch = recipients.slice(index, index + 40);
        const sent = await Promise.allSettled(batch.map(async device => {
          const response = await fetch(
            `https://fcm.googleapis.com/v1/projects/${config.project}/messages:send`, {
              method: "POST", cache: "no-store",
              headers: { authorization: `Bearer ${authorization}`, "content-type": "application/json" },
              body: JSON.stringify({ message: {
                token: device.fcm_token,
                data: {
                  type: "native_news_event", news_id: news.id,
                  tenant_id: device.tenant_id, user_id: device.user_id,
                  title: news.title.slice(0, 100), body: news.body.slice(0, 1000)
                },
                android: { priority: "HIGH", ttl: "86400s" }
              } }),
              signal: AbortSignal.timeout(8000)
            }
          );
          return response.ok;
        }));
        failures += sent.filter(item => item.status === "rejected" ||
          (item.status === "fulfilled" && !item.value)).length;
      }
      if (devices.length < 200) break;
      offset += devices.length;
    }
    if (failures) console.warn("[native-news-fcm] deliveries failed", failures);
  } catch (error) {
    console.warn("[native-news-fcm] dispatch unavailable",
      error instanceof Error ? error.message : "unknown");
  }
}
