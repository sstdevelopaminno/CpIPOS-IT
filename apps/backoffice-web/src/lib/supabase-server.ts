import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { readEnv, readRequiredEnv } from "@/lib/env";

type SupabaseCookieToSet = {
  name: string;
  value: string;
  options?: {
    path?: string;
    domain?: string;
    maxAge?: number;
    expires?: Date;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: boolean | "lax" | "strict" | "none";
    priority?: "low" | "medium" | "high";
    partitioned?: boolean;
  };
};

function readPrimaryAuthUrl() {
  return (
    readEnv("CPIPOS_SUPABASE_URL") ??
    readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL", "Missing CpiPOS-001 Supabase URL.")
  );
}

function readPrimaryPublishableKey() {
  return (
    readEnv("CPIPOS_SUPABASE_PUBLISHABLE_KEY") ??
    readRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Missing CpiPOS-001 Supabase publishable key.")
  );
}

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = readPrimaryAuthUrl();
  const publishableKey = readPrimaryPublishableKey();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: SupabaseCookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. Route Handlers and Server
          // Actions can, which is where login/session mutations occur.
        }
      }
    }
  });
}

export async function getVerifiedSupabaseAccessToken(expectedUserId: string): Promise<string | null> {
  const supabase = await getSupabaseServerClient();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) return null;

  const { data: userData, error: userError } = await supabase.auth.getUser(accessToken);
  if (userError || !userData.user || userData.user.id !== expectedUserId) return null;
  return accessToken;
}
