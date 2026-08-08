import { createBrowserClient } from "@supabase/ssr";
import { readRequiredEnv } from "@/lib/env";

export function getSupabaseBrowserClient() {
  const url = readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL", "Missing Supabase public environment variables.");
  const anonKey = readRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Missing Supabase public environment variables.");

  return createBrowserClient(url, anonKey);
}
