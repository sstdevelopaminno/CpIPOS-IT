import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { readEnv, readRequiredEnv } from "@/lib/env";

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
      setAll(cookiesToSet) {
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
