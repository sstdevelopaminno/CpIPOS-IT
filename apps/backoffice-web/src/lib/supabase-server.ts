import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { readRequiredEnv } from "@/lib/env";

export async function getSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL", "Missing Supabase public environment variables.");
  const anonKey = readRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Missing Supabase public environment variables.");

  return createServerClient(
    url,
    anonKey,
    {
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
    }
  );
}

