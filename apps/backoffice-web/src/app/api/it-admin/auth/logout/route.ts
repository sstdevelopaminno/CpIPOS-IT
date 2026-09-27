import { getSupabaseServerClient } from "@/lib/supabase-server";

export async function POST() {
  const supabase = await getSupabaseServerClient();
  await supabase.auth.signOut();
  return Response.json(
    { ok: true },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
