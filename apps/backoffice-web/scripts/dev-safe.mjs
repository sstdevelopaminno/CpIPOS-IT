import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const WINDOWS_SYSTEM32 = `${process.env.SystemRoot ?? "C:\\Windows"}\\System32`;
const WINDOWS_CMD = process.env.ComSpec ?? `${WINDOWS_SYSTEM32}\\cmd.exe`;
const WINDOWS_NETSTAT = `${WINDOWS_SYSTEM32}\\netstat.exe`;
const WINDOWS_TASKKILL = `${WINDOWS_SYSTEM32}\\taskkill.exe`;

function stripOptionalQuotes(value) {
  const trimmed = String(value ?? "").trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function loadLocalEnvFile() {
  const envPath = ".env.local";
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) continue;
    const name = trimmed.slice(0, separatorIndex).trim();
    if (!name || process.env[name] != null) continue;
    process.env[name] = stripOptionalQuotes(trimmed.slice(separatorIndex + 1));
  }
}

loadLocalEnvFile();

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function readPort() {
  const raw = String(process.env.PORT ?? "3000").trim();
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return 3000;
  return parsed;
}

function listListeningPidsOnWindows(port) {
  try {
    const output = execSync(`"${WINDOWS_NETSTAT}" -ano -p tcp`, { encoding: "utf8" });
    const pids = new Set();
    for (const line of output.split(/\r?\n/)) {
      if (!line.includes("LISTENING")) continue;
      if (!line.includes(`:${port}`)) continue;
      const parts = line.trim().split(/\s+/);
      const pid = Number(parts[parts.length - 1]);
      if (Number.isInteger(pid) && pid > 0) pids.add(pid);
    }
    return [...pids];
  } catch {
    return [];
  }
}

function listListeningPidsOnUnix(port) {
  try {
    const output = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: "utf8" });
    return output
      .split(/\r?\n/)
      .map((row) => Number(row.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0);
  } catch {
    return [];
  }
}

function killPid(pid) {
  try {
    if (process.platform === "win32") {
      execSync(`"${WINDOWS_TASKKILL}" /T /F /PID ${pid}`, { stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
    return true;
  } catch {
    try {
      process.kill(pid, "SIGTERM");
      return true;
    } catch {
      try {
        if (process.platform === "win32") {
          execSync(`powershell.exe -NoProfile -Command "Stop-Process -Id ${pid} -Force"`, { stdio: "ignore" });
          return true;
        }
      } catch {
        return false;
      }
      return false;
    }
  }
}

function clearPortIfBusy(port) {
  const pids =
    process.platform === "win32"
      ? listListeningPidsOnWindows(port)
      : listListeningPidsOnUnix(port);

  const uniquePids = [...new Set(pids)].filter((pid) => pid !== process.pid);
  if (uniquePids.length === 0) return { occupied: false, remainingPids: [] };

  console.log(`[dev-safe] Port ${port} is busy. Cleaning ${uniquePids.length} process(es): ${uniquePids.join(", ")}`);
  for (const pid of uniquePids) {
    const killed = killPid(pid);
    console.log(`[dev-safe] ${killed ? "Killed" : "Failed to kill"} PID ${pid}`);
  }

  let remainingPids = [];
  for (let attempt = 0; attempt < 10; attempt += 1) {
    remainingPids =
      process.platform === "win32"
        ? listListeningPidsOnWindows(port).filter((pid) => pid !== process.pid)
        : listListeningPidsOnUnix(port).filter((pid) => pid !== process.pid);

    if (remainingPids.length === 0) break;
    sleep(250);
  }

  return { occupied: true, remainingPids };
}

const port = readPort();
const portResult = clearPortIfBusy(port);

if (portResult?.remainingPids?.length) {
  console.log(
    `[dev-safe] Port ${port} is already serving from PID(s): ${portResult.remainingPids.join(", ")}. Reusing existing server.`
  );
  process.exit(0);
}

function resolveDevBundlerArgs() {
  const defaultBundler = "webpack";
  const bundler = String(process.env.NEXT_DEV_BUNDLER ?? defaultBundler).trim().toLowerCase();
  if (bundler === "webpack") return ["--webpack"];
  if (bundler === "turbo" || bundler === "turbopack") return ["--turbo"];
  if (bundler === "none" || bundler === "default") return [];
  return ["--webpack"];
}

const nextArgs = ["dev", "-p", String(port), ...resolveDevBundlerArgs()];
const nextBin = process.platform === "win32" ? "node_modules\\.bin\\next.cmd" : "node_modules/.bin/next";
const childEnv = process.env;
const child =
  process.platform === "win32"
    ? spawn(WINDOWS_CMD, ["/c", nextBin, ...nextArgs], {
        stdio: "inherit",
        shell: false,
        env: childEnv
      })
    : spawn(nextBin, nextArgs, {
        stdio: "inherit",
        shell: false,
        env: childEnv
      });

async function warmDevRoute(port, route, init = {}) {
  const url = `http://127.0.0.1:${port}${route}`;
  const startedAt = Date.now();
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    cache: "no-store"
  });
  console.log(`[dev-safe] Warmed ${init.method ?? "GET"} ${route} -> ${response.status} in ${Date.now() - startedAt}ms`);
}

async function warmDevRoutes(port) {
  const enabled = String(process.env.NEXT_DEV_WARM_LOGIN_ROUTES ?? "true").trim().toLowerCase();
  if (enabled === "0" || enabled === "false" || enabled === "no") return;

  const routes = [
    ["/login/store"],
    ["/login/branches?flow=multi"],
    ["/login/employee?flow=multi"],
    ["/login/devices"],
    ["/manifest.webmanifest"],
    ["/api/auth/store-code/verify", { method: "DELETE" }]
  ];

  let ready = false;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`, { cache: "no-store" });
      if (response.status < 500) {
        ready = true;
        break;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!ready) return;

  for (const [route, init] of routes) {
    try {
      await warmDevRoute(port, route, init);
    } catch (error) {
      console.warn(`[dev-safe] Warm failed for ${route}`, {
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  const warmStoreCode = String(process.env.NEXT_DEV_WARM_STORE_CODE ?? "").trim().toUpperCase();
  if (warmStoreCode) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await warmDevRoute(port, "/api/auth/store-code/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ store_code: warmStoreCode })
        });
      } catch (error) {
        console.warn("[dev-safe] Store code cache warm failed", {
          attempt,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }
  }
}

setTimeout(() => {
  void warmDevRoutes(port);
}, 1000);

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
