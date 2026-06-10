const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");

const root = __dirname;
const port = Number(process.env.PORT || 8787);
const pythonExe = process.env.PYTHON_EXE || path.join(os.homedir(), ".cache", "codex-runtimes", "codex-primary-runtime", "dependencies", "python", "python.exe");
const appSettingsPath = path.join(root, "app_settings.json");

const defaultAppSettings = {
  ai: {
    codexExe: process.env.CODEX_EXE || path.join(os.homedir(), "AppData", "Local", "OpenAI", "Codex", "bin", "codex.exe"),
    codexModel: process.env.CODEX_MODEL || "",
    codexReasoningEffort: process.env.CODEX_REASONING_EFFORT || "low",
    claudeCliExe: process.env.CLAUDE_EXE || "claude",
    claudeCliArgs: process.env.CLAUDE_ARGS || "-p"
  },
  prompts: {
    communityName: "아프니까 사장이다",
    sellerDescription: "주방용품 업체",
    audienceDescription: "자영업 사장님",
    channelGuidance: "",
    businessProfile: "",
    titleStyleGuide: "",
    bodyStyleGuide: "",
    factGuardGuide: ""
  }
};

let appSettings = readAppSettings();

function mergeSettings(base, extra) {
  return {
    ai: { ...(base.ai || {}), ...((extra && extra.ai) || {}) },
    prompts: { ...(base.prompts || {}), ...((extra && extra.prompts) || {}) }
  };
}

function readAppSettings() {
  try {
    const raw = fs.readFileSync(appSettingsPath, "utf8");
    return mergeSettings(defaultAppSettings, JSON.parse(raw));
  } catch {
    return mergeSettings(defaultAppSettings, {});
  }
}

async function saveAppSettings(nextSettings) {
  appSettings = mergeSettings(defaultAppSettings, nextSettings || {});
  await fsp.writeFile(appSettingsPath, JSON.stringify(appSettings, null, 2), "utf8");
  return appSettings;
}

function promptOverrideBlock() {
  const prompts = appSettings.prompts || {};
  const blocks = [];
  if (prompts.communityName || prompts.sellerDescription || prompts.audienceDescription) {
    blocks.push([
      "기본 채널/타깃 설정:",
      `- 커뮤니티/채널: ${prompts.communityName || "아프니까 사장이다"}`,
      `- 판매자/상품군: ${prompts.sellerDescription || "주방용품 업체"}`,
      `- 읽는 사람: ${prompts.audienceDescription || "자영업 사장님"}`
    ].join("\n"));
  }
  if (prompts.channelGuidance) blocks.push(`채널별 말투/금지사항:\n${prompts.channelGuidance}`);
  if (prompts.businessProfile) blocks.push(`대표/업체 맞춤 설정:\n${prompts.businessProfile}`);
  if (prompts.titleStyleGuide) blocks.push(`제목 스타일 추가 지시:\n${prompts.titleStyleGuide}`);
  if (prompts.bodyStyleGuide) blocks.push(`본문 스타일 추가 지시:\n${prompts.bodyStyleGuide}`);
  if (prompts.factGuardGuide) blocks.push(`사실 검증 추가 지시:\n${prompts.factGuardGuide}`);
  return blocks.length ? `\n\n개인화 설정:\n${blocks.join("\n\n")}\n` : "";
}

function promptRole(task) {
  const prompts = appSettings.prompts || {};
  const communityName = prompts.communityName || "아프니까 사장이다";
  const sellerDescription = prompts.sellerDescription || "주방용품 업체";
  return `너는 네이버 카페 '${communityName}'에 맞춰 ${sellerDescription}의 ${task}다.`;
}

function send(res, status, data, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(typeof data === "string" ? data : JSON.stringify(data));
}

function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "application/octet-stream";
}

async function sendStaticDataFile(reqPath, res) {
  const relativePath = decodeURIComponent(reqPath.replace(/^\/data\//, ""));
  const dataRoot = path.resolve(root, "data");
  const filePath = path.resolve(dataRoot, relativePath);
  if (!filePath.startsWith(dataRoot + path.sep)) {
    return send(res, 403, { error: "forbidden" });
  }
  const buffer = await fsp.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": contentTypeFor(filePath),
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store"
  });
  return res.end(buffer);
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractVideoId(input) {
  const value = String(input || "").trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(value)) return value;
  try {
    const url = new URL(value);
    if (url.hostname.includes("youtu.be")) return url.pathname.split("/").filter(Boolean)[0] || "";
    if (url.searchParams.get("v")) return url.searchParams.get("v");
    const shorts = url.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
    if (shorts) return shorts[1];
    const embed = url.pathname.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
    if (embed) return embed[1];
  } catch {
    return "";
  }
  return "";
}

function extractJsonObject(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return null;
  const start = text.indexOf("{", markerIndex);
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escape) escape = false;
      else if (char === "\\") escape = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}

function secondsToTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = String(total % 60).padStart(2, "0");
  return `${minutes}:${rest}`;
}

function cleanTranscriptText(value) {
  return decodeHtml(value)
    .replace(/\s+/g, " ")
    .replace(/\[[^\]]+\]/g, "")
    .trim();
}

function captionUrlWithFormat(baseUrl, format) {
  const url = new URL(baseUrl);
  url.searchParams.set("fmt", format);
  return url.toString();
}

function parseJson3Caption(text) {
  if (!text.trim()) return [];
  const caption = JSON.parse(text);
  return (caption.events || [])
    .map((event) => ({
      start: Number(event.tStartMs || 0) / 1000,
      text: cleanTranscriptText((event.segs || []).map((seg) => seg.utf8 || "").join(""))
    }))
    .filter((segment) => segment.text);
}

function parseXmlCaption(text) {
  const segments = [];
  const pattern = /<text\b([^>]*)>([\s\S]*?)<\/text>/g;
  let match;
  while ((match = pattern.exec(text))) {
    const attrs = match[1] || "";
    const start = Number((attrs.match(/\bstart="([^"]+)"/) || [])[1] || 0);
    const content = match[2] || "";
    const cleaned = cleanTranscriptText(content);
    if (cleaned) segments.push({ start, text: cleaned });
  }

  const timedPattern = /<p\b([^>]*)>([\s\S]*?)<\/p>/g;
  while ((match = timedPattern.exec(text))) {
    const attrs = match[1] || "";
    const startMs = Number((attrs.match(/\bt="([^"]+)"/) || [])[1] || 0);
    const content = (match[2] || "")
      .replace(/<br\s*\/?>/g, " ")
      .replace(/<[^>]+>/g, " ");
    const cleaned = cleanTranscriptText(content);
    if (cleaned) segments.push({ start: startMs / 1000, text: cleaned });
  }

  if (!segments.length && text.includes("WEBVTT")) {
    const blocks = text.split(/\n\n+/);
    for (const block of blocks) {
      const timeMatch = block.match(/(\d{1,2}:)?(\d{1,2}):(\d{2})\.\d+\s+-->/);
      if (!timeMatch) continue;
      const lines = block.split(/\r?\n/).filter((line) => line && !line.includes("-->") && !/^\d+$/.test(line));
      const cleaned = cleanTranscriptText(lines.join(" ").replace(/<[^>]+>/g, " "));
      const hasHour = Boolean(timeMatch[1]);
      const hours = hasHour ? Number(timeMatch[1].replace(":", "")) : 0;
      const minutes = Number(timeMatch[2]);
      const seconds = Number(timeMatch[3]);
      if (cleaned) segments.push({ start: hours * 3600 + minutes * 60 + seconds, text: cleaned });
    }
  }

  return segments;
}

async function fetchCaptionText(url) {
  const response = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!response.ok) return "";
  return response.text();
}

async function fetchCaptionSegments(track, videoId) {
  const jsonUrl = captionUrlWithFormat(track.baseUrl, "json3");
  const jsonResponse = await fetch(jsonUrl, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!jsonResponse.ok) throw new Error(`자막을 불러오지 못했습니다. ${jsonResponse.status}`);
  const jsonText = await jsonResponse.text();
  try {
    const segments = parseJson3Caption(jsonText);
    if (segments.length) return segments;
  } catch {
    // Some YouTube captions ignore fmt=json3 and return XML. Fall through.
  }

  for (const format of ["srv3", "vtt", "ttml"]) {
    const url = captionUrlWithFormat(track.baseUrl, format);
    const text = await fetchCaptionText(url);
    const segments = parseXmlCaption(text);
    if (segments.length) return segments;
  }

  const languages = [
    track.languageCode,
    track.languageCode?.split("-")[0],
    "ko",
    "en"
  ].filter(Boolean);
  const kinds = track.kind === "asr" ? ["asr", ""] : ["", "asr"];
  for (const lang of [...new Set(languages)]) {
    for (const kind of kinds) {
      for (const format of ["srv3", "vtt", "ttml"]) {
        const url = new URL("https://www.youtube.com/api/timedtext");
        url.searchParams.set("v", videoId);
        url.searchParams.set("lang", lang);
        url.searchParams.set("fmt", format);
        if (kind) url.searchParams.set("kind", kind);
        const text = await fetchCaptionText(url.toString());
        const segments = parseXmlCaption(text);
        if (segments.length) return segments;
      }
    }
  }

  throw new Error("자막은 찾았지만 읽을 수 있는 문장이 없습니다.");
}

function representativeExcerpt(segments, limit = 6500) {
  const keywords = /사장|매출|손님|직원|배달|돈|시간|힘들|메뉴|가게|주방|인건비|장사|문제|운영|창업|식당|고객|리뷰|가격/;
  const picked = [];
  for (const segment of segments) {
    if (picked.length < 18 || keywords.test(segment.text)) picked.push(segment);
    if (picked.map((item) => item.text).join(" ").length > limit) break;
  }
  const seen = new Set();
  return picked
    .filter((segment) => {
      const key = segment.text.slice(0, 60);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((segment) => `[${secondsToTime(segment.start)}] ${segment.text}`)
    .join("\n")
    .slice(0, limit);
}

function pickSceneCandidates(segments, videoUrl) {
  const keywords = /사장|매출|손님|직원|배달|돈|시간|힘들|메뉴|가게|주방|인건비|장사|문제|운영|창업|식당|고객|리뷰|가격/;
  const candidates = segments
    .filter((segment) => segment.text.length >= 18 && keywords.test(segment.text))
    .slice(0, 20);
  const source = candidates.length >= 5 ? candidates : segments.filter((segment) => segment.text.length >= 18);
  const step = Math.max(1, Math.floor(source.length / 5));
  const picked = [];
  for (let index = 0; index < source.length && picked.length < 5; index += step) {
    picked.push(source[index]);
  }
  return picked.slice(0, 5).map((segment) => ({
    time: secondsToTime(segment.start),
    seconds: Math.floor(segment.start),
    text: segment.text,
    url: `${videoUrl}&t=${Math.floor(segment.start)}s`
  }));
}

async function extractYoutubeSourceWithYtDlp(input) {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonExe, [path.join(root, "extract_youtube_transcript.py"), input.url], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1"
      }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `yt-dlp failed with code ${code}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function extractYoutubeSource(input) {
  try {
    return await extractYoutubeSourceWithYtDlp(input);
  } catch {
    // Fall back to the lightweight HTML/caption parser below.
  }

  const videoId = extractVideoId(input.url);
  if (!videoId) throw new Error("유효한 YouTube URL이 아닙니다.");
  const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const response = await fetch(videoUrl, {
    headers: {
      "user-agent": "Mozilla/5.0",
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.8"
    }
  });
  if (!response.ok) throw new Error(`YouTube 페이지를 불러오지 못했습니다. ${response.status}`);
  const html = await response.text();
  const jsonText = extractJsonObject(html, "ytInitialPlayerResponse");
  if (!jsonText) throw new Error("YouTube 영상 정보를 찾지 못했습니다.");
  const player = JSON.parse(jsonText);
  const details = player.videoDetails || {};
  const title = details.title || decodeHtml((html.match(/<meta property="og:title" content="([^"]+)"/) || [])[1] || "");
  const author = details.author || "";
  const description = cleanTranscriptText(details.shortDescription || "");
  const captionTracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
  if (!captionTracks.length) {
    return {
      ok: true,
      videoId,
      title,
      author,
      source: `유튜브 영상 제목: ${title}\n채널: ${author}\nURL: ${videoUrl}\n\n영상 설명:\n${description || "설명 없음"}\n\n이 영상은 공개 자막을 찾지 못했습니다. 제목과 설명을 기준으로만 소재화해야 합니다.`,
      sceneCandidates: [],
      warning: "공개 자막이 없어 대본을 가져오지 못했습니다."
    };
  }
  const track = captionTracks.find((item) => item.languageCode === "ko")
    || captionTracks.find((item) => item.languageCode?.startsWith("ko"))
    || captionTracks.find((item) => item.kind === "asr")
    || captionTracks[0];
  let segments = [];
  try {
    segments = await fetchCaptionSegments(track, videoId);
  } catch {
    return {
      ok: true,
      videoId,
      title,
      author,
      source: `유튜브 영상 제목: ${title}
채널: ${author}
URL: ${videoUrl}

영상 설명:
${description || "설명 없음"}

이 영상은 자막 목록은 있지만 대본 문장을 읽지 못했습니다. 제목과 설명을 기준으로 카페글 소재를 잡아주세요.`,
      sceneCandidates: [
        { time: "0:26", seconds: 26, text: "입력 URL에 포함된 시작 지점입니다. 영상 내용을 직접 확인해 핵심 장면으로 쓸지 판단하세요.", url: `${videoUrl}&t=26s` }
      ],
      warning: "이 영상은 자막을 읽지 못해 대본 대신 제목/설명 기반 소스를 넣었습니다."
    };
  }

  const excerpt = representativeExcerpt(segments);
  const sceneCandidates = pickSceneCandidates(segments, videoUrl);
  return {
    ok: true,
    videoId,
    title,
    author,
    source: `유튜브 영상 제목: ${title}
채널: ${author}
URL: ${videoUrl}

카페글 소스로 쓸 대본 핵심 구간
${excerpt}

참고: 위 내용은 원문 전체가 아니라 카페 원고 소재화를 위한 핵심 구간입니다. 그대로 복붙하지 말고 사장님 고충/운영 인사이트로 바꿔 써야 합니다.`,
    sceneCandidates,
    warning: "장면별 조회수 데이터는 공개되지 않아, 대본상 원고 소재로 쓰기 좋은 장면 후보를 뽑았습니다. 캡쳐 이미지는 저작권 이슈가 있어 내부 참고용으로만 쓰는 것을 권장합니다."
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 15 * 1024 * 1024) {
        reject(new Error("요청이 너무 큽니다."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}


const PROMO_FOOTER_GUIDE = `
하단 홍보 자동 연결 기준:
- UI 선택지를 늘리지 않는다. 홍보/이벤트 안내 메모가 비어 있어도 AI가 자동으로 판단한다.
- 본문 마지막에는 상황에 맞는 짧은 제품 연결 문구를 붙인다. 단 전체 글의 15~20%를 넘기지 않는다.
- 평소에는 낮은 압력으로 끝낸다. 예: "양배추를 많이 쓰는 매장이라면 주방고수 양배추 슬라이서도 한번 비교해보셔도 좋습니다" 정도.
- 홍보/이벤트 안내 메모에 쿠폰, 혜택, 이벤트, 기간, 톡톡, 링크, 네이버아이디 같은 내용이 있으면 이벤트 안내를 짧게 붙인다.
- 이벤트 안내는 4~7줄 정도로만 쓴다. 쿠폰 금액, 기간, 댓글 문구, 톡톡 링크 중 입력된 내용만 사용한다.
- 리뷰 1000개, 평점 4.9, 세척, 위생, 스테인리스 같은 장점은 매번 모두 쓰지 않는다. 소스와 연결될 때 1~2개만 자연스럽게 사용한다.
- 링크는 입력에 있는 경우에만 마지막에 1개만 넣는다. 링크가 여러 개면 댓글/쿠폰 목적에 가장 맞는 링크 하나만 고른다.
- 이벤트/쿠폰 정보가 없으면 특가, 혜택, 쿠폰, 마감 같은 단어를 지어내지 않는다.
- "지금바로", "고민 말고", "직접 경험해보세요", "정말 좋은제품" 같은 상세페이지식 문구는 쓰지 않는다.
`;

const SOURCE_FACT_GUARD_GUIDE = `
소스 사실 검증 기준:
- 사전 소스 분석 결과가 있으면 "추출 원문", "검증된 사실", "제목에 써도 안전한 사실", "주의할 오해"를 먼저 확인한다.
- 사전 소스 분석 결과에 "제목감 원문", "후킹 점수", "검수 보완", "제목 우선순위"가 있으면 제목과 도입부는 이 항목을 최우선으로 따른다.
- 사전 소스 분석 결과에 "최우선 훅"이 있으면 bestTitle과 후보 2개 이상은 이 훅을 반영해야 한다. 반영하지 못하면 제목을 다시 쓴다.
- 제목과 본문에는 검증된 사실과 제목에 써도 안전한 사실을 우선 사용한다.
- 숫자, 기간, 사용 기간, 수량, 누가 좋아했는지, 아픈 부위, 구매 전 고민, 사용 팁은 원문 근거가 직접 있을 때만 쓴다.
- "작게/크게", "빠르게/느리게", "전/후", "구매 전/사용 후", "1년/일주일"처럼 반대로 읽히기 쉬운 비교 표현은 주의할 오해를 기준으로 다시 확인한다.
- 제목 생성에서는 기간/숫자가 titleSafeFacts에 명확히 들어 있을 때만 쓴다. cautionFlags나 제목에서 피할 방향에 걸린 기간/숫자는 표현을 바꿔도 제목에 쓰지 않는다.
- 예: "1년"이 제품 사용 기간이 아니어서 cautionFlags에 잡혔다면 "1년 사용", "1년 버티다", "1년 만에"처럼 어떤 형태로도 제목에 넣지 않는다.
- 이미지 단서는 장면 묘사와 현장감에만 쓰고, 원문과 충돌하면 원문과 검증된 사실을 우선한다.
- 사전 분석의 cautionFlags 또는 제목에서 피할 방향에 적힌 표현은 제목과 본문에 쓰지 않는다.
`;

const TITLE_HARNESS_GUIDE = `
제목 하네스 검수 기준:
- 생성자는 제목을 만들기 전에 topHook, 제목감 원문, 후킹 점수, 검수 보완, 제목 우선순위를 먼저 읽는다.
- topHook.mustUseInTitle이 true면 bestTitle은 topHook.quote의 핵심 표현을 살려야 한다. 단 원문을 길게 복붙하지 말고 카페 제목처럼 줄인다.
- 5개 후보 중 최소 2개는 topHook 또는 80점 이상 hookScores에서 출발해야 한다.
- 범용 템플릿으로 도망가면 실패다. 특히 "이 사진 보면 이해됩니다", "아직 쓰세요?", "준비가 밀리던 이유", "사장님들, ~하시나요?", "처음엔 기대 안 했는데요..."는 topHook보다 강한 경우가 아니면 bestTitle 금지다.
- "사진첨부"는 이미지가 있을 때 보조 훅으로만 쓴다. 원문에 강한 문장이 있으면 사진 훅보다 원문 훅을 우선한다.
- bestTitle을 고른 뒤 스스로 검수한다: 1) 이 소스만의 고유 문장인가 2) topHook이 살아있는가 3) 광고/AI 문체가 아닌가 4) 원문 사실을 왜곡하지 않는가.
- 검수에서 하나라도 실패하면 bestTitle과 titles를 다시 쓴 뒤 JSON만 출력한다.
`;

const KOREAN_HUMAN_TONE_GUIDE = `
카페글 AI 티 제거 기준:
- 너무 정돈된 보고서 문장, 기계적인 병렬 구조, "결론적으로", "시사하는 바", "주목할 만한", "효율을 제공합니다" 같은 문구를 피한다.
- 제목은 키워드 조합이 아니라 사람이 카페에 쓴 말처럼 읽혀야 한다.
- 본문은 "또한/따라서/이러한/이를 통해" 같은 문두 접속사를 남발하지 않는다.
- 의미, 수치, 단점, 평점, 직접 인용은 보존한다. 자연스럽게 만든다고 사실을 바꾸지 않는다.
- 과윤문 금지. 후기의 날것 같은 표현이 클릭 포인트면 정리하지 말고 살린다.
`;
function buildPrompt(input) {
  const imageNote = input.hasImage
    ? "\n첨부 이미지가 있다. 이미지에서 보이는 실제 사용 상황, 재료, 결과물, 현장감을 반영하되 보이지 않는 성능은 지어내지 마라.\n"
    : "";
  const analysisNote = input.sourceAnalysis ? `\n사전 소스 분석 결과:\n${input.sourceAnalysis}\n` : "";

  return `${promptRole("카페 원고 편집자")}

목표:
- 광고 티를 줄이고 사장님 커뮤니티에서 클릭과 댓글이 나올 만한 글을 쓴다.
- 제목이 가장 중요하다. 제목은 제품명보다 상황/감정/숫자/궁금증이 먼저 나와야 한다.
- 본문 첫 3줄이 두 번째로 중요하다. 첫 3줄만 읽어도 사장님이 자기 이야기라고 느껴야 한다.
- 후기나 유튜브 소스는 그대로 베끼지 말고, 사장님 문제로 치환한다.

출력은 반드시 JSON만 한다. 설명, 마크다운, 코드블록 금지.
스키마:
{
  "bestTitle": "추천 제목 1개",
  "bestReason": "추천 이유",
  "titles": ["제목1", "제목2", "제목3"],
  "draft": "450~700자 카페 원고",
  "checks": ["직원이 확인할 점"]
}

제목 공식:
- 제품 설명형보다 커뮤니티 사연형을 우선한다.
- 조회수 잘 나온 패턴: "2년차 샐러드가게 할아버지가 매일 하는거", "피자가게 운영하고 몇년만에 와이프랑 만세불렀습니다!", "토스트·샌드위치 가게 사장님들… 양배추 하루 몇 통 쓰세요?", "분식집 사장님이 좋아하는 기계", "중국집 양파 하루 50kg 쓰는데요...ㄷㄷ"
- 제목 3개는 조회수형, 공감질문형, 사연후기형이 섞여야 한다.
- 조회수형: 숫자/손실/감정/미완성 표현을 섞어 가장 클릭하고 싶게 만든다.
- 공감질문형: 특정 업종 또는 상황을 불러 "다들 어떻게 하세요?", "저만 그런가요?"처럼 댓글을 부른다.
- 사연후기형: 실제 후기 속 사람/장면/반전을 살린다.
- 소스에 숫자가 있으면 제목 1개에는 숫자를 반드시 살린다.

본문 구조:
상황 -> 고민/문제 -> 욕구 -> 실제 후기/소스 근거 -> 자연스러운 상품 언급 -> 댓글 질문

금지:
- "후기 보다가 가져왔습니다"로 시작 금지
- "후기를 보니 생각하게 됐습니다" 같은 제3자 전달문 금지
- 최고의, 완벽한, 무조건, 보장, 대박 보장 금지
- 없는 후기를 실제 고객 발언처럼 꾸미기 금지
- 제품명으로 제목 시작 금지
- 추천합니다, 필수템, 해결책, 리얼후기, 전격공개, 이벤트, 특별혜택 같은 광고 제목 금지

입력:
소스 종류: ${input.sourceType || "미입력"}
타깃 업종: ${input.industry || "미입력"}
상품/서비스: ${input.product || "미입력"}
홍보/이벤트 안내 메모: ${input.promoMemo || "비어 있음. 평소 짧은 안내로 자동 처리"}
소스 내용:
${input.source || ""}
${imageNote}
${analysisNote}
작성 지시:
1. 입력 소스를 먼저 분석해서 타깃의 상황, 고충, 욕구, 믿을 근거, 제목 훅을 내부적으로 정리한다.
2. 내부적으로 제목 후보를 20개 생각하고 광고 냄새 나는 후보는 버린 뒤, 클릭 받을 제목 3개만 만든다.
3. bestTitle은 3개 중 가장 조회수가 높을 가능성이 큰 제목으로 고른다. 무난함보다 클릭 욕구를 우선한다.
4. bestReason은 왜 그 제목이 클릭 받을지 짧게 쓴다.
5. draft는 공백 포함 500~800자 사이로 쓴다. 길어도 900자를 넘기지 않는다.
6. 상품명은 본문 중반 이후 자연스럽게 1~2회만 언급한다.
7. 마지막에는 댓글을 부르는 질문을 넣는다.`;
}

function buildTitlePrompt(input) {
  const imageNote = input.hasImage
    ? "\n첨부 이미지가 있다. 이미지에서 보이는 업종, 재료, 사용 상황을 제목 훅에 반영하되 보이지 않는 성능은 지어내지 마라.\n"
    : "";
  const analysisNote = input.sourceAnalysis ? `\n사전 소스 분석 결과:\n${input.sourceAnalysis}\n` : "";

  return `${promptRole("제목 편집자")}

목표:
- 본문은 쓰지 말고, 클릭 받을 제목만 빠르게 만든다.
- 제목은 제품명보다 소스 안의 진짜 사연, 고충, 숫자, 장면이 먼저 나와야 한다.
- 카페 인기글처럼 사장님이 "내 얘기인데?"라고 느끼게 쓴다.
- 제품 설명 제목보다 커뮤니티 사연 제목을 우선한다. 제목만 보면 광고인지 모르게 만든다.

출력은 반드시 JSON만 한다. 설명, 마크다운, 코드블록 금지.
스키마:
{
  "bestTitle": "추천 제목 1개",
  "bestReason": "추천 이유",
  "titles": ["제목1", "제목2", "제목3"]
}

제목 공식:
- 소스 안의 강한 표현을 먼저 찾는다. 예: 진작 살걸, 새벽 칼질, 엄마, 손목/허리/무릎, 3미리/3.5미리, 통에 바로 담김, 부피 작음, 1시간->10분, 50kg, 식수 700명
- 조회수 잘 나온 제목의 핵심은 "제품 설명"이 아니라 "상황/감정/궁금증"이다.
- 참고 패턴:
  - 2년차 샐러드가게 할아버지가 매일 하는거
  - 피자가게 운영하고 몇년만에 와이프랑 만세불렀습니다!
  - 토스트·샌드위치 가게 사장님들… 양배추 하루 몇 통 쓰세요?
  - 분식집 사장님이 좋아하는 기계
  - 김밥집에 어떤 기계 사용하시나요?
  - 반찬가게는 손질할게 너무 많죠..?
  - 직원이 퇴사안한다네요 ..
  - 혹시 못보신 사장님계신가요?!
  - 중국집 양파 하루 50kg 쓰는데요...ㄷㄷ
  - 한 시간 걸리던 양배추 10분 만에 끝나니 이모님 팔이 살았네요
- 제목 3개는 서로 다른 각도로 만든다.
  1) 조회수형: 숫자/손실/감정/미완성 표현을 섞어 가장 클릭하고 싶게 만든 제목
  2) 공감질문형: 업종 또는 상황을 불러 "다들 어떻게 하세요?" 류로 댓글을 부르는 제목
  3) 사연후기형: 실제 후기 속 사람/장면/반전을 살린 제목
- 타깃 업종이 입력되어 있으면 1~2개 제목에만 자연스럽게 넣고, 모든 제목을 업종 호출로 시작하지 않는다.
- 타깃 업종이 비어 있거나 소스와 약하면 "사장님들", "부모님 도와드리는 분들", "야채 손질 많은 매장"처럼 넓게 쓴다.
- 저만 그런가요?, 다들 어떻게 하세요?, 하루 몇 통/몇 분/얼마나 걸리세요? 같은 질문형은 필요할 때만 쓴다.
- 조회수형 제목에는 말줄임표, ㅎㅎ, ㄷㄷ, ㅠㅠ, ..?, 만세불렀습니다 같은 커뮤니티식 감정을 과하지 않게 쓸 수 있다.
- 소스에 숫자가 있으면 제목 1개에는 숫자를 반드시 살린다. 예: 1시간, 10분, 50kg, 700명, 1~2통.

금지:
- 제품명으로 제목 시작 금지
- 추천합니다, 필수템, 해결책, 리얼후기, 전격공개, 이벤트, 특별혜택 같은 광고 제목 금지
- 과장/보장/대박 표현 금지
- 광고 제목처럼 쓰기 금지
- 소스에 없는 업종을 억지로 끼워 넣기 금지
- 세 제목이 업종명만 바뀐 같은 구조가 되는 것 금지
- "주방고수", "양배추슬라이서", "야채슬라이서", "업소용" 같은 제품/카테고리 단어는 제목에서 되도록 빼고, 필요할 때도 뒤쪽에만 둔다.

입력:
소스 종류: ${input.sourceType || "미입력"}
타깃 업종: ${input.industry || "미입력"}
상품/서비스: ${input.product || "미입력"}
홍보/이벤트 안내 메모: ${input.promoMemo || "비어 있음. 평소 짧은 안내로 자동 처리"}
소스 내용:
${input.source || ""}
${imageNote}
${analysisNote}
작성 지시:
1. 먼저 소스에서 제목에 쓸 만한 구체 단어 5개를 내부적으로 뽑는다.
2. 내부적으로 제목 후보를 20개 생각한다. 그중 광고 냄새 나는 후보는 버린다.
3. 최종 3개는 조회수형, 공감질문형, 사연후기형 순서로 출력한다.
4. bestTitle은 세 개 중 가장 조회수가 높을 가능성이 큰 제목으로 고른다. 무난함보다 클릭 욕구를 우선한다.
5. bestReason은 왜 클릭 받을지 1~2문장으로 짧게 쓴다.
6. 제목은 18~42자 정도를 우선하고, 너무 설명문처럼 길어지면 줄인다.`;
}

function buildDraftPrompt(input) {
  const imageNote = input.hasImage
    ? "\n첨부 이미지가 있다. 이미지에서 보이는 실제 사용 상황, 재료, 결과물, 현장감을 반영하되 보이지 않는 성능은 지어내지 마라.\n"
    : "";
  const analysisNote = input.sourceAnalysis ? `\n사전 소스 분석 결과:\n${input.sourceAnalysis}\n` : "";

  return `${promptRole("카페 원고 편집자")}

목표:
- 사용자가 선택한 제목의 약속을 본문에서 자연스럽게 회수한다.
- 광고 티를 줄이고 사장님 커뮤니티에서 읽힐 만한 원고를 쓴다.
- 본문 첫 3줄만 읽어도 사장님이 자기 이야기라고 느껴야 한다.
- 후기나 유튜브 소스는 그대로 베끼지 말고, 사장님 문제로 치환한다.

출력은 반드시 JSON만 한다. 설명, 마크다운, 코드블록 금지.
스키마:
{
  "draft": "450~700자 카페 원고",
  "checks": ["직원이 확인할 점"]
}

선택 제목:
${input.selectedTitle || "미입력"}

입력:
소스 종류: ${input.sourceType || "미입력"}
타깃 업종: ${input.industry || "미입력"}
상품/서비스: ${input.product || "미입력"}
홍보/이벤트 안내 메모: ${input.promoMemo || "비어 있음. 평소 짧은 안내로 자동 처리"}
소스 내용:
${input.source || ""}
${imageNote}

본문 구조:
상황 -> 고민/문제 -> 욕구 -> 실제 후기/소스 근거 -> 자연스러운 상품 언급 -> 댓글 질문

금지:
- "후기 보다가 가져왔습니다"로 시작 금지
- "후기를 보니 생각하게 됐습니다" 같은 제3자 전달문 금지
- 최고의, 완벽한, 무조건, 보장, 대박 보장 금지
- 없는 후기를 실제 고객 발언처럼 꾸미기 금지

작성 지시:
1. 첫 문단은 반드시 선택 제목과 직접 이어지는 상황/질문/고충으로 시작한다.
2. 제목에서 건 약속과 본문 내용이 따로 놀지 않게 쓴다.
3. draft는 공백 포함 500~800자 사이로 쓴다. 길어도 900자를 넘기지 않는다.
4. 상품명은 본문 중반 이후 자연스럽게 1~2회만 언급한다.
5. 마지막에는 댓글을 부르는 질문을 넣는다.`;
}

const TITLE_REFERENCE_GUIDE = `
조회수 잘 나온 우리 글 기준:
- 2년차 샐러드가게 할아버지가 매일 하는거
- 피자가게 운영하고 몇년만에 와이프랑 만세불렀습니다!
- 토스트·샌드위치 가게 사장님들… 양배추 하루 몇 통 쓰세요?
- 분식집 사장님이 좋아하는 기계
- 김밥집에 어떤 기계 사용하시나요?
- 반찬가게는 손질할게 너무 많죠..?
- 중국집 양파 하루 50kg 쓰는데요...ㄷㄷ
- 한 시간 걸리던 양배추 10분 만에 끝나니 이모님 팔이 살았네요

최근 카페 인기글에서 배운 제목 감각:
- 겁이 납니다...
- 오늘 어떠시나요?
- 금요일인데 이런다고 ??
- 오늘 진짜 심하네요....
- 진짜 큰일났네요 …
- 사고치고 왔습니다..
- 진짜 인생 최악의 곱창집이네요
- 와이프가 주1일씩 도와주는데 미쳐버리겠네요
- 단일메뉴로 가려했으나...ㅠㅠ

업소용 게시판 3,651개 제목/조회수 분석 반영:
- 조회수 평균은 약 340, 중앙값은 약 260이었다.
- 제목에 사진/사진첨부가 들어간 글 평균 조회수는 약 485로 높았다. 실제 사진이나 현장 캡처가 있으면 제목 후보 1개에는 "(사진첨부)"를 자연스럽게 붙인다.
- 괄호 활용 제목 평균 조회수는 약 481로 높았다. 단, 괄호는 정보성 보강용으로만 쓰고 광고처럼 남발하지 않는다.
- 감정/궁금증 제목 평균 조회수는 약 496으로 높았다. "미쳤네요", "처음보는", "숨도 못 쉬었습니다", "왜", "꼭" 같은 궁금증 단어를 소스에 맞을 때만 쓴다.
- 구어체/말줄임 제목 평균 조회수는 약 438로 높았다. 너무 깔끔한 설명문보다 카페 사람이 쓴 듯한 말투를 우선한다.
- 업종명 포함은 평균보다 좋지만 모든 제목을 업종명으로 시작하면 패턴이 뻔해진다. 업종명은 1~2개 후보에만 자연스럽게 넣는다.
- 제품명/기계명을 제목에 노출한 글은 평균 조회수가 낮았다. "주방고수", "양배추슬라이서", "야채슬라이서", "업소용", "기계", "장비"는 제목 앞부분에서 최대한 피한다.

업소용 게시판에서 잘 먹힌 제목 결:
- 피크시간에 라떼 밀리는 이유가 냉장고였네요
- 치킨집 주방의 정석
- 주방 좁을 때 해결 꿀팁(사진첨부)
- 고깃집 주방 퀄리티 미쳤네요
- 창업할 때 전기 꼭 확인하셔야 됩니다
- 주문이 너무 많아 대기만 한달이 넘는 자동생맥주기계입니다.

업소용 제목 추가 공식:
1. 현장사진형: "돈까스집 주방, 양배추가 제일 먼저 보이네요(사진첨부)"
2. 상황반전형: "피크시간에 밀리던 이유가 양배추였네요"
3. 업종궁금형: "치킨집 샐러드 미리 썰면 진짜 티 나나요?"
4. 짧은정석형: "돈까스집 주방의 정석"
5. 사장님사연형: "가산동 돈까스집 사장님이 양배추 앞에서 멈춘 이유"

좋은 제목의 공통점:
1. 제품 설명이 아니라 사람/상황/사연처럼 보인다.
2. 업종, 연차, 가족, 직원, 시간, 수량 중 하나가 구체적으로 들어간다.
3. 결론을 다 말하지 않고 궁금증을 남긴다.
4. "주방고수", "슬라이서", "업소용", "추천", "필수템", "해결책", "이벤트", "특별혜택", "리얼후기" 같은 광고 냄새 나는 단어는 제목 앞에 두지 않는다.
5. 너무 깔끔한 설명문보다 살짝 사람 냄새 나는 표현이 낫다. 예: "..?", "...", "ㄷㄷ", "만세불렀습니다", "이거 맞나요?"

모바일 피드에서 배운 이미지-제목 규칙:
- 사람은 제목보다 대표 이미지/영상 썸네일을 먼저 본다. 제목은 이미지를 설명하되, 다 설명하지 말고 궁금증을 만들어야 한다.
- 대표 이미지에 사람이 보이면 사람/업종/상황을 제목에 연결한다. 예: "2년차 샐러드가게 할아버지가 매일 하는거".
- 대표 이미지에 재료가 크게 보이면 재료/수량/손질 상황을 제목에 연결한다. 예: "중국집 양파 하루 50kg 쓰는데요...ㄷㄷ".
- 대표 이미지에 주방 전체나 매장 내부가 보이면 현장/피크타임/오픈/주방 구성 쪽으로 연결한다.
- 대표 이미지에 기계만 보이면 제품명보다 "이걸 왜 들였는지", "무엇이 막혔는지", "어느 작업 때문에 바꿨는지"로 제목을 만든다.
- 이미지와 제목이 따로 놀면 클릭률이 떨어진다. bestTitle은 반드시 "이미지를 본 사람이 제목을 읽고 더 궁금해지는가"를 기준으로 고른다.
- 후기 원문에 부모님, 엄마, 아버지, 어머니, 직원, 알바, 이모님, 사장님처럼 사람이 나오면 그 감정 키워드를 반드시 제목 후보 1개 이상에 반영한다.
- 이미지에 재료가 보이고 후기에는 사람이 나오면 "사람 + 사진 속 재료/양 + 궁금증" 구조를 우선 고려한다. 예: "부모님이 직접 썰던 채소, 이 양푼 보니까 이해됐습니다".

레퍼런스 분리 원칙:
- 말투 레퍼런스: 카페 인기글처럼 사장님이 직접 쓴 듯한 생활감, 말줄임, 약한 푸념, ㅎㅎ/ㅠㅠ/ㄷㄷ 감각만 참고한다.
- 후킹 레퍼런스: 인기글의 사건성, 숫자, 사람, 반전, 도움요청, 미완성 문장 구조만 가져온다.
- CTA 레퍼런스: 인기글의 목적을 따라 하지 말고 주방고수 목적에 맞춘다. 최종 목적은 댓글/문의/링크 클릭/제품 필요성 인식이다.
- 좋은 레퍼런스라도 서비스 판매, 정치/이슈, 분노 유도 목적이면 그 의도는 버리고 제목 구조만 사용한다.
- 제목은 단순 클릭 낚시가 아니라 "궁금해서 들어왔더니 실제로 우리 제품/서비스 문제와 맞는 글"이어야 한다.

bestTitle 판단 기준:
- 1순위: 소스의 감정핵심이 살아있는가. 예: 부모님 만족, 와이프와 만세, 이모님 팔, 직원 손목, 사장님 푸념.
- 2순위: 대표 이미지/영상 썸네일을 본 사람이 제목을 읽고 바로 연결되는가.
- 3순위: 본문 끝에서 제품 필요성, 문의, 링크 확인으로 자연스럽게 이어지는가.
- 4순위: 카페 인기글처럼 사연/현장/궁금증이 있는가.
- 사진에 재료가 많아 보여도 후기의 감정핵심이 더 강하면 감정핵심을 bestTitle에 우선 반영한다. 예: "부모님이 만족하신 이유, 사진 보니 알겠네요".
- 사진/영상에 보이는 재료명은 제목의 전부가 아니라 근거 장면이다. 화면에 보이는 재료와 원문에 있는 사람 반응/수량/고충이 다르면, 현재 원문에 실제로 있는 핵심을 우선한다. 단, 원문에 없는 사람 반응은 절대 지어내지 않는다.
- 제목 후보를 고를 때 아래 점수로 내부 평가한다: 원문핵심 40점, 감정반응 25점, 이미지연결 20점, 제품CTA연결 15점. 이미지연결만 높은 제목은 bestTitle로 고르지 않는다.
- 표면 장면만 설명하는 제목은 낮은 점수다. 현재 소스에 실제로 있는 사람 반응/수량/고충과 이미지 장면이 같이 연결되는 제목을 우선한다.

제목 5개는 반드시 서로 다른 역할로 만든다:
1. 사연형: 인물/연차/가족/직원/상황이 보이는 제목. 가장 우선 추천 후보.
2. 업종 질문형: 특정 업종 사장님이 자기 얘기로 느끼는 제목.
3. 숫자 고충형: 시간, 수량, 인원, 비용 같은 숫자로 문제 크기를 보여주는 제목.
4. 반전 후기형: 전에는 힘들었는데 달라진 점이 궁금해지는 제목.
5. 카페 인기글형: 최근 인기글처럼 짧고 감정/궁금증이 강한 제목.

이번 성적표 반영:
- "한 시간 걸리던 양배추 10분 만에 끝나니 이모님 팔이 살았네요"는 방향은 좋지만 제목에서 결론을 너무 많이 말한다.
- "가산동 돈까스집 직원들 손 베이던 일이 많았는데요..."는 상황은 좋지만 조금 무겁고 클릭 후 보상이 덜 궁금하다.
- 앞으로는 효과를 제목에서 다 말하지 말되, 매번 "바꾼 것"으로 끝내지 않는다.
- 더 좋은 방향: "가산동 돈까스집 사장님이 양배추 앞에서 멈춘 이유", "반찬가게 어머님이 새벽마다 제일 힘들어한 일", "2년차 샐러드가게 할아버지가 매일 하는거", "피크시간에 밀리던 이유가 양배추였네요", "양배추 두 통 썰면 손목부터 보입니다".
- 제목에서 전후 효과를 모두 공개하는 문장보다, 실제 매장/사람 + 매일 하던 일 + 막힌 지점/이유/질문/장면을 남기는 제목을 우선 추천한다.
- "바꾼 것", "바꾼 이유", "바꿨습니다" 같은 바꾸다 계열 어미는 5개 후보 전체에서 최대 1개만 허용한다.
- 5개 제목은 끝맺음이 모두 달라야 한다. 예: "~이유", "~보이네요", "~걸릴까요?", "~정석", "~합니다"처럼 구조를 섞는다.
- "10분 만에 끝", "팔이 살았다", "손 베였다"처럼 결론이나 자극을 다 보여주는 문장은 후보에는 넣을 수 있지만 bestTitle 우선순위는 낮춘다.
- 분석 키워드를 그대로 이어 붙인 제목은 낮은 점수다. 예시 단어를 나열하지 말고 현재 소스에 있는 사람 반응과 장면을 자연스러운 문장으로 바꿔라.
- 사람 말처럼 짧게 고쳐라. 예시 표현은 패턴만 참고하고 현재 소스에 없는 감정 단어는 쓰지 않는다.
- bestTitle은 키워드가 많이 들어간 제목이 아니라, 카페 회원이 실제로 쓴 것처럼 자연스럽고 궁금한 제목이어야 한다.
`;

const BODY_TONE_GUIDE = `
본문 말투 기준:
- 네이버 카페 인기글처럼 첫 2~3줄에서 상황을 먼저 보여준다.
- "후기를 보다가 가져왔습니다", "생각하게 됐습니다" 같은 제3자 전달문으로 시작하지 않는다.
- 제품 소개문처럼 쓰지 말고, 사장님이 자기 매장 일을 털어놓는 느낌으로 쓴다.
- 문장은 짧게 끊고 줄바꿈을 자주 쓴다. 쉼표와 마침표를 많이 쓰지 말고, 사용자가 평소 쓰듯 줄바꿈으로 호흡을 만든다.
- 문장 끝 마침표는 대부분 생략한다. 꼭 필요한 경우만 쓰고, 쉼표는 한 문단에 0~1개 정도만 쓴다.
- 너무 정돈된 문어체보다 카페에 바로 올린 듯한 구어체를 우선한다.
- ㅋㅋ, ㅎㅎ, ㅠㅠ, .. 같은 표현은 필요할 때 1~3번만 쓴다.
- 과장, 허위 체험담, 보장 표현은 금지한다. 소스에 있는 내용만 각색한다.
- 선택 제목이 어색하거나 길면 본문에서 그 문장을 그대로 반복하지 말고 자연스러운 말로 풀어 쓴다.
- 같은 말 반복 금지. 손목, 직원, 매일 반복 같은 핵심은 각각 1~2번만 쓰고 다음 장면으로 넘어간다.
- 첫 4줄 안에 이미지 장면과 제목의 궁금증을 회수한다.
- 제품명은 중반 이후에 자연스럽게 1~2번만 넣는다.
- 마지막은 댓글이 달릴 만한 질문으로 끝낸다.

본문 흐름:
1. 도입: 제목과 바로 이어지는 장면/고충/숫자.
2. 공감: 사장님들이 매일 겪는 준비시간, 손목, 직원, 피크타임 문제.
3. 소스 각색: 고객후기/유튜브 내용 중 구체적인 한 장면을 자연스럽게 녹인다.
4. 제품 연결: "그래서 이런 장비를 보는 분들이 늘어나는 것 같다" 정도로 낮은 톤.
5. 댓글 질문: 다른 사장님들은 어떻게 하는지 묻는다.
`;


function buildPrompt(input) {
  const imageNote = input.hasImage
    ? "\n첨부 이미지가 있다. 이미지에서 보이는 실제 사용 상황, 재료, 결과물, 현장감을 반영하되 보이지 않는 기능은 지어내지 마라.\n"
    : "";
  const analysisNote = input.sourceAnalysis ? `\n사전 소스 분석 결과:\n${input.sourceAnalysis}\n` : "";

  return `${promptRole("카페 원고 편집자")}

목표:
- 클릭을 받을 제목 5개와, 끝까지 읽히는 카페 원고 1개를 만든다.
- 광고글처럼 보이지 않게 한다.
- 원고 소스는 고객 후기 또는 유튜브 대본이다. 그대로 베끼지 말고 사장님 고충/운영 인사이트로 바꿔 쓴다.
- 허위 경험담을 만들지 않는다. 소스에 없는 성능, 수치, 보장은 쓰지 않는다.

${TITLE_REFERENCE_GUIDE}
${TITLE_HARNESS_GUIDE}

${SOURCE_FACT_GUARD_GUIDE}
${BODY_TONE_GUIDE}
${KOREAN_HUMAN_TONE_GUIDE}
${PROMO_FOOTER_GUIDE}
${promptOverrideBlock()}

출력은 반드시 JSON만 쓴다. 설명, 마크다운, 코드블록 금지.
스키마:
{
  "bestTitle": "추천 제목 1개",
  "bestReason": "추천 이유",
  "titles": ["제목1", "제목2", "제목3", "제목4", "제목5"],
  "draft": "450~700자 카페 원고",
  "checks": ["직원이 확인할 점"]
}

입력:
소스 종류: ${input.sourceType || "미입력"}
타깃 업종: ${input.industry || "미입력"}
상품/서비스: ${input.product || "미입력"}
홍보/이벤트 안내 메모: ${input.promoMemo || "비어 있음. 평소 짧은 안내로 자동 처리"}
소스 내용:
${input.source || ""}
${imageNote}
${analysisNote}
작성 지시:
1. 제목은 내부적으로 25개 이상 만든 뒤 광고 냄새 나는 후보를 버리고 5개만 남긴다.
2. bestTitle은 무난한 제목이 아니라 조회수 가능성이 가장 높은 제목으로 고른다. 특히 "실제 매장/사람 + 매일 하던 일 + 막힌 지점/이유/질문/장면" 구조를 우선한다.
3. bestReason에는 왜 클릭 받을지 1~2문장으로 구체적으로 쓴다.
4. draft는 공백 포함 450~700자 사이로 쓴다. 길어도 800자를 넘기지 않는다.
5. 첫 문단은 반드시 bestTitle과 이어지는 장면으로 시작한다.
6. 제목과 본문이 따로 놀지 않게 한다.
7. 본문 중반 이후에 상품/서비스를 자연스럽게 연결한다.
8. 마지막은 댓글 유도 질문으로 끝낸다.`;
}

function buildTitlePrompt(input) {
  const imageNote = input.hasImage
    ? "\n첨부 이미지가 있다. 모바일 피드에서는 이미지가 제목보다 먼저 보인다. 이미지에서 보이는 사람/업종/재료/주방/기계/자막/장면을 먼저 읽고, 제목은 그 이미지를 설명하면서도 궁금증을 남기게 만들어라. 이미지와 직접 연결되지 않는 제목은 조회수가 높아 보여도 bestTitle에서 제외하라. 보이지 않는 기능이나 성능은 지어내지 마라.\n"
    : "";
  const analysisNote = input.sourceAnalysis ? `\n사전 소스 분석 결과:\n${input.sourceAnalysis}\n` : "";

  return `${promptRole("제목 편집자")}

목표:
- 본문은 쓰지 말고 클릭 받을 제목 5개만 빠르게 만든다.
- 제목은 제품 설명이 아니라 사장님 사연/상황처럼 보여야 한다.
- 타깃 업종은 좋지만, 모든 제목을 업종명으로 시작하지는 마라.

${TITLE_REFERENCE_GUIDE}
${TITLE_HARNESS_GUIDE}

${SOURCE_FACT_GUARD_GUIDE}
${KOREAN_HUMAN_TONE_GUIDE}
${promptOverrideBlock()}
출력은 반드시 JSON만 쓴다. 설명, 마크다운, 코드블록 금지.
스키마:
{
  "bestTitle": "추천 제목 1개",
  "bestReason": "추천 이유",
  "titles": ["제목1", "제목2", "제목3", "제목4", "제목5"]
}

입력:
소스 종류: ${input.sourceType || "미입력"}
타깃 업종: ${input.industry || "미입력"}
상품/서비스: ${input.product || "미입력"}
홍보/이벤트 안내 메모: ${input.promoMemo || "비어 있음. 평소 짧은 안내로 자동 처리"}
소스 내용:
${input.source || ""}
${imageNote}
${analysisNote}
작성 지시:
1. 먼저 "후킹 검수자"처럼 사전 소스 분석 결과의 제목감 원문, 후킹 점수, 검수 보완, 제목 우선순위를 확인한다. 이 항목에 높은 점수 문장이 있으면 제목 후보 최소 2개는 그 문장에서 출발한다.
2. 소스에서 제목 소재를 분리해라: 감정핵심 1개, 사람 반응 1개, 비교/비유 문장 1개, 숫자/시간/수량 1개, 대표 이미지/장면 단서 1개, 실제 고충 1개, 믿을 근거 1개, 제품으로 이어질 CTA 1개. 원문에 비교/비유와 사람 반응이 있으면 이미지 속 재료명보다 우선한다.
3. 말투/후킹/CTA를 분리해서 판단한다. 말투와 후킹은 카페 인기글에서 빌리되, CTA는 반드시 주방고수 제품 필요성/문의/링크 확인으로 이어지게 한다.
4. 첨부 이미지가 있으면 이미지 소재 5개도 따로 뽑아라. 예: 인물, 표정, 재료, 기계, 주방 배경, 자막, 용기, 손질 결과물.
5. 내부적으로 제목 후보를 25개 이상 만든다.
6. 아래 5가지 역할로 최종 제목 5개를 만든다.
   - 1번: 사연형. 사람/연차/가족/직원/매장 상황이 보이는 제목. 소스에 부모님/엄마/아버지/어머니/직원/알바/이모님/사장님이 나오면 반드시 이 사람 키워드를 살린다.
   - 2번: 현장사진형. 실제 매장/주방/사진/캡처가 있는 듯한 제목. 이미지나 영상 소스가 있으면 "(사진첨부)"를 자연스럽게 붙일 수 있다.
   - 3번: 상황반전형. 피크시간, 좁은 주방, 준비시간, 직원 손목 같은 문제가 의외의 원인과 연결되는 제목.
   - 4번: 업종 질문형. 특정 업종 사장님이 자기 얘기로 느끼는 질문 제목.
   - 5번: 카페 인기글형. 최근 인기글처럼 짧고 감정/궁금증이 강한 제목.
7. bestTitle은 다섯 후보 중 조회수 가능성이 가장 높은 제목으로 고른다. 단, 소스에 강한 감정핵심/비교문/반전문이 있으면 이미지 단서보다 그 문장을 우선하고, 이미지가 그 감정의 근거가 되게 만든다.
   - 가장 우선할 구조: "실제 매장/사람 + 매일 하던 일 + 막힌 지점/이유/질문/장면".
   - 예: "가산동 돈까스집 사장님이 양배추 앞에서 멈춘 이유".
   - 예: "반찬가게 어머님이 새벽마다 제일 힘들어한 일".
   - 예: "2년차 샐러드가게 할아버지가 매일 하는거".
   - 업소용 게시판에서는 "현장감 + 사진/매장/주방 + 상황반전" 구조가 강하므로, 소스에 실제 사진/영상/현장 내용이 있으면 현장사진형 또는 상황반전형도 bestTitle 후보로 강하게 고려한다.
   - 이미지-제목 연결 예시: 할아버지/사장님 얼굴이 보이면 사람 중심 제목, 썰린 채소가 크게 보이면 재료/수량 중심 제목, 주방 전체가 보이면 현장/피크타임/주방 문제 제목.
   - 소스에 사람 감정 키워드가 있으면 bestTitle에서 강하게 고려한다. 예: "부모님이 만족하신 이유, 이 양푼 보니까 알겠네요", "이모님 팔이 왜 힘들었는지 사진 보니 알겠네요".
   - 소스에 "식세기/로봇청소기 이후", "처음엔 기대 안 했는데", "완전 반대였습니다", "없이는 상상 못 한다"처럼 생활 변화급 비교/반전 문장이 있으면 기능 키워드보다 우선한다.
   - 이미지에 없는 장면을 제목으로 만들지 않는다. 예: 이미지가 고추 바구니인데 제목은 "한식뷔페 직원 2명"처럼 동떨어지면 낮은 점수.
   - 효과를 제목에서 다 공개하는 후보는 bestTitle에서 한 단계 낮춘다. 예: "1시간이 10분으로 줄었다", "팔이 살았다"를 제목에서 모두 말하지 않는다.
8. bestReason은 직원이 이해할 수 있게 왜 클릭 받을지 1~2문장으로 쓴다. 추천 이유에는 제목감 원문/감정핵심/이미지 연결/제품 CTA 연결 중 최소 2가지를 설명한다.
9. 제목은 16~45자 정도를 우선한다. 너무 긴 설명문이면 줄인다.
10. 분석 결과의 단어를 기계적으로 합치지 마라. "사람 반응 + 매일 손질 + 장면"처럼 명사만 붙은 제목은 실패다.
11. 같은 뜻이면 더 짧고 사람 말 같은 제목을 고른다. 예시 표현은 패턴만 참고하고, 현재 소스에 없는 단어는 제목에 쓰지 않는다. 소스에 실제 사람 반응이 있으면 그 감정형 제목을 bestTitle 최우선 후보로 둔다.
12. 금지: 제목을 상품명으로 시작, 광고 문구, 과장 보장, 소스에 없는 업종/수치 지어내기.
13. 5개 제목은 서로 다른 문장 구조와 끝맺음을 가져야 한다. "바꾼 것", "바꾼 이유", "바꿨습니다" 같은 바꾸다 계열 표현은 전체 후보 중 최대 1개만 쓴다.
14. "추천합니다", "필수템", "전격공개", "최저가", "구매하세요" 같은 광고 단어보다 "왜 밀렸는지", "어디서 막혔는지", "손목이 먼저 보이는지", "몇 통부터 힘든지" 같은 상황 단어를 우선한다.`;
}

function buildDraftPrompt(input) {
  const imageNote = input.hasImage
    ? "\n첨부 이미지가 있다. 모바일 피드에서는 이미지가 먼저 보였다는 전제로, 첫 문단은 이미지에서 보이는 장면과 선택 제목이 자연스럽게 이어지도록 시작하라. 이미지에 사람이 보이면 사람/현장, 재료가 보이면 재료/손질량, 주방이 보이면 주방 상황을 먼저 언급한다. 보이지 않는 기능은 지어내지 마라.\n"
    : "";
  const analysisNote = input.sourceAnalysis ? `\n사전 소스 분석 결과:\n${input.sourceAnalysis}\n` : "";

  return `${promptRole("카페 원고 편집자")}

목표:
- 사용자가 선택한 제목에 맞춰 450~700자 원고를 쓴다. 길면 안 읽히므로 반복을 줄인다.
- 제목만 보고 쓰지 말고, 반드시 소스 내용을 함께 반영한다.
- 제품 소개글이 아니라 사장님들이 끝까지 읽을 만한 카페 글처럼 쓴다.
- 허위 경험담을 만들지 않는다. 소스에 없는 성능, 수치, 보장은 쓰지 않는다.

${BODY_TONE_GUIDE}
${KOREAN_HUMAN_TONE_GUIDE}
${PROMO_FOOTER_GUIDE}
${SOURCE_FACT_GUARD_GUIDE}
${promptOverrideBlock()}

출력은 반드시 JSON만 쓴다. 설명, 마크다운, 코드블록 금지.
스키마:
{
  "draft": "450~700자 카페 원고",
  "checks": ["직원이 확인할 점"]
}

선택 제목:
${input.selectedTitle || "미입력"}

입력:
소스 종류: ${input.sourceType || "미입력"}
타깃 업종: ${input.industry || "미입력"}
상품/서비스: ${input.product || "미입력"}
홍보/이벤트 안내 메모: ${input.promoMemo || "비어 있음. 평소 짧은 안내로 자동 처리"}
소스 내용:
${input.source || ""}
${imageNote}
${analysisNote}
작성 지시:
1. 첫 문단은 반드시 선택 제목과 직접 이어지는 장면/고충/질문으로 시작한다.
2. 첨부 이미지가 있으면 첫 문단은 이미지에서 보이는 장면과도 이어져야 한다. 제목-이미지-본문 첫 문단이 한 흐름으로 읽혀야 한다.
3. 선택 제목을 본문에 그대로 복붙하지 마라. 제목의 감정이나 상황은 현재 소스에 실제로 있는 내용만 바탕으로 자연스럽게 풀어 쓴다.
4. "후기 보다가 가져왔습니다", "생각하게 됐습니다" 같은 제3자 전달문으로 시작하지 않는다.
5. 소스에 있는 구체 요소를 최소 3개 반영한다. 예: 시간, 수량, 재료, 직원, 가족, 손목/허리, 세척, 공간.
6. 같은 고충을 반복하지 말고 한 번 말했으면 다음 장면으로 넘어간다.
7. 상품/서비스명은 본문 중반 이후에 자연스럽게 1번만 언급한다. 필요할 때만 2번까지 허용한다.
8. 450~700자 사이로 쓴다. 길어도 800자를 넘기지 않는다.
9. 마지막에는 PROMO_FOOTER_GUIDE 기준으로 짧은 제품 연결 또는 이벤트 안내를 붙인다.`;
}

function buildSourceAnalysisPrompt(input) {
  const imageNote = input.hasImage
    ? "\n첨부 이미지가 있다. 먼저 이미지 안의 글자를 최대한 빠짐없이 읽어 extractedText에 줄 단위로 옮겨라. 그 다음 이미지에서 보이는 사람, 재료, 용기, 주방, 기계, 자막, 결과물을 imageClues에 따로 적어라. 이미지 단서는 원문 사실을 덮어쓰지 말고 보강 근거로만 사용한다.\n"
    : "";
  const analysisNote = input.sourceAnalysis ? `\n사전 소스 분석 결과:\n${input.sourceAnalysis}\n` : "";

  return `너는 네이버 카페 원고를 만들기 전에 소스를 해석하는 분석가다.

목표:
- 제목을 바로 만들지 말고, 소스에서 제목/본문에 써야 할 핵심 재료를 먼저 뽑는다.
- 이미지 첨부가 있으면 OCR/원문 추출을 먼저 하고, 그 다음 이미지 단서와 분석을 분리한다.
- 이미지에 보이는 표면 단서보다 원문에 있는 사람 반응, 숫자, 기간, 전후관계, 고충, 감정핵심을 우선한다.
- 1차 분석가가 놓치기 쉬운 "제목감 원문"을 별도 검수한다. 기능 설명보다 강한 비교, 반전, 기대와 실제 차이, 생활 변화급 만족 표현을 반드시 찾는다.
- 광고 문구가 아니라 사장님들이 궁금해할 만한 후킹 재료를 찾는다.
- 소스에 없는 기능, 성능, 수치, 업종은 지어내지 않는다.
- 원문에 있는 숫자라도 무엇의 기간/수량인지 직접 확인하지 못하면 제목 소재로 승격하지 않는다.

출력은 반드시 JSON만 쓴다. 설명, 마크다운, 코드블록 금지.
스키마:
{
  "summary": "한 줄 요약",
  "extractedText": ["이미지나 입력에서 읽은 원문 핵심 줄. 원문이 길면 의미 단위로 압축하되 숫자/기간/부정/비교 표현은 보존. 빈 배열 금지"],
  "coreKeywords": ["주요 키워드"],
  "originalCore": ["원문 핵심"],
  "verifiedFacts": ["원문 근거가 직접 있는 검증 사실. 가능하면 짧은 원문 근거를 함께 적음. 빈 배열 금지"],
  "imageClues": ["이미지/영상 단서"],
  "emotionCore": ["감정 핵심"],
  "hookQuotes": ["제목감 원문. 원문에서 그대로 가져온 강한 문장/구절 3~7개. 비교, 반전, 기대와 실제 차이, 생활 변화급 만족, 사람 반응을 우선. 빈 배열 금지"],
  "hookScores": ["후킹 점수. 각 제목감 원문을 감정강도/구체성/반전성/제목화가능성/제품연결성 기준으로 100점 만점 평가. 예: 92점 - 식세기, 로봇청소기 이후... - 생활 변화급 비교라 제목 우선"],
  "reviewerNotes": ["검수 보완. 1차 분석이 놓치면 안 되는 문장과 그 이유. 예: 기능보다 만족감 비교가 더 강함. 빈 배열 금지"],
  "topHook": {"quote": "가장 강한 제목감 원문 1개", "score": 0, "reason": "왜 이 문장이 가장 강한지", "mustUseInTitle": true},
  "titlePriority": ["제목 우선순위. 제목 생성 때 먼저 살릴 소재 순서. 1순위는 가장 점수 높은 hookQuotes를 기반으로 작성. 빈 배열 금지"],
  "productBridge": ["제품 연결 포인트"],
  "titleMustUse": ["제목에 꼭 살릴 단어"],
  "titleSafeFacts": ["제목에 써도 안전한 사실만. 숫자/기간/인물 반응은 원문 근거가 직접 있고 제목에서 오해될 위험이 낮을 때만. 빈 배열 금지"],
  "titleAvoid": ["제목에서 피할 방향"],
  "cautionFlags": ["헷갈리기 쉬운 점, 원문에 없어서 쓰면 안 되는 점, 비교/반대 의미 주의. 빈 배열 금지"]
}

입력:
소스 종류: ${input.sourceType || "미입력"}
타깃 업종: ${input.industry || "미입력"}
상품/서비스: ${input.product || "미입력"}
홍보/이벤트 안내 메모: ${input.promoMemo || "비어 있음. 평소 짧은 안내로 자동 처리"}
소스 내용:
${input.source || ""}
${imageNote}

분석 기준:
1. 현재 입력 소스와 첨부 이미지에서 확인되는 내용만 출력한다. 이전 분석, 이전 대화, 프롬프트 예시에 나온 고유 표현은 현재 소스에 없으면 절대 쓰지 않는다.
2. extractedText를 먼저 작성한다. 입력 소스 텍스트가 있으면 핵심 원문 줄 6~12개를 그대로 옮기고, OCR이 애매한 글자는 추측하지 말고 "판독 불확실"이라고 표시한다. extractedText는 절대 빈 배열로 두지 않는다.
3. 원문핵심 25점: 실제 후기 문장에 있는 숫자, 기간, 재료량, 반복 업무, 고충을 우선한다.
4. 사실검증 25점: 사용 기간, 수량, 전후관계, 누가 좋아했는지, 어느 부위가 아팠는지 같은 항목은 verifiedFacts와 cautionFlags로 나누어 검증한다.
5. 비교문 검증: "작게/크게", "빠르게/느리게", "전/후", "구매 전/사용 후", "1년/일주일"처럼 의미가 뒤집히기 쉬운 문장은 반드시 원문 방향 그대로 적는다.
6. 후킹원문 25점: 원문에서 그대로 가져온 제목감 문장을 hookQuotes에 따로 뽑는다. "식세기, 로봇청소기 이후 오랜만에 만족감을 준 제품"처럼 기능명보다 감정/비교/생활 변화가 큰 문장은 최고 우선순위다.
7. 감정반응 10점: 현재 원문에 실제로 있는 사람 반응만 잡는다. 예시 단어를 새 사실처럼 끌어오지 않는다.
8. 이미지연결 10점: 사진/영상에 보이는 장면이 원문핵심을 어떻게 증명하는지 잡는다. 보이는 장면만으로 원문에 없는 성능이나 반응을 만들지 않는다.
9. 제품CTA연결 5점: 댓글/문의/링크 확인/제품 필요성으로 이어질 포인트를 잡는다.
10. hookScores는 감정강도, 구체성, 반전성, 제목화가능성, 제품연결성을 기준으로 100점 만점으로 적고, 80점 이상 문장은 titlePriority 상위에 둔다.
11. topHook에는 hookScores 중 가장 높은 문장 1개를 구조화해서 넣는다. score가 80점 이상이면 mustUseInTitle은 true다.
12. reviewerNotes에는 "기능 키워드보다 더 센 문장", "제목에서 놓치면 손해인 문장", "원문 의미를 바꾸면 위험한 문장"을 적는다.
13. titlePriority 1순위는 topHook.quote에서 가져온다. 2순위는 원문핵심/감정핵심, 3순위는 이미지 단서, 4순위는 제품 연결 포인트로 둔다.
14. verifiedFacts에는 최소 5개 이상, titleSafeFacts에는 최소 3개 이상 적는다.
15. titleMustUse와 titleSafeFacts에는 현재 소스에 실제로 있는 단어와 검증 사실만 넣는다.
16. 제목에서 오해될 수 있는 숫자/기간은 titleSafeFacts에 넣지 말고 cautionFlags에 넣는다. 예: 제품 사용 기간이 아닌 기존 작업 기간 "1년"은 "1년 사용"으로 오해되므로 titleSafeFacts에서 제외한다.
17. titleAvoid와 cautionFlags에는 이미지 표면만 설명하거나 현재 소스에 없는 과거 예시 단어를 끌어오는 방향, 원문 의미를 뒤집을 위험이 있는 표현을 적는다.`;
}
function safeFilename(value) {
  return String(value || "카페_검수_원고")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "카페_검수_원고";
}

function compactDateForFilename(date = new Date()) {
  const year = String(date.getFullYear()).slice(2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function docxFilename(input) {
  const date = compactDateForFilename();
  const industry = safeFilename(input.industry || "업종미입력").replace(/\s+/g, "").slice(0, 40);
  const sourceType = safeFilename(input.sourceType || "소스미입력").replace(/\s+/g, "").slice(0, 40);
  return `${date}_${industry}_${sourceType}.docx`;
}

async function runCodex(input, options = {}) {
  const aiSettings = appSettings.ai || {};
  const codexExe = aiSettings.codexExe || defaultAppSettings.ai.codexExe;
  const codexModel = aiSettings.codexModel || "";
  const codexReasoningEffort = aiSettings.codexReasoningEffort || "low";
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "cafe-codex-"));
  const outputPath = path.join(tempDir, "last-message.json");
  const schemaPath = path.join(root, options.schema || "codex_output_schema.json");
  const args = [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-c",
    `model_reasoning_effort="${codexReasoningEffort}"`,
    "--output-schema",
    schemaPath,
    "--output-last-message",
    outputPath
  ];

  if (codexModel) {
    args.splice(1, 0, "--model", codexModel);
  }

  if (input.image && input.image.base64) {
    const ext = input.image.mimeType && input.image.mimeType.includes("png") ? "png" : "jpg";
    const imagePath = path.join(tempDir, `review-image.${ext}`);
    await fsp.writeFile(imagePath, Buffer.from(input.image.base64, "base64"));
    args.push("--image", imagePath);
  }

  args.push("-");

  const promptInput = { ...input, hasImage: Boolean(input.image && input.image.base64) };
  const prompt = options.promptBuilder
    ? options.promptBuilder(promptInput)
    : buildPrompt(promptInput);

  await new Promise((resolve, reject) => {
    const child = spawn(codexExe, args, {
      cwd: root,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `codex exec failed with code ${code}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });

  const raw = await fsp.readFile(outputPath, "utf8");
  return JSON.parse(raw);
}

function splitCommandLine(value) {
  const input = String(value || "").trim();
  if (!input) return [];
  const parts = [];
  let current = "";
  let quote = "";
  let escape = false;
  for (const char of input) {
    if (escape) {
      current += char;
      escape = false;
      continue;
    }
    if (char === "\\") {
      escape = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

function parseJsonFromText(text) {
  const value = String(text || "").trim();
  if (!value) throw new Error("Claude CLI가 빈 응답을 반환했습니다.");
  try {
    return JSON.parse(value);
  } catch {
    const start = value.indexOf("{");
    const end = value.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(value.slice(start, end + 1));
    }
    throw new Error(`Claude CLI 응답에서 JSON을 찾지 못했습니다: ${value.slice(0, 240)}`);
  }
}

async function runClaudeCli(input, options = {}) {
  const aiSettings = appSettings.ai || {};
  const claudeCliExe = aiSettings.claudeCliExe || "claude";
  const claudeArgs = splitCommandLine(aiSettings.claudeCliArgs || "-p");
  const promptInput = { ...input, hasImage: Boolean(input.image && input.image.base64) };
  const prompt = options.promptBuilder
    ? options.promptBuilder(promptInput)
    : buildPrompt(promptInput);
  const finalPrompt = `${prompt}

중요: 반드시 위 스키마에 맞는 JSON 객체만 출력해라. 설명, 마크다운, 코드블록, 앞뒤 문장 금지.`;

  return await new Promise((resolve, reject) => {
    const child = spawn(claudeCliExe, [...claudeArgs, finalPrompt], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      shell: false
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(new Error(`Claude CLI 실행 실패: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || `Claude CLI failed with code ${code}`));
        return;
      }
      try {
        resolve(parseJsonFromText(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function buildDocx(input) {
  const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "cafe-docx-"));
  const inputPath = path.join(tempDir, "input.json");
  const filename = docxFilename(input);
  const outputPath = path.join(tempDir, filename);
  await fsp.writeFile(inputPath, JSON.stringify(input), "utf8");

  await new Promise((resolve, reject) => {
    const child = spawn(pythonExe, [path.join(root, "build_review_docx.py"), inputPath, outputPath], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `docx build failed with code ${code}`));
    });
  });

  return { outputPath, filename };
}

function parseCafeMenuUrl(rawUrl) {
  const parsed = new URL(String(rawUrl || "").trim());
  const match = parsed.pathname.match(/\/cafes\/(\d+)\/menus\/(\d+)/);
  if (!match) throw new Error("네이버 카페 f-e 게시판 URL을 입력해 주세요.");
  return {
    cafeId: match[1],
    menuId: match[2],
    startPage: Math.max(1, Number(parsed.searchParams.get("page") || 1) || 1),
    referer: parsed.toString()
  };
}

function parseCafeId(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (/^\d+$/.test(value)) return value;
  const parsed = new URL(value);
  const cafeMatch = parsed.pathname.match(/\/cafes\/(\d+)/);
  if (cafeMatch) return cafeMatch[1];
  const clubId = parsed.searchParams.get("clubid") || parsed.searchParams.get("clubId");
  if (clubId) return clubId;
  throw new Error("카페 URL에서 cafeId를 찾지 못했습니다.");
}

function formatKoreanDate(timestamp) {
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}.${month}.${day}.`;
}

function hourKst(timestamp) {
  const value = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    hour12: false
  }).format(new Date(Number(timestamp)));
  return Number(value.replace(/\D/g, "")) || 0;
}

function dateTimeKst(timestamp) {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(Number(timestamp)));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000, label = "요청") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`${label} 응답 지연: ${Math.round(timeoutMs / 1000)}초 안에 응답이 없어 중단했습니다.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWithRetry(url, options = {}, config = {}) {
  const {
    timeoutMs = 15000,
    label = "요청",
    retries = 1,
    onLog = () => {}
  } = config;
  let lastError = null;
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await fetchWithTimeout(url, options, timeoutMs, label);
    } catch (error) {
      lastError = error;
      if (attempt > retries) break;
      onLog(`${label} 실패: ${error.message} / ${attempt}회 재시도`);
      await delay(500);
    }
  }
  throw lastError;
}

function htmlToPlainText(html) {
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

function extractImageUrls(html) {
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

async function fetchNaverArticleDetail({ cafeId, articleId, referer }) {
  const apiUrl = `https://apis.naver.com/cafe-web/cafe-articleapi/v3/cafes/${cafeId}/articles/${articleId}`;
  const response = await fetch(apiUrl, {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0",
      "Referer": referer,
      "Origin": "https://cafe.naver.com"
    }
  });
  if (!response.ok) throw new Error(`네이버 글 상세 API 호출 실패: ${response.status}`);
  const json = await response.json();
  const article = json?.result?.article || json?.article || {};
  const contentHtml = article.contentHtml || article.content || "";
  return {
    content: htmlToPlainText(contentHtml),
    imageUrls: extractImageUrls(contentHtml)
  };
}

async function crawlNaverBoard(input) {
  const urls = String(input.url || "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (urls.length > 1) return crawlNaverBoards(input, urls);

  const { cafeId, menuId, startPage, referer } = parseCafeMenuUrl(input.url);
  const allPages = Boolean(input.allPages);
  const requestedPages = allPages ? Number(input.pages || 500) : Number(input.pages || 1);
  const pageLimit = Math.min(500, Math.max(1, requestedPages || 1));
  const includeContent = Boolean(input.includeContent);
  const rows = [];
  let crawledPages = 0;

  for (let index = 0; index < pageLimit; index += 1) {
    const page = startPage + index;
    const apiUrl = new URL(`https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/${cafeId}/menus/${menuId}/articles`);
    apiUrl.searchParams.set("page", String(page));

    const response = await fetch(apiUrl, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0",
        "Referer": referer,
        "Origin": "https://cafe.naver.com"
      }
    });

    if (!response.ok) {
      throw new Error(`네이버 게시판 API 호출 실패: ${response.status}`);
    }

    const json = await response.json();
    const articleList = json?.result?.articleList || [];
    const pageInfo = json?.result?.pageInfo || {};
    let articleCount = 0;
    for (const entry of articleList) {
      if (entry?.type !== "ARTICLE" || !entry.item) continue;
      const article = entry.item;
      articleCount += 1;
      rows.push({
        menuId,
        articleId: article.articleId,
        title: article.subject || "",
        comments: article.commentCount || 0,
        date: formatKoreanDate(article.writeDateTimestamp),
        views: article.readCount || 0,
        writer: article.writerInfo?.nickName || "",
        page,
        link: `https://cafe.naver.com/f-e/cafes/${cafeId}/articles/${article.articleId}`
      });
    }

    if (includeContent) {
      for (const row of rows.filter((item) => item.page === page && item.menuId === menuId)) {
        try {
          const detail = await fetchNaverArticleDetail({ cafeId, articleId: row.articleId, referer });
          row.content = detail.content;
          row.imageUrls = detail.imageUrls;
        } catch (error) {
          row.content = "";
          row.imageUrls = [];
          row.detailError = error.message || String(error);
        }
        await delay(90);
      }
    }
    crawledPages += 1;
    if (!allPages) continue;
    if (!articleCount) break;
    const lastNav = Number(pageInfo.lastNavigationPageNumber || page);
    if (page >= lastNav && pageInfo.visibleNextButton !== true) break;
    await delay(120);
  }

  rows.sort((a, b) => (b.views || 0) - (a.views || 0));
  return {
    ok: true,
    cafeId,
    menuId,
    startPage,
    pageCount: crawledPages,
    rows
  };
}

async function crawlNaverBoards(input, urls) {
  const rows = [];
  const reports = [];
  for (const url of urls) {
    const result = await crawlNaverBoard({
      ...input,
      url,
      allPages: input.allPages,
      pages: input.pages
    });
    rows.push(...result.rows);
    reports.push({
      cafeId: result.cafeId,
      menuId: result.menuId,
      startPage: result.startPage,
      pageCount: result.pageCount,
      articles: result.rows.length
    });
    await delay(250);
  }
  rows.sort((a, b) => (b.views || 0) - (a.views || 0));
  return {
    ok: true,
    multi: true,
    reports,
    startPage: reports[0]?.startPage || 1,
    pageCount: reports.reduce((sum, item) => sum + item.pageCount, 0),
    rows
  };
}

async function fetchCafePopularArticles(cafeId, onLog = () => {}) {
  onLog("인기글 API 호출 준비: WeeklyPopularArticleListV3");
  const apiUrl = new URL("https://apis.naver.com/cafe-web/cafe2/WeeklyPopularArticleListV3.json");
  apiUrl.searchParams.set("cafeId", String(cafeId));
  apiUrl.searchParams.set("mobileWeb", "true");
  apiUrl.searchParams.set("adUnit", "PC_CAFE_BOARD");
  apiUrl.searchParams.set("ad", "false");

  const response = await fetchWithRetry(apiUrl, {
    headers: {
      "Accept": "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0",
      "Referer": `https://cafe.naver.com/ca-fe/cafes/${cafeId}/popular`,
      "Origin": "https://cafe.naver.com"
    }
  }, {
    label: "인기글 API",
    timeoutMs: 20000,
    retries: 1,
    onLog
  });
  if (!response.ok) throw new Error(`인기글 API 호출 실패: ${response.status}`);
  const json = await response.json();
  const result = json?.message?.result || {};
  const items = result.articleList || [];
  onLog(`인기글 API 수집 완료: ${items.length.toLocaleString("ko-KR")}개`);
  return items.map((article) => ({
    articleId: article.articleId,
    title: article.subject || "",
    writer: article.writerNickname || article.nickname || "",
    writeDateTimestamp: article.writeDateTimestamp,
    hour: hourKst(article.writeDateTimestamp),
    dateTime: dateTimeKst(article.writeDateTimestamp),
    comments: article.commentCount || 0,
    likes: article.likeItCount || 0,
    views: article.readCount || 0,
    imageCount: article.imageAttachCount || article.imageCount || 0,
    link: `https://cafe.naver.com/f-e/cafes/${cafeId}/articles/${article.articleId}`
  }));
}

async function fetchCafeAllArticlesForDays(cafeId, days, maxPages, onLog = () => {}) {
  const since = Date.now() - Math.max(1, Number(days) || 7) * 24 * 60 * 60 * 1000;
  const pageLimit = Math.min(2000, Math.max(1, Number(maxPages) || 200));
  const rows = [];
  let truncated = false;
  onLog(`전체글 수집 시작: 최근 ${days}일 / 최대 ${pageLimit}페이지`);

  for (let page = 1; page <= pageLimit; page += 1) {
    const apiUrl = new URL(`https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/${cafeId}/menus/0/articles`);
    apiUrl.searchParams.set("page", String(page));
    const response = await fetchWithRetry(apiUrl, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0",
        "Referer": `https://cafe.naver.com/f-e/cafes/${cafeId}/menus/0`,
        "Origin": "https://cafe.naver.com"
      }
    }, {
      label: `전체글 ${page}페이지 API`,
      timeoutMs: 15000,
      retries: 1,
      onLog
    });
    if (!response.ok) throw new Error(`전체글 API 호출 실패: ${response.status}`);
    const json = await response.json();
    const articleList = (json?.result?.articleList || []).filter((entry) => entry?.type === "ARTICLE" && entry.item);
    if (!articleList.length) {
      onLog(`전체글 ${page}페이지: 게시글 없음, 수집 종료`);
      break;
    }

    let reachedOlder = false;
    for (const entry of articleList) {
      const article = entry.item;
      const timestamp = Number(article.writeDateTimestamp || 0);
      if (timestamp && timestamp < since) {
        reachedOlder = true;
        continue;
      }
      rows.push({
        articleId: article.articleId,
        title: article.subject || "",
        menuId: article.menuId || 0,
        menuName: article.menuName || "",
        writer: article.writerInfo?.nickName || "",
        writeDateTimestamp: timestamp,
        hour: hourKst(timestamp),
        dateTime: dateTimeKst(timestamp),
        comments: article.commentCount || 0,
        likes: article.likeCount || 0,
        views: article.readCount || 0,
        popular: Boolean(article.popular),
        link: `https://cafe.naver.com/f-e/cafes/${cafeId}/articles/${article.articleId}`
      });
    }
    const percent = Math.min(100, Math.round((page / pageLimit) * 100));
    onLog(`전체글 ${page}/${pageLimit}페이지 수집 완료 (${percent}%) / 누적 ${rows.length.toLocaleString("ko-KR")}개`);
    if (reachedOlder) {
      onLog(`최근 ${days}일 범위를 벗어난 글을 만나 수집 종료`);
      break;
    }
    if (page === pageLimit) {
      truncated = true;
      onLog(`최대 수집 페이지 ${pageLimit}페이지에 도달: 더 오래된 글이 일부 남았을 수 있음`);
    }
    await delay(80);
  }

  onLog(`전체글 수집 완료: ${rows.length.toLocaleString("ko-KR")}개`);
  return { rows, truncated, since };
}

async function analyzePopularTime(input, onLog = () => {}) {
  const cafeId = parseCafeId(input.url || input.cafeId || "23611966");
  const days = Math.max(1, Number(input.days || 7) || 7);
  const maxPages = Math.max(1, Number(input.maxPages || 300) || 300);
  onLog(`분석 대상 cafeId 확인: ${cafeId}`);
  const [popularRows, allResult] = await Promise.all([
    fetchCafePopularArticles(cafeId, onLog),
    fetchCafeAllArticlesForDays(cafeId, days, maxPages, onLog)
  ]);
  const allRows = allResult.rows;
  onLog("인기글과 전체글 articleId 매칭 시작");
  const allById = new Map(allRows.map((row) => [String(row.articleId), row]));
  const popularInRange = [];

  for (const row of popularRows) {
    const allRow = allById.get(String(row.articleId));
    if (!allRow) continue;
    popularInRange.push({
      ...row,
      views: allRow.views,
      menuName: allRow.menuName,
      comments: allRow.comments,
      likes: allRow.likes
    });
  }
  onLog(`매칭 완료: 현재 인기글 ${popularRows.length.toLocaleString("ko-KR")}개 중 기간 내 전체글과 매칭된 글 ${popularInRange.length.toLocaleString("ko-KR")}개`);

  const hours = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00-${String(hour).padStart(2, "0")}:59`,
    totalPosts: 0,
    popularPosts: 0,
    totalViews: 0,
    popularViews: 0,
    totalComments: 0,
    popularComments: 0
  }));

  for (const row of allRows) {
    const item = hours[row.hour];
    item.totalPosts += 1;
    item.totalViews += row.views || 0;
    item.totalComments += row.comments || 0;
  }
  for (const row of popularInRange) {
    const item = hours[row.hour];
    item.popularPosts += 1;
    item.popularViews += row.views || 0;
    item.popularComments += row.comments || 0;
  }

  const hourly = hours.map((item) => ({
    ...item,
    conversionRate: item.totalPosts ? item.popularPosts / item.totalPosts : 0,
    avgViews: item.totalPosts ? item.totalViews / item.totalPosts : 0,
    avgPopularViews: item.popularPosts ? item.popularViews / item.popularPosts : 0,
    avgComments: item.totalPosts ? item.totalComments / item.totalPosts : 0,
    avgPopularComments: item.popularPosts ? item.popularComments / item.popularPosts : 0
  }));
  const candidates = hourly.filter((item) => item.totalPosts >= 10);
  const bestByConversion = [...candidates].sort((a, b) => b.conversionRate - a.conversionRate)[0] || null;
  const bestByViews = [...candidates].sort((a, b) => b.avgViews - a.avgViews)[0] || null;
  const topPopular = popularInRange
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 15);
  onLog("시간대별 전환율/평균 조회 계산 완료");

  return {
    ok: true,
    cafeId,
    days,
    maxPages,
    truncated: allResult.truncated,
    allCount: allRows.length,
    popularCount: popularInRange.length,
    popularFetched: popularRows.length,
    bestByConversion,
    bestByViews,
    hourly,
    topPopular,
    rawPopularRows: popularRows,
    rawMatchedPopularRows: popularInRange,
    rawAllRows: allRows
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");

  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/cafe_viral_generator.html")) {
      const html = await fsp.readFile(path.join(root, "cafe_viral_generator.html"), "utf8");
      return send(res, 200, html, "text/html; charset=utf-8");
    }

    if (req.method === "GET" && url.pathname.startsWith("/data/")) {
      return await sendStaticDataFile(url.pathname, res);
    }

    if (req.method === "GET" && url.pathname === "/app-settings") {
      appSettings = readAppSettings();
      return send(res, 200, appSettings);
    }

    if (req.method === "POST" && url.pathname === "/app-settings") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const saved = await saveAppSettings(input);
      return send(res, 200, saved);
    }

    if (req.method === "POST" && url.pathname === "/analyze-source-codex") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const result = await runCodex(input, {
        schema: "codex_source_analysis_schema.json",
        promptBuilder: buildSourceAnalysisPrompt
      });
      return send(res, 200, result);
    }
    if (req.method === "POST" && url.pathname === "/generate-codex") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const result = await runCodex(input);
      return send(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/generate-claude-cli") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const result = await runClaudeCli(input);
      return send(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/generate-codex-titles") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const result = await runCodex(input, {
        schema: "codex_title_schema.json",
        promptBuilder: buildTitlePrompt
      });
      return send(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/generate-claude-cli-titles") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const result = await runClaudeCli(input, {
        promptBuilder: buildTitlePrompt
      });
      return send(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/generate-codex-draft") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const result = await runCodex(input, {
        schema: "codex_draft_schema.json",
        promptBuilder: buildDraftPrompt
      });
      return send(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/generate-claude-cli-draft") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const result = await runClaudeCli(input, {
        promptBuilder: buildDraftPrompt
      });
      return send(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/save-edit") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const dataDir = path.join(root, "data");
      await fsp.mkdir(dataDir, { recursive: true });
      const record = {
        savedAt: new Date().toISOString(),
        ...input
      };
      await fsp.appendFile(
        path.join(dataDir, "edited_posts.jsonl"),
        `${JSON.stringify(record)}\n`,
        "utf8"
      );
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/save-generation") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const dataDir = path.join(root, "data");
      await fsp.mkdir(dataDir, { recursive: true });
      const record = {
        savedAt: new Date().toISOString(),
        ...input
      };
      await fsp.appendFile(
        path.join(dataDir, "generated_posts.jsonl"),
        `${JSON.stringify(record)}\n`,
        "utf8"
      );
      return send(res, 200, { ok: true });
    }

    if (req.method === "POST" && url.pathname === "/crawl-board") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const result = await crawlNaverBoard(input);
      return send(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/analyze-popular-time") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const result = await analyzePopularTime(input);
      return send(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/analyze-popular-time-stream") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "no-store"
      });
      const writeLine = (payload) => res.write(`${JSON.stringify(payload)}\n`);
      try {
        writeLine({ type: "log", message: "인기글 시간대 분석 작업 시작" });
        const result = await analyzePopularTime(input, (message) => {
          writeLine({ type: "log", message });
        });
        writeLine({ type: "result", data: result });
      } catch (error) {
        writeLine({ type: "error", message: error.message || String(error) });
      }
      return res.end();
    }

    if (req.method === "POST" && url.pathname === "/download-docx") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const { outputPath, filename } = await buildDocx(input);
      const buffer = await fsp.readFile(outputPath);
      res.writeHead(200, {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Access-Control-Allow-Origin": "*"
      });
      return res.end(buffer);
    }

    if (req.method === "POST" && url.pathname === "/youtube-source") {
      const body = await readBody(req);
      const input = JSON.parse(body || "{}");
      const result = await extractYoutubeSource(input);
      return send(res, 200, result);
    }

    return send(res, 404, { error: "not found" });
  } catch (error) {
    return send(res, 500, { error: error.message || String(error) });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Cafe viral generator running at http://127.0.0.1:${port}/`);
});












