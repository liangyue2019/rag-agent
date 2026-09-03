import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFile } from "./parsers.js";

const fixture = (f: string) =>
  readFileSync(join(import.meta.dirname, "../../tests/fixtures", f));

describe("parseFile", () => {
  it("解析 txt", async () => {
    const text = await parseFile(fixture("sample.txt"), "text/plain");
    expect(text).toContain("签收后七天");
  });
  it("解析 md", async () => {
    const text = await parseFile(fixture("sample.md"), "text/markdown");
    expect(text).toContain("7 天无理由退货");
  });
  it("拒绝非法 MIME", async () => {
    await expect(parseFile(Buffer.from("x"), "application/zip")).rejects.toThrow("不支持的文件类型");
  });
});
