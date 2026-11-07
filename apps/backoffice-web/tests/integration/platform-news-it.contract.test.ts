import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("IT-managed announcement publication contract", () => {
  it("exposes a main news navigation entry for both IT roles", () => {
    const nav = read("src/app/(it-admin)/layout.tsx");
    expect(nav.split('href: "/it-admin/news"').length - 1).toBe(2);
    expect(nav).toContain('news: "แจ้งข่าวสาร"');
    expect(nav).toContain('news: "Announcements"');
  });

  it("validates IT identity for list, create, edit, archive and image upload", () => {
    for (const path of [
      "src/app/api/it-admin/v1/news/route.ts",
      "src/app/api/it-admin/v1/news/[newsId]/route.ts",
      "src/app/api/it-admin/v1/news/image/route.ts"
    ]) {
      expect(read(path)).toContain("requireItAdmin()");
    }
    const validation = read("src/lib/platform-news-admin.ts");
    expect(validation).toContain("validateNewsEditor");
    expect(validation).toContain('url.protocol !== "https:"');
    expect(validation).toContain('target_tenant_not_found');
    expect(validation).toContain('storage.from("platform-news")');
  });

  it("publishes only explicitly published news and archives deleted posts", () => {
    const create = read("src/app/api/it-admin/v1/news/route.ts");
    const modify = read("src/app/api/it-admin/v1/news/[newsId]/route.ts");
    expect(create).toContain('editor.status === "published" ? now : null');
    expect(modify).toContain('status: "archived"');
    expect(modify).toContain("platform_news_updated");
    expect(modify).toContain("platform_news_archived");
  });

  it("uploads only validated bounded images through a server-side bucket", () => {
    const upload = read("src/app/api/it-admin/v1/news/image/route.ts");
    expect(upload).toContain("MAX_IMAGE_BYTES = 2 * 1024 * 1024");
    expect(upload).toContain("safeExtension(file.type, bytes)");
    expect(upload).toContain('storage.from("platform-news").upload');
  });

  it("renders list, popup form with spinner, details, editor and delete actions", () => {
    const ui = read("src/components/it-admin/platform-news-console.tsx");
    expect(ui).toContain("ItPlatformNewsConsole");
    expect(ui).toContain("ItPlatformNewsDetail");
    expect(ui).toContain("+ เพิ่มรายการ");
    expect(ui).toContain("animate-spin");
    expect(ui).toContain("onSaved");
    expect(ui).toContain('method: "DELETE"');
  });
});
