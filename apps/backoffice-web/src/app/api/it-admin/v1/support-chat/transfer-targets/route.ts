import { ok } from "@/lib/http";
import { guardItAdminError, requireItAdmin } from "@/lib/it-admin-guard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TransferTargetRow = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  platform_role: string | null;
};

export async function GET() {
  try {
    const context = await requireItAdmin();
    const result = await context.supabase
      .from("users_profiles")
      .select("id,full_name,avatar_url,platform_role")
      .in("platform_role", ["it_admin", "it_support"])
      .eq("is_active", true)
      .is("archived_at", null)
      .neq("id", context.auth.userId)
      .order("full_name", { ascending: true })
      .limit(200);

    if (result.error) throw new Error(result.error.message);

    const users = ((result.data ?? []) as TransferTargetRow[]).map((row) => ({
      id: row.id,
      full_name: row.full_name || "IT Support",
      avatar_url: row.avatar_url || "",
      platform_role: row.platform_role === "it_support" ? "it_support" : "it_admin"
    }));

    const response = ok({
      departments: [
        { role: "it_admin", label: "Admin IT" },
        { role: "it_support", label: "Support IT" }
      ],
      users
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}
