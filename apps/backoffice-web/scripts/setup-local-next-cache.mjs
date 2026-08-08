import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function canWriteToDirectory(directory) {
  const probePath = join(directory, `.next-cache-write-test-${process.pid}`);
  try {
    mkdirSync(directory, { recursive: true });
    writeFileSync(probePath, "ok");
    unlinkSync(probePath);
    return true;
  } catch (error) {
    console.warn(`[dev-safe] Next.js cache is not writable at ${directory}: ${error.message}`);
    return false;
  }
}

export function setupLocalNextCache() {
  if (process.platform !== "win32") return null;

  const projectDir = resolve(import.meta.dirname, "..");
  const linkPath = join(projectDir, ".next-local");
  const localBase = String(process.env.LOCALAPPDATA ?? process.env.TEMP ?? "").trim();
  if (!localBase) return null;

  const targetPath = resolve(
    process.env.NEXT_LOCAL_CACHE_TARGET ?? join(localBase, "pos-platform-cache", "backoffice-web", ".next")
  );
  if (!canWriteToDirectory(targetPath)) return null;

  if (existsSync(linkPath)) {
    const stat = lstatSync(linkPath);
    if (!stat.isSymbolicLink()) {
      console.warn(`[dev-safe] ${linkPath} is not a junction. Using the regular project cache.`);
      return null;
    }
    const currentTarget = resolve(projectDir, readlinkSync(linkPath));
    if (currentTarget !== targetPath) {
      console.warn(`[dev-safe] Reusing cache junction target: ${currentTarget}`);
    }
    if (!existsSync(currentTarget) || !canWriteToDirectory(currentTarget)) return null;
    return ".next-local";
  }

  symlinkSync(targetPath, linkPath, "junction");
  console.log(`[dev-safe] Local Next.js cache: ${linkPath} -> ${targetPath}`);
  return ".next-local";
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const distDir = setupLocalNextCache();
  console.log(distDir ? `[dev-safe] NEXT_DIST_DIR=${distDir}` : "[dev-safe] Local cache was not configured.");
}
