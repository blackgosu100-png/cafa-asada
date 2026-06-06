const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const urls = `
https://cafe.naver.com/f-e/cafes/23611966/menus/4191
https://cafe.naver.com/f-e/cafes/23611966/menus/803
https://cafe.naver.com/f-e/cafes/23611966/menus/1416
https://cafe.naver.com/f-e/cafes/23611966/menus/3981
https://cafe.naver.com/f-e/cafes/23611966/menus/3161
https://cafe.naver.com/f-e/cafes/23611966/menus/2248
https://cafe.naver.com/f-e/cafes/23611966/menus/4025
https://cafe.naver.com/f-e/cafes/23611966/menus/1785
https://cafe.naver.com/f-e/cafes/23611966/menus/3840
https://cafe.naver.com/f-e/cafes/23611966/menus/3033
`.trim().split(/\s+/);

const outDir = path.join(__dirname, "data");
const jsonlPath = path.join(outDir, "naver_cafe_boards_20260528_fullcontent.jsonl");
const csvPath = path.join(outDir, "naver_cafe_boards_20260528_fullcontent.csv");
const reportPath = path.join(outDir, "naver_cafe_boards_20260528_fullcontent_report.json");

function parseCafeUrl(rawUrl) {
  const url = new URL(rawUrl);
  const match = url.pathname.match(/\/cafes\/(\d+)\/menus\/(\d+)/);
  if (!match) throw new Error(`Invalid URL: ${rawUrl}`);
  return { cafeId: match[1], menuId: match[2], referer: rawUrl };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function htmlToText(html) {
  return decodeHtml(String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|tr|section|article)\s*>/gi, "\n")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " "))
    .trim();
}

function imageUrlsFromHtml(html) {
  const source = String(html || "");
  const urls = new Set();
  const patterns = [
    /\b(?:src|data-src|data-lazy-src)=["']([^"']+)["']/gi,
    /https?:\\\/\\\/[^"'\\\s]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^"'\\\s]*)?/gi,
    /https?:\/\/[^"'\s<>]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^"'\s<>]*)?/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) {
      const raw = match[1] || match[0];
      const url = decodeHtml(raw.replace(/\\\//g, "/")).trim();
      if (/^https?:\/\//.test(url)) urls.add(url);
    }
  }
  return [...urls];
}

function formatDate(timestamp) {
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}.`;
}

function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("\n") : String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function fetchJson(url, referer) {
  const response = await fetch(url, {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
      "Referer": referer,
      "Origin": "https://cafe.naver.com"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

async function fetchListPage(meta, page) {
  const apiUrl = `https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/${meta.cafeId}/menus/${meta.menuId}/articles?page=${page}`;
  const json = await fetchJson(apiUrl, meta.referer);
  const list = (json.result?.articleList || []).filter((entry) => entry?.type === "ARTICLE" && entry?.item?.subject);
  return { list, pageInfo: json.result?.pageInfo || {} };
}

async function fetchDetail(meta, articleId) {
  const articleUrl = `https://cafe.naver.com/f-e/cafes/${meta.cafeId}/articles/${articleId}`;
  const apiUrl = `https://apis.naver.com/cafe-web/cafe-articleapi/v3/cafes/${meta.cafeId}/articles/${articleId}`;
  const json = await fetchJson(apiUrl, articleUrl);
  const article = json.result?.article || json.article || {};
  const html = article.contentHtml || article.content || "";
  return {
    content: htmlToText(html),
    imageUrls: imageUrlsFromHtml(html)
  };
}

async function readDoneIds() {
  const done = new Set();
  if (!fs.existsSync(jsonlPath)) return done;
  const text = await fsp.readFile(jsonlPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.articleId) done.add(String(row.articleId));
    } catch {}
  }
  return done;
}

async function appendRow(row) {
  await fsp.appendFile(jsonlPath, `${JSON.stringify(row)}\n`, "utf8");
}

async function buildCsv() {
  if (!fs.existsSync(jsonlPath)) return;
  const lines = (await fsp.readFile(jsonlPath, "utf8")).split(/\r?\n/).filter(Boolean);
  const rows = lines.map((line) => JSON.parse(line)).sort((a, b) => (b.views || 0) - (a.views || 0));
  const headers = ["menuId", "page", "articleId", "title", "comments", "date", "views", "likes", "writer", "summary", "content", "imageUrls", "link", "detailError"];
  const csv = "\ufeff" + [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\r\n");
  await fsp.writeFile(csvPath, csv, "utf8");
}

async function main() {
  await fsp.mkdir(outDir, { recursive: true });
  const doneIds = await readDoneIds();
  const report = [];

  for (const rawUrl of urls) {
    const meta = parseCafeUrl(rawUrl);
    let page = 1;
    let articles = 0;
    while (page <= 500) {
      const { list, pageInfo } = await fetchListPage(meta, page);
      if (!list.length) break;

      for (const entry of list) {
        const article = entry.item;
        if (doneIds.has(String(article.articleId))) continue;

        const row = {
          menuId: meta.menuId,
          page,
          articleId: article.articleId,
          title: article.subject || "",
          comments: article.commentCount || 0,
          date: formatDate(article.writeDateTimestamp),
          views: article.readCount || 0,
          likes: article.likeCount || 0,
          writer: article.writerInfo?.nickName || "",
          summary: (article.summary || "").replace(/\s+/g, " ").trim(),
          content: "",
          imageUrls: [],
          link: `https://cafe.naver.com/f-e/cafes/${meta.cafeId}/articles/${article.articleId}`
        };

        try {
          const detail = await fetchDetail(meta, article.articleId);
          row.content = detail.content;
          row.imageUrls = detail.imageUrls;
        } catch (error) {
          row.detailError = error.message || String(error);
        }

        await appendRow(row);
        doneIds.add(String(article.articleId));
        articles += 1;
        await sleep(60);
      }

      console.log(`[${meta.menuId}] page ${page} saved, new=${articles}, totalSaved=${doneIds.size}`);
      await buildCsv();

      const lastNav = Number(pageInfo.lastNavigationPageNumber || page);
      if (page >= lastNav && pageInfo.visibleNextButton !== true) break;
      page += 1;
      await sleep(100);
    }
    report.push({ menuId: meta.menuId, pages: page, newArticles: articles });
    await fsp.writeFile(reportPath, JSON.stringify({ updatedAt: new Date().toISOString(), report }, null, 2), "utf8");
    await sleep(250);
  }

  await buildCsv();
  console.log(`DONE CSV=${csvPath}`);
  console.log(`DONE JSONL=${jsonlPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
