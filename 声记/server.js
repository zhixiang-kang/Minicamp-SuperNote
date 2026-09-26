const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 5173);
const asrUrl = process.env.ASR_API_URL || "https://api.openai.com/v1/audio/transcriptions";
const asrKey = process.env.ASR_API_KEY || process.env.OPENAI_API_KEY || "";
const asrModel = process.env.ASR_MODEL || "whisper-1";
const repairUrl = process.env.REPAIR_API_URL || process.env.OPENAI_API_URL || "https://api.openai.com/v1/chat/completions";
const repairKey = process.env.REPAIR_API_KEY || process.env.OPENAI_API_KEY || "";
const repairModel = process.env.REPAIR_MODEL || "gpt-4o-mini";
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

function sendJson(res, status, body) {
  const output = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(output);
}

function readBody(req, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) { reject(new Error("音频文件不能超过 25 MB")); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function transcribe(req, res) {
  if (!asrKey) {
    sendJson(res, 503, { error: "未配置多语种 ASR。请设置 ASR_API_KEY 或 OPENAI_API_KEY，并重启声记服务。" });
    return;
  }
  try {
    const audio = await readBody(req);
    if (!audio.length) { sendJson(res, 400, { error: "没有收到音频" }); return; }
    const form = new FormData();
    form.append("file", new Blob([audio], { type: req.headers["content-type"] || "audio/webm" }), "voice.webm");
    form.append("model", asrModel);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    const upstream = await fetch(asrUrl, { method: "POST", headers: { Authorization: `Bearer ${asrKey}` }, body: form });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) { sendJson(res, upstream.status, { error: payload.error?.message || "多语种 ASR 请求失败" }); return; }
    const rawText = payload.text || "";
    const repaired = await repairText(rawText, payload.language || null, payload.segments || []);
    sendJson(res, 200, { text: repaired.text, raw_text: rawText, language: payload.language || null, segments: payload.segments || [], repair: repaired });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "多语种 ASR 服务异常" });
  }
}

function conservativeRepair(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").replace(/([。！？!?])\1+/g, "$1").trim();
  const uncertain = [];
  const unclearPattern = /(?:\[?(?:inaudible|unclear|听不清|听不清楚|无法识别|不清楚)\]?|\?{2,}|…{2,})/giu;
  let match;
  while ((match = unclearPattern.exec(normalized))) uncertain.push({ text: match[0], reason: "原始识别不清，缺少足够上下文" });
  return { text: normalized, changes: normalized === text ? [] : ["清理重复空格和重复标点"], uncertain, usedModel: false };
}

async function repairText(text, language, segments) {
  const fallback = conservativeRepair(text);
  if (!text || !repairKey) return fallback;
  const system = "你是严格的语音转写校对器。只根据上下文修复高置信度的漏字、断句、同音错字和口头重复。禁止编造人名、数字、日期、金额、地点、任务或结论；无法确定时保留原文并用[听不清]标记。保持原语言和混合语言，不翻译。只返回JSON：{text:string,changes:string[],uncertain:string[] }。";
  const user = JSON.stringify({ language, transcript: text, segments: segments.slice(0, 100) });
  try {
    const upstream = await fetch(repairUrl, { method: "POST", headers: { Authorization: `Bearer ${repairKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: repairModel, temperature: 0, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }) });
    const payload = await upstream.json().catch(() => ({}));
    if (!upstream.ok) return fallback;
    const content = payload.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    if (typeof parsed.text !== "string" || !parsed.text.trim()) return fallback;
    return { text: parsed.text.trim(), changes: Array.isArray(parsed.changes) ? parsed.changes.slice(0, 5) : [], uncertain: Array.isArray(parsed.uncertain) ? parsed.uncertain.slice(0, 10) : [], usedModel: true };
  } catch {
    return fallback;
  }
}

const server = http.createServer((req, res) => {
  const requestPath = decodeURIComponent(req.url.split("?")[0]);
  if (req.method === "GET" && requestPath === "/api/asr-status") {
    sendJson(res, 200, { configured: Boolean(asrKey), provider: asrUrl, model: asrModel, contextRepairConfigured: Boolean(repairKey), repairProvider: repairUrl, repairModel });
    return;
  }
  if (req.method === "POST" && requestPath === "/api/repair") {
    readBody(req, 512 * 1024).then((body) => {
      const input = JSON.parse(body.toString("utf8") || "{}");
      return repairText(input.text || "", input.language || null, Array.isArray(input.segments) ? input.segments : []);
    }).then((result) => sendJson(res, 200, { repair: result })).catch((error) => sendJson(res, 400, { error: error.message || "上下文修复失败" }));
    return;
  }
  if (req.method === "POST" && requestPath === "/api/transcribe") { transcribe(req, res); return; }
  if (req.method !== "GET") { sendJson(res, 405, { error: "Method not allowed" }); return; }
  const filePath = path.resolve(root, requestPath === "/" ? "index.html" : `.${requestPath}`);
  if (!filePath.startsWith(root) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) { res.writeHead(404); res.end("Not found"); return; }
  res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(port, "127.0.0.1", () => console.log(`声记已启动：http://127.0.0.1:${port}`));
