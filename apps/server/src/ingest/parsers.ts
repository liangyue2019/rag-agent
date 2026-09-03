import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";
import * as cheerio from "cheerio";

export const ALLOWED_MIME = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/markdown",
] as const;
export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB
const URL_TIMEOUT_MS = 15_000;
const URL_MAX_BYTES = 5 * 1024 * 1024; // 5MB

/** 解析上传文件为纯文本 */
export async function parseFile(buffer: Buffer, mime: string): Promise<string> {
  if (!ALLOWED_MIME.includes(mime as (typeof ALLOWED_MIME)[number])) {
    throw new Error(`不支持的文件类型: ${mime}`);
  }
  if (mime === "application/pdf") {
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  if (mime.includes("wordprocessingml")) {
    const { value } = await mammoth.extractRawText({ buffer });
    return value;
  }
  return buffer.toString("utf-8"); // txt / md
}

/** 抓取网页并清洗为正文文本（去 script/style/nav/aside/模板文字） */
export async function parseUrl(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(URL_TIMEOUT_MS),
    headers: { "user-agent": "rag-agent/0.1 (+knowledge-import)" },
  });
  if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`);
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/html")) throw new Error(`仅支持 HTML，实际 ${ct || "未知"}`);
  const html = await res.text();
  if (Buffer.byteLength(html, "utf8") > URL_MAX_BYTES) {
    throw new Error(`页面过大，超过 ${URL_MAX_BYTES / 1024 / 1024}MB`);
  }
  const $ = cheerio.load(html);
  $("script, style, nav, aside, footer, header, noscript, iframe").remove();
  return $("body").text().replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
