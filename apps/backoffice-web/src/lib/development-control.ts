import "server-only";

import crypto from "node:crypto";
import { ItAdminGuardError } from "@/lib/it-admin-guard";

const DEFAULT_GITHUB_OWNER = "sstdevelopaminno";
const MAX_EDITABLE_FILE_BYTES = 800_000;
const DEV_BRANCH_PREFIX = "it-support/";

const BLOCKED_PATH = /(^|\/)(?:\.git|node_modules|\.env(?:\.|$)|[^/]*(?:secret|credential)[^/]*|[^/]+\.(?:pem|key|p12|pfx))(?:\/|$)/i;
const ALLOWED_TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".css", ".scss", ".html",
  ".yml", ".yaml", ".toml", ".xml", ".txt", ".sql", ".sh", ".ps1", ".cs", ".csproj", ".py", ".go",
  ".rs", ".java", ".kt", ".gradle", ".properties", ".ini", ".conf", ".gitignore", ".npmrc.example"
]);
const ALLOWED_TEXT_FILENAMES = new Set([
  "Dockerfile", "Makefile", "Procfile", "README", "LICENSE", ".gitignore", ".editorconfig"
]);

type GithubRepo = {
  name?: string;
  full_name?: string;
  private?: boolean;
  archived?: boolean;
  default_branch?: string;
  updated_at?: string;
  html_url?: string;
  owner?: { login?: string };
};

type GithubContentResponse = {
  type?: string;
  encoding?: string;
  content?: string;
  sha?: string;
  size?: number;
  path?: string;
  name?: string;
};

type VercelProject = {
  id?: string;
  name?: string;
  updatedAt?: number;
  link?: {
    type?: string;
    repo?: string;
    org?: string;
    repoId?: number;
  };
};

function cleanEnv(name: string) {
  const value = String(process.env[name] ?? "").trim();
  return value || null;
}

function githubOwner() {
  return cleanEnv("CPIPOS_GITHUB_OWNER") ?? DEFAULT_GITHUB_OWNER;
}

function githubToken() {
  return cleanEnv("CPIPOS_GITHUB_TOKEN");
}

function vercelToken() {
  return cleanEnv("CPIPOS_VERCEL_TOKEN");
}

function vercelTeamId() {
  return cleanEnv("CPIPOS_VERCEL_TEAM_ID") ?? cleanEnv("VERCEL_TEAM_ID");
}

function safeRepoName(value: unknown) {
  const name = typeof value === "string" ? value.trim() : "";
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name)) {
    throw new ItAdminGuardError("development_repo_invalid", "ชื่อ Repository ไม่ถูกต้อง", 422);
  }
  return name;
}

function safeRef(value: unknown, fallback = "main") {
  const ref = typeof value === "string" ? value.trim() : "";
  const normalized = ref || fallback;
  if (!/^[A-Za-z0-9._\/-]{1,180}$/.test(normalized) || normalized.includes("..") || normalized.startsWith("/")) {
    throw new ItAdminGuardError("development_ref_invalid", "Branch / Ref ไม่ถูกต้อง", 422);
  }
  return normalized;
}

function safePath(value: unknown) {
  const path = typeof value === "string" ? value.trim().replace(/^\/+/, "") : "";
  if (!path || path.length > 600 || path.includes("\0") || path.split("/").some((part) => part === "..")) {
    throw new ItAdminGuardError("development_path_invalid", "Path ของไฟล์ไม่ถูกต้อง", 422);
  }
  if (BLOCKED_PATH.test(path)) {
    throw new ItAdminGuardError("development_path_blocked", "ไฟล์นี้ถูกบล็อกเพื่อป้องกัน Secret / Credential รั่วไหล", 403);
  }
  const fileName = path.split("/").at(-1) ?? path;
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : "";
  if (!ALLOWED_TEXT_EXTENSIONS.has(ext) && !ALLOWED_TEXT_FILENAMES.has(fileName)) {
    throw new ItAdminGuardError("development_file_type_blocked", "Phase 1 เปิดแก้ไขเฉพาะ Source/Text file ที่กำหนดไว้", 415);
  }
  return path;
}

function encodeRepoPath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

async function requestJson<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const payload = await response.json().catch(() => null) as T | { message?: string } | null;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload
      ? String((payload as { message?: unknown }).message ?? "")
      : "";
    throw new ItAdminGuardError(
      `${label}_failed`,
      message || `${label} ไม่สำเร็จ (${response.status})`,
      response.status === 401 ? 503 : Math.min(Math.max(response.status, 400), 599)
    );
  }
  return payload as T;
}

function githubHeaders(write = false) {
  const token = githubToken();
  if (write && !token) {
    throw new ItAdminGuardError(
      "development_github_write_not_configured",
      "ยังไม่ได้ตั้ง CPIPOS_GITHUB_TOKEN บน Server จึงเปิดได้เฉพาะอ่าน Source Code",
      503
    );
  }
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function githubJson<T>(path: string, init: RequestInit = {}, write = false) {
  return requestJson<T>(
    `https://api.github.com${path}`,
    { ...init, headers: { ...githubHeaders(write), ...(init.headers ?? {}) } },
    "development_github"
  );
}

function vercelHeaders() {
  const token = vercelToken();
  if (!token) {
    throw new ItAdminGuardError(
      "development_vercel_not_configured",
      "ยังไม่ได้ตั้ง CPIPOS_VERCEL_TOKEN บน Server จึงยังสั่ง Preview/Deploy จาก Control Plane ไม่ได้",
      503
    );
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };
}

async function vercelJson<T>(path: string, init: RequestInit = {}) {
  return requestJson<T>(
    `https://api.vercel.com${path}`,
    { ...init, headers: { ...vercelHeaders(), ...(init.headers ?? {}) } },
    "development_vercel"
  );
}

export function getDevelopmentConnectionStatus() {
  return {
    github_owner: githubOwner(),
    github_read_configured: true,
    github_write_configured: Boolean(githubToken()),
    vercel_configured: Boolean(vercelToken()),
    vercel_team_configured: Boolean(vercelTeamId()),
    direct_main_write: false,
    polling_enabled: false
  };
}

export async function listDevelopmentRepositories() {
  const owner = githubOwner();
  const token = githubToken();
  const rows = token
    ? await githubJson<GithubRepo[]>("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member")
    : await githubJson<GithubRepo[]>(`/users/${encodeURIComponent(owner)}/repos?per_page=100&sort=updated`);

  return rows
    .filter((repo) => repo.name && !repo.archived)
    .filter((repo) => {
      const repoOwner = repo.owner?.login ?? repo.full_name?.split("/")[0] ?? "";
      return repoOwner.toLowerCase() === owner.toLowerCase();
    })
    .map((repo) => ({
      name: repo.name!,
      full_name: repo.full_name ?? `${owner}/${repo.name}`,
      private: Boolean(repo.private),
      default_branch: repo.default_branch || "main",
      updated_at: repo.updated_at ?? null,
      html_url: repo.html_url ?? null
    }));
}

export async function getGithubRateLimit() {
  if (!githubToken()) return null;
  const payload = await githubJson<{
    resources?: { core?: { limit?: number; remaining?: number; reset?: number; used?: number } };
  }>("/rate_limit");
  const core = payload.resources?.core;
  return core ? {
    limit: core.limit ?? 0,
    remaining: core.remaining ?? 0,
    used: core.used ?? 0,
    reset_at: core.reset ? new Date(core.reset * 1000).toISOString() : null
  } : null;
}

export async function getRepositoryTree(repoInput: unknown, refInput: unknown) {
  const repo = safeRepoName(repoInput);
  const ref = safeRef(refInput);
  const owner = githubOwner();
  const payload = await githubJson<{
    sha?: string;
    truncated?: boolean;
    tree?: Array<{ path?: string; type?: string; size?: number; sha?: string }>;
  }>(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`);

  const files = (payload.tree ?? [])
    .filter((row) => row.type === "blob" && row.path)
    .filter((row) => {
      try {
        safePath(row.path);
        return true;
      } catch {
        return false;
      }
    })
    .slice(0, 5000)
    .map((row) => ({ path: row.path!, size: row.size ?? null, sha: row.sha ?? null }));

  return { repo, ref, sha: payload.sha ?? null, truncated: Boolean(payload.truncated), files };
}

export async function getRepositoryFile(repoInput: unknown, refInput: unknown, pathInput: unknown) {
  const repo = safeRepoName(repoInput);
  const ref = safeRef(refInput);
  const path = safePath(pathInput);
  const owner = githubOwner();

  const payload = await githubJson<GithubContentResponse>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(ref)}`
  );

  if (payload.type !== "file" || payload.encoding !== "base64" || typeof payload.content !== "string") {
    throw new ItAdminGuardError("development_file_unreadable", "ไฟล์นี้ไม่ใช่ Text file ที่เปิดแก้ไขได้", 415);
  }
  if ((payload.size ?? 0) > MAX_EDITABLE_FILE_BYTES) {
    throw new ItAdminGuardError("development_file_too_large", "ไฟล์ใหญ่เกินขนาดที่ Phase 1 อนุญาตให้แก้ไข", 413);
  }

  const content = Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8");
  return {
    repo,
    ref,
    path,
    sha: payload.sha ?? null,
    size: payload.size ?? Buffer.byteLength(content, "utf8"),
    content
  };
}

function makeBranchName(path: string) {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const slug = path
    .split("/")
    .at(-1)!
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "change";
  return `${DEV_BRANCH_PREFIX}${stamp}-${slug.toLowerCase()}`;
}

async function getBranchHead(repo: string, ref: string) {
  const owner = githubOwner();
  return githubJson<{ object?: { sha?: string } }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${ref.split("/").map(encodeURIComponent).join("/")}`
  );
}

async function createBranch(repo: string, baseRef: string, branch: string) {
  const owner = githubOwner();
  const head = await getBranchHead(repo, baseRef);
  const sha = head.object?.sha;
  if (!sha) throw new ItAdminGuardError("development_branch_head_missing", "ไม่พบ Commit ต้นทางสำหรับสร้าง Branch", 409);
  await githubJson(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha })
    },
    true
  );
  return sha;
}

async function tryGetFileSha(repo: string, ref: string, path: string) {
  const owner = githubOwner();
  const response = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeRepoPath(path)}?ref=${encodeURIComponent(ref)}`,
    { headers: githubHeaders(true), cache: "no-store" }
  );
  if (response.status === 404) return null;
  const payload = await response.json().catch(() => null) as GithubContentResponse | { message?: string } | null;
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "message" in payload ? String(payload.message ?? "") : "";
    throw new ItAdminGuardError("development_file_lookup_failed", message || "โหลดสถานะไฟล์จาก GitHub ไม่สำเร็จ", response.status);
  }
  return (payload as GithubContentResponse)?.sha ?? null;
}

export async function saveRepositoryFile(input: {
  repo: unknown;
  baseRef: unknown;
  branch?: unknown;
  path: unknown;
  content: unknown;
  message: unknown;
}) {
  const repo = safeRepoName(input.repo);
  const baseRef = safeRef(input.baseRef);
  const path = safePath(input.path);
  const content = typeof input.content === "string" ? input.content : "";
  const message = typeof input.message === "string" ? input.message.trim().slice(0, 180) : "";

  if (Buffer.byteLength(content, "utf8") > MAX_EDITABLE_FILE_BYTES) {
    throw new ItAdminGuardError("development_file_too_large", "Source Code ใหญ่เกินขนาดที่ Phase 1 อนุญาต", 413);
  }
  if (!message) {
    throw new ItAdminGuardError("development_commit_message_required", "กรุณาระบุ Commit message", 422);
  }

  let branch = typeof input.branch === "string" ? input.branch.trim() : "";
  if (branch && !branch.startsWith(DEV_BRANCH_PREFIX)) {
    throw new ItAdminGuardError(
      "development_branch_write_blocked",
      "Phase 1 ไม่อนุญาตแก้ main หรือ Branch ภายนอกโดยตรง ต้องใช้ Branch ที่ระบบสร้างให้",
      403
    );
  }
  if (!branch) {
    branch = makeBranchName(path);
    await createBranch(repo, baseRef, branch);
  }

  const owner = githubOwner();
  const fileSha = await tryGetFileSha(repo, branch, path);
  const body: Record<string, unknown> = {
    message,
    content: Buffer.from(content, "utf8").toString("base64"),
    branch
  };
  if (fileSha) body.sha = fileSha;

  const payload = await githubJson<{
    content?: { sha?: string };
    commit?: { sha?: string; html_url?: string };
  }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeRepoPath(path)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    },
    true
  );

  return {
    repo,
    branch,
    path,
    commit_sha: payload.commit?.sha ?? null,
    commit_url: payload.commit?.html_url ?? null,
    content_sha: payload.content?.sha ?? null,
    created_file: !fileSha,
    content_digest: crypto.createHash("sha256").update(content).digest("hex")
  };
}

export async function createDevelopmentPullRequest(input: {
  repo: unknown;
  branch: unknown;
  baseRef: unknown;
  title: unknown;
  body?: unknown;
}) {
  const repo = safeRepoName(input.repo);
  const branch = safeRef(input.branch);
  const baseRef = safeRef(input.baseRef);
  if (!branch.startsWith(DEV_BRANCH_PREFIX)) {
    throw new ItAdminGuardError("development_pr_branch_blocked", "สร้าง PR ได้เฉพาะ Branch ที่ Development Center สร้าง", 403);
  }
  const title = typeof input.title === "string" ? input.title.trim().slice(0, 180) : "";
  if (!title) throw new ItAdminGuardError("development_pr_title_required", "กรุณาระบุชื่อ Pull Request", 422);
  const body = typeof input.body === "string" ? input.body.trim().slice(0, 5000) : "";
  const owner = githubOwner();

  const payload = await githubJson<{
    number?: number;
    html_url?: string;
    state?: string;
    head?: { ref?: string };
    base?: { ref?: string };
  }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, head: branch, base: baseRef })
    },
    true
  );

  return {
    repo,
    number: payload.number ?? null,
    url: payload.html_url ?? null,
    state: payload.state ?? null,
    branch,
    base_ref: baseRef
  };
}

export async function mergeDevelopmentPullRequest(input: { repo: unknown; number: unknown }) {
  const repo = safeRepoName(input.repo);
  const number = Number(input.number);
  if (!Number.isInteger(number) || number < 1) {
    throw new ItAdminGuardError("development_pr_number_invalid", "หมายเลข Pull Request ไม่ถูกต้อง", 422);
  }
  const owner = githubOwner();

  const pr = await githubJson<{ head?: { ref?: string }; base?: { ref?: string } }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}`
  );
  if (!pr.head?.ref?.startsWith(DEV_BRANCH_PREFIX)) {
    throw new ItAdminGuardError("development_pr_merge_blocked", "Merge ได้เฉพาะ PR ที่สร้างจาก Development Center", 403);
  }

  const payload = await githubJson<{ sha?: string; merged?: boolean; message?: string }>(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${number}/merge`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ merge_method: "squash" })
    },
    true
  );

  if (!payload.merged) {
    throw new ItAdminGuardError("development_pr_merge_failed", payload.message || "GitHub ไม่อนุญาตให้ Merge PR นี้", 409);
  }

  return { repo, number, merged: true, commit_sha: payload.sha ?? null, base_ref: pr.base?.ref ?? "main" };
}

export async function listVercelProjects() {
  if (!vercelToken()) return [];
  const teamId = vercelTeamId();
  const query = new URLSearchParams({ limit: "100" });
  if (teamId) query.set("teamId", teamId);
  const payload = await vercelJson<{ projects?: VercelProject[] }>(`/v9/projects?${query}`);
  return (payload.projects ?? []).map((project) => ({
    id: project.id ?? null,
    name: project.name ?? null,
    repo: project.link?.repo ?? null,
    org: project.link?.org ?? null,
    updated_at: project.updatedAt ? new Date(project.updatedAt).toISOString() : null
  }));
}

async function findVercelProject(repo: string) {
  const projects = await listVercelProjects();
  const owner = githubOwner().toLowerCase();
  return projects.find((project) =>
    String(project.repo ?? "").toLowerCase() === repo.toLowerCase() &&
    (!project.org || String(project.org).toLowerCase() === owner)
  ) ?? projects.find((project) => String(project.name ?? "").toLowerCase() === repo.toLowerCase()) ?? null;
}

export async function listVercelDeployments(repoInput: unknown) {
  const repo = safeRepoName(repoInput);
  const project = await findVercelProject(repo);
  if (!project?.id) return { project: null, deployments: [] };
  const teamId = vercelTeamId();
  const query = new URLSearchParams({ projectId: project.id, limit: "12" });
  if (teamId) query.set("teamId", teamId);
  const payload = await vercelJson<{
    deployments?: Array<{
      uid?: string;
      name?: string;
      url?: string;
      state?: string;
      readyState?: string;
      target?: string | null;
      created?: number;
      meta?: Record<string, unknown>;
    }>;
  }>(`/v6/deployments?${query}`);
  return {
    project,
    deployments: (payload.deployments ?? []).map((deployment) => ({
      id: deployment.uid ?? null,
      name: deployment.name ?? null,
      url: deployment.url ? `https://${deployment.url}` : null,
      state: deployment.readyState ?? deployment.state ?? null,
      target: deployment.target ?? "preview",
      created_at: deployment.created ? new Date(deployment.created).toISOString() : null,
      git_ref: typeof deployment.meta?.githubCommitRef === "string" ? deployment.meta.githubCommitRef : null,
      git_sha: typeof deployment.meta?.githubCommitSha === "string" ? deployment.meta.githubCommitSha : null
    }))
  };
}

export async function triggerVercelDeployment(input: {
  repo: unknown;
  ref: unknown;
  target: unknown;
}) {
  const repo = safeRepoName(input.repo);
  const ref = safeRef(input.ref);
  const target = input.target === "production" ? "production" : "preview";
  if (target === "production" && ref !== "main") {
    throw new ItAdminGuardError(
      "development_production_ref_blocked",
      "Production Deploy อนุญาตเฉพาะ main หลัง Merge แล้วเท่านั้น",
      409
    );
  }
  const project = await findVercelProject(repo);
  if (!project?.name) {
    throw new ItAdminGuardError("development_vercel_project_not_found", "ไม่พบ Vercel Project ที่เชื่อมกับ Repository นี้", 404);
  }
  const teamId = vercelTeamId();
  const query = new URLSearchParams();
  if (teamId) query.set("teamId", teamId);
  const owner = githubOwner();

  const payload = await vercelJson<{
    id?: string;
    url?: string;
    readyState?: string;
    status?: string;
  }>(
    `/v13/deployments${query.size ? `?${query}` : ""}`,
    {
      method: "POST",
      body: JSON.stringify({
        name: project.name,
        project: project.name,
        ...(target === "production" ? { target: "production" } : {}),
        gitSource: { type: "github", org: owner, repo, ref }
      })
    }
  );

  return {
    repo,
    ref,
    target,
    project,
    deployment_id: payload.id ?? null,
    url: payload.url ? `https://${payload.url}` : null,
    state: payload.readyState ?? payload.status ?? "QUEUED"
  };
}

export function isDevelopmentBranch(ref: string) {
  return ref.startsWith(DEV_BRANCH_PREFIX);
}
