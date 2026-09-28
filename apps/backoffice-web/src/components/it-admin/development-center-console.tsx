"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Repo = {
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  updated_at: string | null;
  html_url: string | null;
};

type Overview = {
  actor: { user_id: string; role: "it_support" };
  connections: {
    github_owner: string;
    github_read_configured: boolean;
    github_write_configured: boolean;
    vercel_configured: boolean;
    vercel_team_configured: boolean;
    direct_main_write: boolean;
    polling_enabled: boolean;
    isolated_workspace_configured: boolean;
  };
  repositories: Repo[];
  github_rate_limit: { limit: number; remaining: number; used: number; reset_at: string | null } | null;
  vercel_projects: Array<{ id: string | null; name: string | null; repo: string | null; org: string | null; updated_at: string | null }>;
  guard: {
    recent_control_actions_60m: number;
    pin_attempt_limit_per_minute: number;
    source_write_limit_per_5_minutes: number;
    deployment_limit_per_10_minutes: number;
    production_deployment_limit_per_hour: number;
    workspace_run_limit_per_15_minutes?: number;
    polling: boolean;
    exact_vercel_account_quota: string;
    usage_dashboard_url: string;
  };
};

type TreeFile = { path: string; size: number | null; sha: string | null };
type SourceFile = { repo: string; ref: string; path: string; sha: string | null; size: number; content: string };
type SaveResult = {
  repo: string;
  branch: string;
  path: string;
  commit_sha: string | null;
  commit_url: string | null;
  content_sha: string | null;
  created_file: boolean;
};
type PrResult = { repo: string; number: number | null; url: string | null; state: string | null; branch: string; base_ref: string };
type Deployment = { id: string | null; url: string | null; state: string | null; target: string; created_at: string | null; git_ref: string | null; git_sha: string | null };
type DeployResult = { deployment_id: string | null; url: string | null; state: string; target: string; ref: string };
type WorkspaceTask = "verify" | "build" | "test";
type WorkspaceRun = {
  id: number | null;
  run_number: number | null;
  status: string;
  conclusion: string | null;
  url: string | null;
  created_at: string | null;
  updated_at: string | null;
  actor: string | null;
  repository: string | null;
  task: string | null;
  ref: string | null;
  request_id: string | null;
};
type WorkspaceRunDetail = WorkspaceRun & {
  jobs: Array<{
    id: number | null;
    name: string;
    status: string;
    conclusion: string | null;
    url: string | null;
    started_at: string | null;
    completed_at: string | null;
    steps: Array<{
      number: number | null;
      name: string;
      status: string;
      conclusion: string | null;
      started_at: string | null;
      completed_at: string | null;
    }>;
  }>;
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function runTone(run: { status: string; conclusion: string | null }) {
  if (run.status !== "completed") return "bg-blue-50 text-blue-700";
  if (run.conclusion === "success") return "bg-emerald-50 text-emerald-700";
  if (run.conclusion === "cancelled") return "bg-slate-100 text-slate-600";
  return "bg-red-50 text-red-700";
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  return body.data;
}

export function DevelopmentCenterConsole() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [repoName, setRepoName] = useState("");
  const [baseRef, setBaseRef] = useState("main");
  const [workingBranch, setWorkingBranch] = useState("");
  const [tree, setTree] = useState<TreeFile[]>([]);
  const [treeLoading, setTreeLoading] = useState(false);
  const [fileFilter, setFileFilter] = useState("");
  const [filePath, setFilePath] = useState("");
  const [source, setSource] = useState("");
  const [savedSource, setSavedSource] = useState("");
  const [fileLoading, setFileLoading] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [pin, setPin] = useState("");
  const [pr, setPr] = useState<PrResult | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [previewUrl, setPreviewUrl] = useState("");
  const [workspaceRuns, setWorkspaceRuns] = useState<WorkspaceRun[]>([]);
  const [workspaceTask, setWorkspaceTask] = useState<WorkspaceTask>("verify");
  const [workspacePin, setWorkspacePin] = useState("");
  const [workspaceDetail, setWorkspaceDetail] = useState<WorkspaceRunDetail | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [statusOpen, setStatusOpen] = useState(false);
  const [quotaOpen, setQuotaOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [deploymentsOpen, setDeploymentsOpen] = useState(false);

  const currentRef = workingBranch || baseRef;
  const dirty = source !== savedSource;
  const visibleFiles = useMemo(() => {
    const filter = fileFilter.trim().toLowerCase();
    return tree.filter((file) => !filter || file.path.toLowerCase().includes(filter)).slice(0, 350);
  }, [tree, fileFilter]);

  const loadOverview = useCallback(async () => {
    setOverviewLoading(true);
    setError("");
    try {
      const data = await readJson<Overview>(await fetch("/api/it-admin/v1/development/overview", { cache: "no-store" }));
      setOverview(data);
      if (!repoName && data.repositories.length) {
        setRepoName(data.repositories[0]!.name);
        setBaseRef(data.repositories[0]!.default_branch || "main");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลด Development Center ไม่สำเร็จ");
    } finally {
      setOverviewLoading(false);
    }
  }, [repoName]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const loadTree = useCallback(async (repo = repoName, ref = currentRef) => {
    if (!repo) return;
    setTreeLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ mode: "tree", repo, ref });
      const data = await readJson<{ tree: { files: TreeFile[] } }>(
        await fetch(`/api/it-admin/v1/development/source?${params}`, { cache: "no-store" })
      );
      setTree(data.tree.files);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลดรายการไฟล์ไม่สำเร็จ");
      setTree([]);
    } finally {
      setTreeLoading(false);
    }
  }, [currentRef, repoName]);

  useEffect(() => {
    if (repoName) void loadTree(repoName, currentRef);
  }, [repoName, currentRef, loadTree]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const payload = event.data as { type?: string; repo?: string; branch?: string; path?: string } | null;
      if (payload?.type !== "cpipos-development-save" || payload.repo !== repoName || !payload.branch) return;
      setWorkingBranch(payload.branch);
      setNotice(`Editor แยกหน้าต่างบันทึกแล้ว · ${payload.branch}`);
      void loadTree(repoName, payload.branch);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadTree, repoName]);

  async function chooseRepo(next: string) {
    if (dirty && !window.confirm("มีไฟล์ที่ยังไม่ได้บันทึก ต้องการเปลี่ยน Repository หรือไม่?")) return;
    const repo = overview?.repositories.find((item) => item.name === next);
    setRepoName(next);
    setBaseRef(repo?.default_branch || "main");
    setWorkingBranch("");
    setTree([]);
    setFilePath("");
    setSource("");
    setSavedSource("");
    setPr(null);
    setDeployments([]);
    setPreviewUrl("");
    setError("");
    setNotice("");
  }

  async function openFile(path: string) {
    if (!repoName) return;
    if (dirty && path !== filePath && !window.confirm("มีไฟล์ที่ยังไม่ได้บันทึก ต้องการเปิดไฟล์อื่นหรือไม่?")) return;
    setFileLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ mode: "file", repo: repoName, ref: currentRef, path });
      const data = await readJson<{ file: SourceFile }>(
        await fetch(`/api/it-admin/v1/development/source?${params}`, { cache: "no-store" })
      );
      setFilePath(data.file.path);
      setSource(data.file.content);
      setSavedSource(data.file.content);
      setCommitMessage(`fix: update ${data.file.path}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เปิดไฟล์ไม่สำเร็จ");
    } finally {
      setFileLoading(false);
    }
  }

  function newFile() {
    if (dirty && !window.confirm("มีไฟล์ที่ยังไม่ได้บันทึก ต้องการสร้างไฟล์ใหม่หรือไม่?")) return;
    setFilePath("");
    setSource("");
    setSavedSource("");
    setCommitMessage("feat: add source file");
  }

  function openDetachedEditor() {
    if (!repoName) return;
    const params = new URLSearchParams({
      repo: repoName,
      base: baseRef,
      ref: currentRef
    });
    if (workingBranch) params.set("branch", workingBranch);
    if (filePath) params.set("path", filePath);
    window.open(
      `/it-admin/development-editor?${params}`,
      "cpipos-development-editor",
      "popup=yes,width=1500,height=950,resizable=yes,scrollbars=yes"
    );
  }

  function requirePin(value = pin) {
    if (!/^\d{4,12}$/.test(value.trim())) {
      setError("กรุณากรอก Security PIN 4–12 หลัก");
      return false;
    }
    return true;
  }

  async function saveSource() {
    if (!repoName || !filePath.trim()) return setError("กรุณาเลือกหรือระบุ Path ของไฟล์");
    if (!commitMessage.trim()) return setError("กรุณาระบุ Commit message");
    if (!requirePin()) return;

    setBusy("save");
    setError("");
    try {
      const data = await readJson<{ result: SaveResult }>(
        await fetch("/api/it-admin/v1/development/source", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            repo: repoName,
            base_ref: baseRef,
            branch: workingBranch || null,
            path: filePath.trim(),
            content: source,
            message: commitMessage.trim(),
            pin
          })
        })
      );
      setWorkingBranch(data.result.branch);
      setSavedSource(source);
      setPin("");
      setNotice(`Saved · ${data.result.commit_sha?.slice(0, 8) ?? "GitHub"}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึก Source Code ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function createPr() {
    if (!workingBranch) return setError("บันทึกไฟล์ให้เกิด Development Branch ก่อน");
    if (!requirePin()) return;
    setBusy("pr");
    setError("");
    try {
      const data = await readJson<{ result: PrResult }>(
        await fetch("/api/it-admin/v1/development/pull-requests", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            repo: repoName,
            branch: workingBranch,
            base_ref: baseRef,
            title: commitMessage.trim() || `Development: ${filePath}`,
            body: `CpIPOS Development Center\nRepository: ${repoName}\nBranch: ${workingBranch}\nFile: ${filePath}`,
            pin
          })
        })
      );
      setPr(data.result);
      setPin("");
      setNotice(`PR #${data.result.number ?? "?"} created`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "สร้าง Pull Request ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function mergePr() {
    if (!pr?.number || !requirePin()) return;
    if (!window.confirm(`Merge PR #${pr.number} เข้า ${baseRef} ?`)) return;
    setBusy("merge");
    setError("");
    try {
      const data = await readJson<{ result: { merged: boolean; commit_sha: string | null } }>(
        await fetch("/api/it-admin/v1/development/pull-requests", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repo: repoName, number: pr.number, pin })
        })
      );
      setPin("");
      setWorkingBranch("");
      setPr(null);
      setNotice(`Merged · ${data.result.commit_sha?.slice(0, 8) ?? baseRef}`);
      await loadTree(repoName, baseRef);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Merge ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function loadDeployments(open = true) {
    if (open) setDeploymentsOpen(true);
    if (!repoName || !overview?.connections.vercel_configured) return;
    setBusy("deployments");
    setError("");
    try {
      const params = new URLSearchParams({ repo: repoName });
      const data = await readJson<{ result: { deployments: Deployment[] } }>(
        await fetch(`/api/it-admin/v1/development/deployments?${params}`, { cache: "no-store" })
      );
      setDeployments(data.result.deployments);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลด Deployments ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function deploy(target: "preview" | "production") {
    if (!repoName || !requirePin()) return;
    const ref = target === "production" ? baseRef : currentRef;
    if (target === "production" && workingBranch) return setError("Merge เข้า Branch หลักก่อน Production Deploy");
    if (!window.confirm(`${target === "production" ? "Production" : "Preview"} Deploy จาก ${ref} ?`)) return;

    setBusy(target);
    setError("");
    try {
      const data = await readJson<{ result: DeployResult }>(
        await fetch("/api/it-admin/v1/development/deployments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repo: repoName, ref, target, pin })
        })
      );
      setPin("");
      if (data.result.url) setPreviewUrl(data.result.url);
      setNotice(`${target === "production" ? "Production" : "Preview"} Deploy · ${data.result.state}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "สั่ง Deploy ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function loadWorkspaceRuns() {
    setBusy("workspace-runs");
    setError("");
    try {
      const data = await readJson<{ runs: WorkspaceRun[] }>(
        await fetch("/api/it-admin/v1/development/workspace?limit=12", { cache: "no-store" })
      );
      setWorkspaceRuns(data.runs);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลด Workspace Runs ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function openWorkspace() {
    setWorkspaceOpen(true);
    await loadWorkspaceRuns();
  }

  async function runWorkspace() {
    if (!repoName || !requirePin(workspacePin)) return;
    setBusy("workspace-run");
    setError("");
    try {
      const data = await readJson<{ result: { request_id: string; status: string } }>(
        await fetch("/api/it-admin/v1/development/workspace", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ repo: repoName, ref: currentRef, task: workspaceTask, pin: workspacePin })
        })
      );
      setWorkspacePin("");
      setNotice(`Isolated ${workspaceTask} queued · ${data.result.request_id.slice(0, 8)}`);
      await loadWorkspaceRuns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เริ่ม Isolated Workspace ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function inspectWorkspaceRun(runId: number) {
    setBusy(`workspace-${runId}`);
    setError("");
    try {
      const data = await readJson<{ run: WorkspaceRunDetail }>(
        await fetch(`/api/it-admin/v1/development/workspace?run_id=${runId}`, { cache: "no-store" })
      );
      setWorkspaceDetail(data.run);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "โหลด Run detail ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function cancelWorkspaceRun(runId: number) {
    if (!requirePin(workspacePin)) return;
    if (!window.confirm(`ยกเลิก Workspace Run #${runId} ?`)) return;
    setBusy(`workspace-cancel-${runId}`);
    setError("");
    try {
      await readJson<{ result: { cancelled: boolean } }>(
        await fetch("/api/it-admin/v1/development/workspace", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ run_id: runId, pin: workspacePin })
        })
      );
      setWorkspacePin("");
      setWorkspaceDetail(null);
      setNotice(`ยกเลิก Workspace Run #${runId} แล้ว`);
      await loadWorkspaceRuns();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ยกเลิก Run ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="grid gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-2xl font-black text-slate-950">Development / Source Control</h2>
          <div className="mt-1 text-xs font-bold text-slate-500">GitHub · Isolated Build/Run · Deploy</div>
        </div>
        <ToolbarButton onClick={() => setStatusOpen(true)}>สถานะ</ToolbarButton>
        <ToolbarButton onClick={() => setQuotaOpen(true)}>Quota</ToolbarButton>
        <ToolbarButton onClick={() => void openWorkspace()} strong>Build / Run</ToolbarButton>
        <ToolbarButton onClick={() => void loadDeployments(true)}>Deployments</ToolbarButton>
        <ToolbarButton onClick={openDetachedEditor}>เปิด Editor ใหม่</ToolbarButton>
        <ToolbarButton onClick={() => void loadOverview()} disabled={overviewLoading}>
          {overviewLoading ? "..." : "รีเฟรช"}
        </ToolbarButton>
      </header>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-700" role="alert">{error}</div> : null}
      {notice ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
          <span>{notice}</span>
          {previewUrl ? <a href={previewUrl} target="_blank" rel="noreferrer" className="ml-auto rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs">เปิด Preview</a> : null}
        </div>
      ) : null}

      <section className="grid min-h-[720px] gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label className="text-[11px] font-black text-slate-500">Repository</label>
          <select value={repoName} onChange={(event) => void chooseRepo(event.target.value)}
            className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-black">
            {(overview?.repositories ?? []).map((repo) => (
              <option key={repo.name} value={repo.name}>{repo.name}{repo.private ? " · Private" : ""}</option>
            ))}
          </select>
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
            <span>Base <strong>{baseRef}</strong></span>
            <span>{workingBranch ? "DEV BRANCH" : "READ"}</span>
          </div>
          {workingBranch ? <code className="mt-2 block break-all rounded-lg bg-blue-50 px-2 py-1.5 text-[10px] font-bold text-blue-700">{workingBranch}</code> : null}

          <div className="mt-4 flex gap-2">
            <input value={fileFilter} onChange={(event) => setFileFilter(event.target.value)} placeholder="ค้นหาไฟล์"
              className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs" />
            <button type="button" onClick={() => void loadTree()} className="rounded-lg border border-slate-300 px-3 text-xs font-bold">
              {treeLoading ? "..." : "↻"}
            </button>
          </div>

          <div className="mt-3 max-h-[610px] overflow-auto rounded-xl border border-slate-200">
            {treeLoading ? <div className="p-5 text-center text-xs text-slate-500">กำลังโหลด...</div> : visibleFiles.length ? visibleFiles.map((file) => (
              <button key={file.path} type="button" onClick={() => void openFile(file.path)}
                className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left font-mono text-[10px] leading-4 last:border-0 ${filePath === file.path ? "bg-blue-50 font-bold text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>
                {file.path}
              </button>
            )) : <div className="p-5 text-center text-xs text-slate-500">ไม่พบไฟล์</div>}
          </div>

          <button type="button" onClick={newFile}
            className="mt-3 w-full rounded-xl border border-dashed border-blue-300 px-3 py-2 text-xs font-black text-blue-700">
            + New File
          </button>
        </aside>

        <div className="grid min-w-0 content-start gap-3">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-3">
              <input value={filePath} onChange={(event) => setFilePath(event.target.value)}
                placeholder="path/to/file.tsx"
                className="min-w-[240px] flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs" />
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${dirty ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>
                {fileLoading ? "LOADING" : dirty ? "CHANGED" : "CLEAN"}
              </span>
              <button type="button" onClick={openDetachedEditor}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700">
                ↗ Editor ใหม่
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2.5">
              <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Commit message"
                className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 12))}
                type="password" inputMode="numeric" autoComplete="off" placeholder="Security PIN"
                className="w-40 rounded-lg border border-slate-300 px-3 py-2 text-xs" />
              <ActionButton onClick={() => void saveSource()} disabled={busy !== "" || !overview?.connections.github_write_configured} primary>
                {busy === "save" ? "Saving..." : "Save GitHub"}
              </ActionButton>
              <ActionButton onClick={() => void createPr()} disabled={!workingBranch || busy !== "" || !overview?.connections.github_write_configured}>Create PR</ActionButton>
              <ActionButton onClick={() => void mergePr()} disabled={!pr?.number || busy !== ""}>{pr?.number ? `Merge #${pr.number}` : "Merge PR"}</ActionButton>
              <ActionButton onClick={() => void deploy("preview")} disabled={busy !== "" || !overview?.connections.vercel_configured}>Preview</ActionButton>
              <ActionButton onClick={() => void deploy("production")} disabled={busy !== "" || Boolean(workingBranch) || !overview?.connections.vercel_configured} danger>Production</ActionButton>
            </div>

            <textarea value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false}
              aria-label="Source code editor"
              className="min-h-[610px] w-full resize-y bg-slate-950 p-4 font-mono text-[13px] leading-6 text-slate-100 outline-none"
              placeholder={fileLoading ? "Loading..." : "// Select a file"} />
          </section>

          <div className="flex flex-wrap gap-2 text-[10px] font-bold text-slate-500">
            <span className="rounded-full bg-slate-100 px-2.5 py-1">Ref: {currentRef}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">PIN required</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">Audit enabled</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">No direct main write</span>
          </div>
        </div>
      </section>

      {statusOpen ? (
        <Modal title="สถานะระบบ" onClose={() => setStatusOpen(false)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatusCard label="GitHub Source" ok={Boolean(overview?.connections.github_read_configured)}
              value={overview ? `${overview.repositories.length} repositories` : "—"}
              note={overview?.connections.github_write_configured ? "Read + Write" : "Read only"} />
            <StatusCard label="Vercel" ok={Boolean(overview?.connections.vercel_configured)}
              value={overview?.connections.vercel_configured ? `${overview.vercel_projects.length} projects` : "Not connected"}
              note="Manual requests only" />
            <StatusCard label="GitHub API" ok={(overview?.github_rate_limit?.remaining ?? 1) > 100}
              value={overview?.github_rate_limit ? `${overview.github_rate_limit.remaining} / ${overview.github_rate_limit.limit}` : "Server token required"}
              note={overview?.github_rate_limit?.reset_at ? `Reset ${formatDate(overview.github_rate_limit.reset_at)}` : "—"} />
            <StatusCard label="Control API · 60m" ok={(overview?.guard.recent_control_actions_60m ?? 0) < 100}
              value={String(overview?.guard.recent_control_actions_60m ?? 0)}
              note="Audit-backed" />
          </div>
        </Modal>
      ) : null}

      {quotaOpen ? (
        <Modal title="Quota / API Guard" onClose={() => setQuotaOpen(false)}>
          <div className="grid gap-2 text-sm text-slate-700">
            <QuotaRow label="Source write" value={`${overview?.guard.source_write_limit_per_5_minutes ?? 12} / 5 นาที`} />
            <QuotaRow label="Build / Run" value={`${overview?.guard.workspace_run_limit_per_15_minutes ?? 4} / 15 นาที`} />
            <QuotaRow label="Vercel Deploy" value={`${overview?.guard.deployment_limit_per_10_minutes ?? 4} / 10 นาที`} />
            <QuotaRow label="Production" value={`${overview?.guard.production_deployment_limit_per_hour ?? 2} / ชั่วโมง`} />
            <QuotaRow label="PIN" value={`${overview?.guard.pin_attempt_limit_per_minute ?? 6} / นาที`} />
          </div>
          <a href={overview?.guard.usage_dashboard_url ?? "https://vercel.com/usage"} target="_blank" rel="noreferrer"
            className="mt-4 inline-flex rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-black text-white">
            เปิด Vercel Usage
          </a>
        </Modal>
      ) : null}

      {workspaceOpen ? (
        <Modal title="Isolated Build / Run" onClose={() => { setWorkspaceOpen(false); setWorkspaceDetail(null); }} wide>
          <div className="grid gap-3 lg:grid-cols-[1fr_190px_190px_auto]">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs">
              <div className="font-black text-slate-900">{repoName || "Repository"}</div>
              <div className="mt-1 truncate font-mono text-[10px] text-slate-500">{currentRef}</div>
            </div>
            <select value={workspaceTask} onChange={(event) => setWorkspaceTask(event.target.value as WorkspaceTask)}
              className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold">
              <option value="verify">Verify</option>
              <option value="build">Build</option>
              <option value="test">Test</option>
            </select>
            <input value={workspacePin} onChange={(event) => setWorkspacePin(event.target.value.replace(/\D/g, "").slice(0, 12))}
              type="password" inputMode="numeric" autoComplete="off" placeholder="Security PIN"
              className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
            <button type="button" onClick={() => void runWorkspace()}
              disabled={busy !== "" || !overview?.connections.isolated_workspace_configured}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white disabled:opacity-40">
              {busy === "workspace-run" ? "Starting..." : "Run"}
            </button>
          </div>

          {!overview?.connections.isolated_workspace_configured ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">
              ต้องตั้ง Server GitHub token ก่อนจึงจะ Dispatch Workspace ได้
            </div>
          ) : null}

          <div className="mt-4 flex items-center justify-between gap-2">
            <h3 className="text-sm font-black text-slate-900">Runs ล่าสุด</h3>
            <button type="button" onClick={() => void loadWorkspaceRuns()} disabled={busy !== ""}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">รีเฟรช</button>
          </div>

          <div className="mt-2 grid gap-2">
            {workspaceRuns.length ? workspaceRuns.map((run) => (
              <button key={run.id ?? run.request_id} type="button" disabled={!run.id}
                onClick={() => run.id && void inspectWorkspaceRun(run.id)}
                className="grid gap-2 rounded-xl border border-slate-200 px-3 py-3 text-left hover:bg-slate-50 md:grid-cols-[1.4fr_.8fr_.8fr_150px]">
                <div className="min-w-0">
                  <div className="truncate text-xs font-black text-slate-900">{run.repository ?? "Workspace"}</div>
                  <div className="mt-1 truncate font-mono text-[10px] text-slate-500">{run.ref ?? "—"}</div>
                </div>
                <div className="text-xs font-bold text-slate-700">{run.task ?? "—"}</div>
                <div><span className={`rounded-full px-2 py-1 text-[10px] font-black ${runTone(run)}`}>{run.status === "completed" ? run.conclusion ?? "completed" : run.status}</span></div>
                <div className="text-[10px] text-slate-500">{formatDate(run.created_at)}</div>
              </button>
            )) : <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">ยังไม่มี Workspace Run</div>}
          </div>

          {workspaceDetail ? (
            <section className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <strong className="mr-auto text-sm text-slate-900">Run #{workspaceDetail.id}</strong>
                <span className={`rounded-full px-2 py-1 text-[10px] font-black ${runTone(workspaceDetail)}`}>
                  {workspaceDetail.status === "completed" ? workspaceDetail.conclusion ?? "completed" : workspaceDetail.status}
                </span>
                {workspaceDetail.url ? <a href={workspaceDetail.url} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold">GitHub Log</a> : null}
                {workspaceDetail.id && workspaceDetail.status !== "completed" ? (
                  <button type="button" onClick={() => void cancelWorkspaceRun(workspaceDetail.id!)}
                    className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700">ยกเลิก Run</button>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2">
                {workspaceDetail.jobs.flatMap((job) => job.steps).map((step, index) => (
                  <div key={`${step.number}-${index}`} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 text-xs">
                    <span className="w-6 text-slate-400">{step.number ?? "•"}</span>
                    <span className="min-w-0 flex-1 truncate font-bold text-slate-700">{step.name}</span>
                    <span className={`rounded-full px-2 py-1 text-[10px] font-black ${runTone({ status: step.status, conclusion: step.conclusion })}`}>
                      {step.status === "completed" ? step.conclusion ?? "done" : step.status}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </Modal>
      ) : null}

      {deploymentsOpen ? (
        <Modal title="Vercel Deployments" onClose={() => setDeploymentsOpen(false)} wide>
          {!overview?.connections.vercel_configured ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">ยังไม่ได้เชื่อม Vercel Deploy API</div>
          ) : deployments.length ? (
            <div className="grid gap-2">
              {deployments.map((deployment, index) => (
                <a key={deployment.id ?? index} href={deployment.url ?? "#"} target={deployment.url ? "_blank" : undefined} rel="noreferrer"
                  className="grid gap-2 rounded-xl border border-slate-200 px-3 py-3 text-xs hover:bg-slate-50 md:grid-cols-[120px_1fr_120px_170px]">
                  <strong>{deployment.target}</strong>
                  <span className="truncate font-mono text-[10px] text-slate-500">{deployment.git_ref ?? deployment.git_sha ?? "—"}</span>
                  <span>{deployment.state ?? "—"}</span>
                  <span className="text-slate-500">{formatDate(deployment.created_at)}</span>
                </a>
              ))}
            </div>
          ) : <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">{busy === "deployments" ? "กำลังโหลด..." : "ยังไม่มีข้อมูล"}</div>}
        </Modal>
      ) : null}
    </main>
  );
}

function ToolbarButton({ children, onClick, disabled = false, strong = false }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  strong?: boolean;
}) {
  return <button type="button" onClick={onClick} disabled={disabled}
    className={`rounded-xl px-4 py-2.5 text-xs font-black shadow-sm disabled:opacity-40 ${strong ? "bg-blue-600 text-white" : "border border-slate-300 bg-white text-slate-700"}`}>
    {children}
  </button>;
}

function ActionButton({ children, onClick, disabled = false, primary = false, danger = false }: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  danger?: boolean;
}) {
  const tone = primary ? "bg-blue-600 text-white border-blue-600" : danger ? "border-red-200 text-red-700 bg-white" : "border-slate-300 text-slate-700 bg-white";
  return <button type="button" onClick={onClick} disabled={disabled}
    className={`rounded-lg border px-3 py-2 text-xs font-black disabled:cursor-not-allowed disabled:opacity-35 ${tone}`}>
    {children}
  </button>;
}

function StatusCard({ label, value, note, ok }: { label: string; value: string; note: string; ok: boolean }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-black text-slate-500">{label}</span>
        <span className={`h-2.5 w-2.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />
      </div>
      <strong className="mt-2 block text-xl font-black text-slate-950">{value}</strong>
      <span className="mt-1 block text-[10px] text-slate-500">{note}</span>
    </article>
  );
}

function QuotaRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3"><span className="font-bold">{label}</span><strong>{value}</strong></div>;
}

function Modal({ title, children, onClose, wide = false }: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/45 p-4" onMouseDown={(event) => {
      if (event.currentTarget === event.target) onClose();
    }}>
      <section className={`max-h-[90vh] w-full overflow-auto rounded-2xl bg-white p-5 shadow-2xl ${wide ? "max-w-5xl" : "max-w-2xl"}`}>
        <div className="mb-4 flex items-center gap-3">
          <h3 className="mr-auto text-xl font-black text-slate-950">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-black text-slate-500">×</button>
        </div>
        {children}
      </section>
    </div>
  );
}
