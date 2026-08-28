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
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: Record<string, unknown>) {
        cookieStore.set(name, value, options);
      },
      remove(name: string, options: Record<string, unknown>) {
        cookieStore.set(name, "", options);
      }
    }
  });
}
