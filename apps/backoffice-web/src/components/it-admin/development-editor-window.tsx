"use client";

import { useEffect, useMemo, useState } from "react";

type SourceFile = {
  repo: string;
  ref: string;
  path: string;
  sha: string | null;
  size: number;
  content: string;
};

type SaveResult = {
  repo: string;
  branch: string;
  path: string;
  commit_sha: string | null;
  commit_url: string | null;
};

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { data?: T; error?: { message?: string } } | null;
  if (!response.ok || !body?.data) throw new Error(body?.error?.message ?? `Request failed (${response.status})`);
  return body.data;
}

export function DevelopmentEditorWindow({
  repo,
  baseRef,
  initialRef,
  initialBranch,
  initialPath
}: {
  repo: string;
  baseRef: string;
  initialRef: string;
  initialBranch: string;
  initialPath: string;
}) {
  const [branch, setBranch] = useState(initialBranch);
  const [path, setPath] = useState(initialPath);
  const [source, setSource] = useState("");
  const [savedSource, setSavedSource] = useState("");
  const [commitMessage, setCommitMessage] = useState(initialPath ? `fix: update ${initialPath}` : "feat: add source file");
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(Boolean(initialPath));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const readRef = branch || initialRef || baseRef;
  const dirty = source !== savedSource;
  const title = useMemo(() => path.split("/").at(-1) || "New file", [path]);

  async function loadFile() {
    if (!path.trim()) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const params = new URLSearchParams({ mode: "file", repo, ref: readRef, path: path.trim() });
      const data = await readJson<{ file: SourceFile }>(
        await fetch(`/api/it-admin/v1/development/source?${params}`, { cache: "no-store" })
      );
      setSource(data.file.content);
      setSavedSource(data.file.content);
      setPath(data.file.path);
      setCommitMessage(`fix: update ${data.file.path}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "เปิดไฟล์ไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialPath) void loadFile();
    // Initial open only. Ref/branch changes happen after a successful save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (!path.trim()) {
      setError("กรุณาระบุ Path ของไฟล์");
      return;
    }
    if (!commitMessage.trim()) {
      setError("กรุณาระบุ Commit message");
      return;
    }
    if (!/^\d{4,12}$/.test(pin.trim())) {
      setError("กรุณากรอก Security PIN 4–12 หลัก");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const data = await readJson<{ result: SaveResult }>(
        await fetch("/api/it-admin/v1/development/source", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            repo,
            base_ref: baseRef,
            branch: branch || null,
            path: path.trim(),
            content: source,
            message: commitMessage.trim(),
            pin
          })
        })
      );
      setBranch(data.result.branch);
      setSavedSource(source);
      setPath(data.result.path);
      setPin("");
      setNotice(`Saved · ${data.result.commit_sha?.slice(0, 8) ?? "GitHub"}`);
      window.opener?.postMessage({
        type: "cpipos-development-save",
        repo,
        branch: data.result.branch,
        path: data.result.path,
        commit_sha: data.result.commit_sha
      }, window.location.origin);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="mr-auto min-w-0">
            <div className="text-[10px] font-black tracking-[0.16em] text-blue-400">CPIPOS EDITOR</div>
            <div className="truncate text-sm font-black text-white">{repo} · {title}</div>
          </div>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-black ${dirty ? "bg-amber-400/15 text-amber-300" : "bg-emerald-400/15 text-emerald-300"}`}>
            {dirty ? "CHANGED" : "CLEAN"}
          </span>
          <button type="button" onClick={() => void loadFile()} disabled={!path || loading}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-200 disabled:opacity-40">
            Reload
          </button>
          <button type="button" onClick={() => window.close()}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs font-bold text-slate-200">
            ปิด
          </button>
        </div>

        <div className="mt-3 grid gap-2 xl:grid-cols-[minmax(260px,1fr)_minmax(220px,.7fr)_180px_auto]">
          <input value={path} onChange={(event) => setPath(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-100 outline-none focus:border-blue-500"
            placeholder="path/to/file.tsx" />
          <input value={commitMessage} onChange={(event) => setCommitMessage(event.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-blue-500"
            placeholder="Commit message" />
          <input value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 12))}
            type="password" inputMode="numeric" autoComplete="off"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 outline-none focus:border-blue-500"
            placeholder="Security PIN" />
          <button type="button" onClick={() => void save()} disabled={saving}
            className="rounded-lg bg-blue-600 px-5 py-2 text-xs font-black text-white disabled:opacity-50">
            {saving ? "Saving..." : "Save GitHub"}
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-400">
          <span>Base: {baseRef}</span>
          <span>•</span>
          <span>Ref: {readRef}</span>
          {branch ? <><span>•</span><span className="text-blue-300">{branch}</span></> : null}
          {notice ? <span className="ml-auto font-bold text-emerald-300">{notice}</span> : null}
        </div>
        {error ? <div className="mt-2 rounded-lg border border-red-900/60 bg-red-950/50 px-3 py-2 text-xs font-bold text-red-300">{error}</div> : null}
      </header>

      <textarea
        value={source}
        onChange={(event) => setSource(event.target.value)}
        spellCheck={false}
        autoFocus
        className="min-h-0 flex-1 resize-none bg-slate-950 p-5 font-mono text-[14px] leading-6 text-slate-100 outline-none"
        placeholder={loading ? "Loading..." : "// Source code"}
      />
    </main>
  );
}
