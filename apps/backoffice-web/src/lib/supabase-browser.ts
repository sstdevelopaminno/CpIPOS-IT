import { createBrowserClient } from "@supabase/ssr";
import { readRequiredEnv } from "@/lib/env";

let browserClient: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const url = readRequiredEnv("NEXT_PUBLIC_SUPABASE_URL", "Missing Supabase public environment variables.");
  const anonKey = readRequiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "Missing Supabase public environment variables.");

  let client: ReturnType<typeof createBrowserClient>;
  client = createBrowserClient(url, anonKey, {
    realtime: {
      worker: true,
      heartbeatCallback: (status: string) => {
        if (status === "disconnected") {
          client.realtime.connect();
        }
      }
    }
  });

  browserClient = client;
  return client;
}
