import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/components/layout/app-shell.module.css"), "utf8");

describe("IT topbar long menu names", () => {
  it("wraps long menu headings instead of hiding them with ellipsis", () => {
    const match = css.match(/\.headingBlock h1 \{([^}]*)\}/);
    expect(match).not.toBeNull();
    expect(match![1]).toContain("white-space: normal");
    expect(match![1]).toContain("overflow-wrap: anywhere");
    expect(match![1]).not.toContain("text-overflow: ellipsis");
    expect(match![1]).not.toContain("overflow: hidden");
  });

  it("stacks title and toolbar on mobile while preserving navigation", () => {
    expect(css).toContain("flex: 1 1 100%");
    expect(css).toContain("flex-wrap: wrap");
    expect(css).toContain("margin-left: auto");
    expect(css).toContain("max-width: 100%");
  });
});
