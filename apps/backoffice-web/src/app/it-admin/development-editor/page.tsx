import { redirect } from "next/navigation";
import { DevelopmentEditorWindow } from "@/components/it-admin/development-editor-window";
import { getAuthContext } from "@/lib/auth-context";

function value(input: string | string[] | undefined) {
  return Array.isArray(input) ? input[0] ?? "" : input ?? "";
}

export default async function DevelopmentEditorPage({
  searchParams
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await getAuthContext({ requireBranchScope: false }).catch(() => null);
  if (!auth) redirect("/it-admin/login");
  if (auth.platformRole !== "it_support") redirect("/it-admin");

  const params = await searchParams;
  const repo = value(params.repo);
  const baseRef = value(params.base) || "main";
  const branch = value(params.branch);
  const ref = value(params.ref) || branch || baseRef;
  const path = value(params.path);

  if (!repo) redirect("/it-admin/development");

  return (
    <DevelopmentEditorWindow
      repo={repo}
      baseRef={baseRef}
      initialRef={ref}
      initialBranch={branch}
      initialPath={path}
    />
  );
}
