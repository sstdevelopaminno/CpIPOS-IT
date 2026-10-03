import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const src = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("maintenance compact control-center layout", () => {
  const maintenance = src("src/components/it-admin/it-maintenance-console.tsx");
  const emailTable = src("src/components/it-admin/daily-sales-email-operations.tsx");

  it("removes the duplicated maintenance hero from the page body", () => {
    expect(maintenance).not.toContain("SYSTEM MAINTENANCE");
    expect(maintenance).not.toContain("{t.eyebrow}");
    expect(maintenance).not.toContain("{t.title}");
    expect(maintenance).not.toContain("{t.desc}");
  });

  it("moves maintenance detail sections behind top popup buttons", () => {
    expect(maintenance).toContain('type ModalKey = "overview" | "operational" | "sales" | "packages" | "history" | null');
    expect(maintenance).toContain('["overview", t.overview]');
    expect(maintenance).toContain('["operational", t.operational]');
    expect(maintenance).toContain('["sales", t.sales]');
    expect(maintenance).toContain('["packages", t.packages]');
    expect(maintenance).toContain('["history", t.history]');
    expect(maintenance).toContain("setModal(key)");
    expect(maintenance).toContain('className="fixed inset-0 z-[110]');
  });

  it("keeps the daily sales email store table as the main workspace", () => {
    expect(maintenance).toContain("<DailySalesEmailOperations language={language} />");
    expect(emailTable).not.toContain("{t.eyebrow}");
    expect(emailTable).not.toContain("{t.title}");
    expect(emailTable).not.toContain("{t.desc}");
    expect(emailTable).toContain("<table");
    expect(emailTable).toContain("setPreviewStore(row)");
  });

  it("paginates the store table ten rows at a time with numbered pages", () => {
    expect(emailTable).toContain("const PAGE_SIZE = 10");
    expect(emailTable).toContain("Math.ceil(filteredRows.length / PAGE_SIZE)");
    expect(emailTable).toContain("filteredRows.slice(start, start + PAGE_SIZE)");
    expect(emailTable).toContain("pageItems.map");
    expect(emailTable).toContain("setPage(item)");
    expect(emailTable).toContain("t.previous");
    expect(emailTable).toContain("t.next");
  });

  it("folds summary counts into filters instead of large statistic cards", () => {
    expect(emailTable).toContain("stats?.total_stores");
    expect(emailTable).toContain("stats?.enabled");
    expect(emailTable).toContain("stats?.disabled");
    expect(emailTable).toContain("stats?.needs_attention");
    expect(emailTable).not.toContain("xl:grid-cols-5");
  });
});
