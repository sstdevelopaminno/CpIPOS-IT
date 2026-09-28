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

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
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
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const selectedRepo = useMemo(
    () => overview?.repositories.find((repo) => repo.name === repoName) ?? null,
    [overview, repoName]
  );
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

  async function chooseRepo(next: string) {
    if (dirty && !window.confirm("มี Source Code ที่ยังไม่ได้บันทึก ต้องการเปลี่ยน Repository หรือไม่?")) return;
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
    if (dirty && path !== filePath && !window.confirm("มี Source Code ที่ยังไม่ได้บันทึก ต้องการเปิดไฟล์อื่นหรือไม่?")) return;
    setFileLoading(true);
    setError("");
    setNotice("");
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
    if (dirty && !window.confirm("มี Source Code ที่ยังไม่ได้บันทึก ต้องการสร้างไฟล์ใหม่หรือไม่?")) return;
    setFilePath("");
    setSource("");
    setSavedSource("");
    setCommitMessage("feat: add new source file");
    setNotice("ระบุ Path ของไฟล์ใหม่ แล้วเขียน Source Code จากนั้นกดบันทึกขึ้น GitHub");
  }

  function requirePin() {
    if (!/^\d{4,12}$/.test(pin.trim())) {
      setError("กรุณากรอก Security PIN ของบัญชี IT Support 4–12 หลักก่อนดำเนินการ");
      return false;
    }
    return true;
  }

  async function saveSource() {
    if (!repoName || !filePath.trim()) {
      setError("กรุณาเลือกหรือระบุ Path ของไฟล์");
      return;
    }
    if (!commitMessage.trim()) {
      setError("กรุณาระบุ Commit message");
      return;
    }
    if (!requirePin()) return;

    setBusy("save");
    setError("");
    setNotice("");
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
      setFilePath(data.result.path);
      setPin("");
      setNotice(`บันทึกขึ้น GitHub แล้ว · Branch ${data.result.branch} · Commit ${data.result.commit_sha?.slice(0, 8) ?? "สำเร็จ"}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึก Source Code ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function createPr() {
    if (!workingBranch) {
      setError("ต้องบันทึก Source Code ให้ระบบสร้าง Development Branch ก่อน");
      return;
    }
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
            title: commitMessage.trim() || `Development Center: ${filePath}`,
            body: `สร้างจาก CpIPOS IT Development Center\n\nRepository: ${repoName}\nBranch: ${workingBranch}\nFile: ${filePath}`,
            pin
          })
        })
      );
      setPr(data.result);
      setPin("");
      setNotice(`สร้าง Pull Request #${data.result.number ?? "?"} แล้ว`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "สร้าง Pull Request ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function mergePr() {
    if (!pr?.number) return;
    if (!requirePin()) return;
    if (!window.confirm(`ยืนยัน Merge Pull Request #${pr.number} เข้า ${baseRef} ?\n\nระบบจะบันทึก Audit Log พร้อมผู้ดำเนินการ`)) return;
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
      setNotice(`Merge เข้า ${baseRef} แล้ว · Commit ${data.result.commit_sha?.slice(0, 8) ?? "สำเร็จ"}`);
      await loadTree(repoName, baseRef);
      if (filePath) await openFile(filePath);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Merge Pull Request ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function loadDeployments() {
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
      setError(cause instanceof Error ? cause.message : "โหลด Vercel Deployments ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  async function deploy(target: "preview" | "production") {
    if (!repoName) return;
    if (!requirePin()) return;
    const ref = target === "production" ? baseRef : currentRef;
    if (target === "production" && workingBranch) {
      setError("กรุณา Merge Pull Request เข้า Branch หลักก่อน Production Deploy");
      return;
    }
    if (!window.confirm(`ยืนยัน ${target === "production" ? "Production" : "Preview"} Deploy จาก ${ref} ไป Vercel ?`)) return;

    setBusy(target);
    setError("");
    setNotice("");
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
      setNotice(`ส่งคำสั่ง ${target === "production" ? "Production" : "Preview"} Deploy แล้ว · ${data.result.state}`);
      await loadDeployments();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "สั่ง Deploy ไม่สำเร็จ");
    } finally {
      setBusy("");
    }
  }

  return (
    <main className="grid gap-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="text-[11px] font-black tracking-[0.13em] text-blue-600">DEVELOPMENT CONTROL CENTER · PHASE 1</span>
          <h2 className="mt-1 text-3xl font-black text-slate-950">Development / Source Control</h2>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-slate-600">
            อ่านและแก้ไข Source Code จาก GitHub ผ่าน Server เท่านั้น ไม่แจก Token ให้ Browser และไม่แก้ Branch หลักโดยตรง
            ทุกคำสั่งเขียนโค้ด, Merge และ Deploy ต้องยืนยัน <strong className="text-slate-900">Security PIN ของ IT Support</strong> และบันทึก Audit Log
          </p>
        </div>
        <button type="button" onClick={() => void loadOverview()} disabled={overviewLoading}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 shadow-sm disabled:opacity-50">
          {overviewLoading ? "กำลังตรวจสอบ..." : "รีเฟรชการเชื่อมต่อ"}
        </button>
      </header>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard label="GitHub Source" ok={Boolean(overview?.connections.github_read_configured)}
          value={overview ? `${overview.repositories.length} repositories` : "กำลังตรวจสอบ"} note={overview?.connections.github_write_configured ? "Read + Write พร้อม" : "Read only · ยังไม่มี Server token"} />
        <StatusCard label="Vercel Control" ok={Boolean(overview?.connections.vercel_configured)}
          value={overview?.connections.vercel_configured ? `${overview.vercel_projects.length} projects` : "ยังไม่เชื่อม Deploy API"} note="ไม่มี polling อัตโนมัติ" />
        <StatusCard label="GitHub API quota" ok={(overview?.github_rate_limit?.remaining ?? 1) > 100}
          value={overview?.github_rate_limit ? `${overview.github_rate_limit.remaining.toLocaleString()} / ${overview.github_rate_limit.limit.toLocaleString()}` : "รอ Server token"} note={overview?.github_rate_limit?.reset_at ? `Reset ${formatDate(overview.github_rate_limit.reset_at)}` : "ใช้ Server-side API เท่านั้น"} />
        <StatusCard label="Control API · 60 นาที" ok={(overview?.guard.recent_control_actions_60m ?? 0) < 100}
          value={String(overview?.guard.recent_control_actions_60m ?? 0)} note="บันทึกจาก Audit Log · ไม่ใช่ polling" />
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <strong>Vercel Quota / API Guard</strong>
            <div className="mt-1 text-xs text-amber-800">
              Write {overview?.guard.source_write_limit_per_5_minutes ?? 12}/5 นาที · Deploy {overview?.guard.deployment_limit_per_10_minutes ?? 4}/10 นาที · Production {overview?.guard.production_deployment_limit_per_hour ?? 2}/ชั่วโมง · PIN {overview?.guard.pin_attempt_limit_per_minute ?? 6}/นาที
            </div>
            <div className="mt-1 text-xs text-amber-800">{overview?.guard.exact_vercel_account_quota}</div>
          </div>
          <a href={overview?.guard.usage_dashboard_url ?? "https://vercel.com/usage"} target="_blank" rel="noreferrer"
            className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-xs font-black text-amber-900">
            เปิด Vercel Usage
          </a>
        </div>
      </section>

      {error ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700" role="alert">{error}</div> : null}
      {notice ? <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-800">{notice}</div> : null}

      <section className="grid gap-4 xl:grid-cols-[330px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-2">
            <label className="text-xs font-black text-slate-600">GitHub Project / Repository</label>
            <select value={repoName} onChange={(event) => void chooseRepo(event.target.value)}
              className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm font-bold">
              {(overview?.repositories ?? []).map((repo) => (
                <option key={repo.name} value={repo.name}>{repo.name}{repo.private ? " · Private" : ""}</option>
              ))}
            </select>
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>Base: <strong>{baseRef}</strong></span>
              <span>{workingBranch ? "Development Branch" : "Read branch"}</span>
            </div>
            {workingBranch ? <code className="break-all rounded-lg bg-blue-50 px-2 py-1.5 text-[11px] font-bold text-blue-700">{workingBranch}</code> : null}
          </div>

          <div className="mt-4 flex gap-2">
            <input value={fileFilter} onChange={(event) => setFileFilter(event.target.value)} placeholder="ค้นหา path..."
              className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-xs" />
            <button type="button" onClick={() => void loadTree()} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-bold">
              {treeLoading ? "..." : "รีเฟรช"}
            </button>
          </div>

          <div className="mt-3 max-h-[620px] overflow-auto rounded-xl border border-slate-200">
            {treeLoading ? <div className="p-5 text-center text-xs text-slate-500">กำลังโหลดไฟล์...</div> : visibleFiles.length ? visibleFiles.map((file) => (
              <button key={file.path} type="button" onClick={() => void openFile(file.path)}
                className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left font-mono text-[11px] leading-4 last:border-0 ${filePath === file.path ? "bg-blue-50 font-bold text-blue-700" : "text-slate-700 hover:bg-slate-50"}`}>
                {file.path}
              </button>
            )) : <div className="p-5 text-center text-xs text-slate-500">ไม่พบ Source file ที่เปิดแก้ได้</div>}
          </div>
          <button type="button" onClick={newFile} className="mt-3 w-full rounded-xl border border-dashed border-blue-300 px-3 py-2.5 text-xs font-black text-blue-700">
            + สร้าง Source File ใหม่
          </button>
        </aside>

        <div className="grid min-w-0 gap-4">
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="min-w-0 flex-1">
                <input value={filePath} onChange={(event) => setFilePath(event.target.value)}
                  placeholder="path/to/file.tsx"
                  className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs" />
                <div className="mt-1 text-[11px] text-slate-500">Ref: {currentRef} {dirty ? "· มีการแก้ไขที่ยังไม่ Commit" : "· ตรงกับไฟล์ที่โหลดล่าสุด"}</div>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[11px] font-black ${dirty ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-700"}`}>
                {fileLoading ? "LOADING" : dirty ? "UNCOMMITTED" : "CLEAN"}
              </span>
            </div>
            <textarea value={source} onChange={(event) => setSource(event.target.value)} spellCheck={false}
              aria-label="Source code editor"
              className="min-h-[560px] w-full resize-y bg-slate-950 p-4 font-mono text-[13px] leading-6 text-slate-100 outline-none"
              placeholder="// เปิดไฟล์จากด้านซ้าย หรือระบุ path เพื่อสร้างไฟล์ใหม่" />
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
              <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)} placeholder="Commit message"
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              <input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 12))}
                type="password" inputMode="numeric" autoComplete="off" placeholder="Security PIN ของ IT Support"
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm" />
              <button type="button" onClick={() => void saveSource()} disabled={busy !== "" || !overview?.connections.github_write_configured}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-40">
                {busy === "save" ? "กำลัง Commit..." : "บันทึกขึ้น GitHub"}
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              ระบบจะสร้าง Branch <code>it-support/...</code> ให้อัตโนมัติในครั้งแรก และปฏิเสธการเขียนลง main โดยตรง
            </p>

            <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
              <button type="button" onClick={() => void createPr()} disabled={!workingBranch || busy !== "" || !overview?.connections.github_write_configured}
                className="rounded-xl border border-blue-200 px-4 py-2.5 text-xs font-black text-blue-700 disabled:opacity-40">
                {busy === "pr" ? "กำลังสร้าง PR..." : "สร้าง Pull Request"}
              </button>
              <button type="button" onClick={() => void mergePr()} disabled={!pr?.number || busy !== ""}
                className="rounded-xl border border-violet-200 px-4 py-2.5 text-xs font-black text-violet-700 disabled:opacity-40">
                {busy === "merge" ? "กำลัง Merge..." : pr?.number ? `Merge PR #${pr.number}` : "Merge PR"}
              </button>
              {pr?.url ? <a href={pr.url} target="_blank" rel="noreferrer" className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700">เปิด PR บน GitHub</a> : null}
              <span className="mx-1 hidden h-9 w-px bg-slate-200 sm:block" />
              <button type="button" onClick={() => void deploy("preview")} disabled={busy !== "" || !repoName || !overview?.connections.vercel_configured}
                className="rounded-xl border border-emerald-200 px-4 py-2.5 text-xs font-black text-emerald-700 disabled:opacity-40">
                {busy === "preview" ? "กำลัง Deploy..." : "Deploy Preview"}
              </button>
              <button type="button" onClick={() => void deploy("production")} disabled={busy !== "" || Boolean(workingBranch) || !repoName || !overview?.connections.vercel_configured}
                className="rounded-xl border border-red-200 px-4 py-2.5 text-xs font-black text-red-700 disabled:opacity-40">
                {busy === "production" ? "กำลัง Deploy..." : "Deploy Production"}
              </button>
              <button type="button" onClick={() => void loadDeployments()} disabled={busy !== "" || !overview?.connections.vercel_configured}
                className="rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 disabled:opacity-40">
                {busy === "deployments" ? "กำลังโหลด..." : "สถานะ Deploy"}
              </button>
            </div>
          </section>

          {deployments.length ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-black text-slate-900">Vercel Deployments ล่าสุด</h3><span className="text-xs text-slate-500">{deployments.length} รายการ</span></div>
              <div className="grid gap-2">
                {deployments.slice(0, 8).map((deployment, index) => (
                  <button key={deployment.id ?? index} type="button" disabled={!deployment.url}
                    onClick={() => deployment.url && setPreviewUrl(deployment.url)}
                    className="grid gap-1 rounded-xl border border-slate-200 px-3 py-2 text-left text-xs hover:bg-slate-50 md:grid-cols-[120px_1fr_150px]">
                    <strong className="text-slate-800">{deployment.target}</strong>
                    <span className="truncate text-slate-600">{deployment.git_ref ?? deployment.url ?? "—"}</span>
                    <span className="text-slate-500">{deployment.state ?? "—"} · {formatDate(deployment.created_at)}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          {previewUrl ? (
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
                <div><strong className="text-sm text-slate-900">Preview / View</strong><div className="mt-0.5 max-w-2xl truncate text-[11px] text-slate-500">{previewUrl}</div></div>
                <a href={previewUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-bold">เปิดแท็บใหม่</a>
              </div>
              <iframe src={previewUrl} title="Vercel preview" className="h-[720px] w-full bg-white"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups" />
            </section>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-600">
        <strong className="text-slate-900">Security baseline Phase 1:</strong> IT Support only · Own PIN required for mutation · Branch isolation · Secret file blocking · Source size limit · API rate limit · Audit Log · No automatic polling · Production deploy only after merge to the default branch.
      </section>
    </main>
  );
}

function StatusCard({ label, value, note, ok }: { label: string; value: string; note: string; ok: boolean }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-black text-slate-500">{label}</span>
        <span className={`h-2.5 w-2.5 rounded-full ${ok ? "bg-emerald-500" : "bg-amber-500"}`} />
      </div>
      <strong className="mt-2 block text-2xl font-black text-slate-950">{value}</strong>
      <span className="mt-1 block text-[11px] leading-5 text-slate-500">{note}</span>
    </article>
  );
}
