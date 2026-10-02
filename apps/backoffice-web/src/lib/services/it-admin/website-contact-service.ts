import "server-only";

const COMMUNICATIONS_URL = "https://wznixoeezgyhtwurcswb.supabase.co";
const COMMUNICATIONS_PUBLISHABLE_KEY = "sb_publishable_G-lNDIwwsT7wthv4Ad4Qag_fz7R420Q";
const BRIDGE_TIMEOUT_MS = 8_000;

export type WebsiteContactRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  message: string;
  locale: string;
  source: string;
  status: "new" | "in_progress" | "contacted" | "closed";
  internal_note: string | null;
  assigned_user_id: string | null;
  assigned_user_name: string | null;
  created_at: string;
  updated_at: string;
  last_contacted_at: string | null;
};

export type WebsiteContactList = {
  rows: WebsiteContactRow[];
  summary: { total: number; new: number; active: number; closed: number };
};

export async function callWebsiteContactPlane<T>(
  accessToken: string,
  payload: Record<string, unknown>
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRIDGE_TIMEOUT_MS);
  try {
    const response = await fetch(`${COMMUNICATIONS_URL}/functions/v1/website-contact-api`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        apikey: COMMUNICATIONS_PUBLISHABLE_KEY,
        "content-type": "application/json"
      },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: controller.signal
    });
    const body = await response.json().catch(() => null) as ({ error?: string } & T) | null;
    if (!response.ok) throw new Error(`website_contact_bridge_http_${response.status}:${body?.error ?? "unknown"}`);
    if (!body) throw new Error("website_contact_bridge_invalid_payload");
    return body as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new Error("website_contact_bridge_timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
