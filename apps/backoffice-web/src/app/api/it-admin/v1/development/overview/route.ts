import { getDevelopmentConnectionStatus, getGithubRateLimit, listDevelopmentRepositories, listVercelProjects } from "@/lib/development-control";
import { guardItAdminError, requireItSupport } from "@/lib/it-admin-guard";
import { ok } from "@/lib/http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const context = await requireItSupport();
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const [repositories, githubRateLimit, vercelProjects, recentActions] = await Promise.all([
      listDevelopmentRepositories(),
      getGithubRateLimit().catch(() => null),
      listVercelProjects().catch(() => []),
      context.supabase
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("module", "development")
        .gte("created_at", since)
    ]);

    const response = ok({
      actor: {
        user_id: context.auth.userId,
        role: context.auth.platformRole
      },
      connections: getDevelopmentConnectionStatus(),
      repositories,
      github_rate_limit: githubRateLimit,
      vercel_projects: vercelProjects,
      guard: {
        recent_control_actions_60m: recentActions.count ?? 0,
        pin_attempt_limit_per_minute: 6,
        source_write_limit_per_5_minutes: 12,
        workspace_run_limit_per_15_minutes: 4,
        deployment_limit_per_10_minutes: 4,
        production_deployment_limit_per_hour: 2,
        polling: false,
        exact_vercel_account_quota: "ตรวจจาก Vercel Usage Dashboard โดยตรง; Development Center ไม่ทำ polling เพื่อไม่เพิ่ม API quota โดยไม่จำเป็น",
        usage_dashboard_url: process.env.CPIPOS_VERCEL_TEAM_SLUG
          ? `https://vercel.com/${process.env.CPIPOS_VERCEL_TEAM_SLUG}/~/usage`
          : "https://vercel.com/usage"
      }
    });
    response.headers.set("cache-control", "private, no-store");
    return response;
  } catch (error) {
    return guardItAdminError(error);
  }
}
