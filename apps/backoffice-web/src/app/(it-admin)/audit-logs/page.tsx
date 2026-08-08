import { PlatformAuditLogsConsole } from "@/components/it-admin/platform-audit-logs-console";
import { getAuthContext } from "@/lib/auth-context";

export default async function AuditLogsPage() {
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth || auth.platformRole !== "it_admin") {
    return (
      <section className="surface">
        <h2>Forbidden</h2>
        <p>Platform admin permission is required.</p>
      </section>
    );
  }

  return <PlatformAuditLogsConsole />;
}
