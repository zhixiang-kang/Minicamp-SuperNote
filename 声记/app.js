const STORAGE_KEY = "voice-notes-records-v1";
const demoRecords = [
  { id: "demo-1", title: "产品周会 · 版本发布计划", summary: "团队确认了新版本的发布日期和上线前测试范围。", time: "今天 10:24", duration: "28:16", tag: "工作会议", type: "peach", icon: "◒", keyPoints: ["版本预计本周五进行灰度发布", "测试需要覆盖登录、支付和消息推送流程", "市场团队将在发布后同步更新帮助文档"], actions: ["李然：完成支付流程回归测试 · 周三前", "王雪：准备发布公告和帮助文档 · 周四前"], decisions: ["本周五下午 3 点开始灰度发布"], transcript: "这次主要同步一下版本进度。现在核心功能已经完成，剩下登录和支付流程的回归测试。大家确认一下，按照当前进度，我们计划周五下午进行灰度发布。市场侧需要提前准备公告和帮助文档。", demo: true },
  { id: "demo-2", title: "播客摘录 · 创造力与长期主义", summary: "关于如何建立稳定创作系统，以及如何用小步迭代保持长期动力。", time: "昨天 18:42", duration: "42:08", tag: "灵感收藏", type: "mint", icon: "◉", keyPoints: ["稳定的创作节奏比偶尔的灵感更重要", "把大目标拆成每周可以完成的小实验", "定期复盘作品，而不是只关注最终结果"], actions: [], decisions: [], transcript: "很多时候我们把创造力想象成一种突然发生的状态，但真正长期有效的方式，是把创作变成一个稳定的系统。每周完成一个小实验，持续复盘，慢慢就能积累出自己的方法。", demo: true },
  { id: "demo-3", title: "用户访谈 · 新手上手体验", summary: "受访者认为首次使用时最需要的是清晰的引导和即时反馈。", time: "2026/09/23", duration: "19:34", tag: "用户研究", type: "lavender", icon: "◌", keyPoints: ["用户希望上传后立即看到处理进度", "重点内容需要可以回到原音频位置", "导出分享是高频需求"], actions: ["设计：增加首次使用引导流程"], decisions: [], transcript: "如果上传以后完全没有反馈，用户会以为程序没有响应。最好能看到清晰的处理进度。另外重点最好可以点击后直接跳回音频对应的位置。", demo: true }
];

let records = loadRecords();
let selectedAudio = null;
let mediaRecorder = null;
let recordingChunks = [];
let recordingStartedAt = 0;
let timerHandle = null;
const $ = (selector) => document.querySelector(selector);

function loadRecords() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || demoRecords; } catch { return demoRecords; }
}
function saveRecords() { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("show"), 2800); }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }

function renderRecords(filter = "") {
  const query = filter.trim().toLowerCase();
  const visible = records.filter((record) => !query || [record.title, record.summary, record.tag, ...(record.keyPoints || [])].join(" ").toLowerCase().includes(query));
  $("#recordCount").textContent = records.length;
  $("#recordsGrid").innerHTML = visible.map((record) => `
    <article class="record-card">
      <div class="card-top"><div class="record-type type-${escapeHtml(record.type || "lavender")}">${escapeHtml(record.icon || "◌")}</div><time>${escapeHtml(record.time)}</time></div>
      <h3>${escapeHtml(record.title)}</h3><p class="summary">${escapeHtml(record.summary)}</p>
      <div class="card-footer"><span class="tag">${escapeHtml(record.tag || "音频记录")}</span><span>${escapeHtml(record.duration || "--:--")}</span><button class="open-card" data-record-id="${escapeHtml(record.id)}" aria-label="打开记录">→</button></div>
    </article>`).join("");
  $("#emptyState").style.display = visible.length ? "none" : "block";
  document.querySelectorAll(".open-card").forEach((button) => button.addEventListener("click", () => openRecord(button.dataset.recordId)));
}

function openRecord(id) {
  const record = records.find((item) => item.id === id); if (!record) return;
  const audioMarkup = record.audioUrl ? `<audio class="dialog-audio" controls src="${record.audioUrl}"></audio>` : `<div class="dialog-audio muted-audio">演示记录：连接语音识别服务后，这里会显示原始音频。</div>`;
  $("#dialogContent").innerHTML = `<div class="dialog-kicker">${escapeHtml(record.tag || "音频记录")}</div><h2>${escapeHtml(record.title)}</h2><div class="dialog-meta">${escapeHtml(record.time)} · ${escapeHtml(record.duration || "--:--")}</div>${audioMarkup}<section class="dialog-block"><h3>摘要</h3><p>${escapeHtml(record.summary)}</p></section><section class="dialog-block"><h3>关键重点</h3><ul>${(record.keyPoints || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>${record.actions?.length ? `<section class="dialog-block"><h3>待办事项</h3><ul>${record.actions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>` : ""}${record.decisions?.length ? `<section class="dialog-block"><h3>已确定事项</h3><ul>${record.decisions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>` : ""}<section class="dialog-block"><h3>转写预览</h3><p>${escapeHtml(record.transcript || "暂无转写内容")}</p></section>`;
  $("#detailDialog").showModal();
}

function formatDuration(seconds) { if (!Number.isFinite(seconds)) return "--:--"; const mins = Math.floor(seconds / 60); const secs = Math.floor(seconds % 60).toString().padStart(2, "0"); return `${mins}:${secs}`; }
function processAudio(file, fromRecording = false) {
  selectedAudio = file;
  const objectUrl = URL.createObjectURL(file);
  const audio = new Audio(objectUrl);
  audio.addEventListener("loadedmetadata", () => {
    const title = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ") || "未命名音频";
    const record = { id: `record-${Date.now()}`, title, summary: "音频已接收。当前为本地演示模式，接入 ASR 与大模型服务后会自动生成真实摘要。", time: "刚刚", duration: formatDuration(audio.duration), tag: fromRecording ? "我的录音" : "新上传", type: fromRecording ? "mint" : "peach", icon: fromRecording ? "◉" : "◒", keyPoints: ["已完成音频接收", "下一步将进行语音转写", "转写完成后提取重点与待办"], actions: ["接入后端语音识别服务", "配置摘要模型与结构化输出"], decisions: [], transcript: "演示模式暂未连接语音识别服务。请在 app.js 的 processAudio 中接入后端 API。", audioUrl: objectUrl };
    records = [record, ...records]; saveRecords(); renderRecords($("#searchInput").value); openRecord(record.id); showToast("音频已添加，正在准备智能整理");
  }, { once: true });
}

async function toggleRecording() {
  if (mediaRecorder?.state === "recording") { mediaRecorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { showToast("当前浏览器不支持录音，请改用上传音频"); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordingChunks = []; mediaRecorder = new MediaRecorder(stream); recordingStartedAt = Date.now();
    mediaRecorder.addEventListener("dataavailable", (event) => recordingChunks.push(event.data));
    mediaRecorder.addEventListener("stop", () => { stream.getTracks().forEach((track) => track.stop()); clearInterval(timerHandle); $("#recordButton").innerHTML = '<span class="record-dot"></span> 开始录音'; const blob = new Blob(recordingChunks, { type: mediaRecorder.mimeType || "audio/webm" }); processAudio(new File([blob], `我的录音-${new Date().toISOString().slice(0, 10)}.webm`, { type: blob.type }), true); });
    mediaRecorder.start(); $("#recordButton").innerHTML = '<span class="record-dot recording"></span> 停止录音 00:00'; timerHandle = setInterval(() => { const elapsed = Math.floor((Date.now() - recordingStartedAt) / 1000); $("#recordButton").innerHTML = `<span class="record-dot recording"></span> 停止录音 ${formatDuration(elapsed)}`; }, 1000);
  } catch { showToast("无法访问麦克风，请检查浏览器权限"); }
}

$("#uploadButton").addEventListener("click", () => $("#fileInput").click()); $("#emptyUploadButton").addEventListener("click", () => $("#fileInput").click()); $("#newNoteButton").addEventListener("click", () => $("#fileInput").click()); $("#fileInput").addEventListener("change", (event) => { const [file] = event.target.files; if (file) processAudio(file); event.target.value = ""; }); $("#recordButton").addEventListener("click", toggleRecording); $("#searchInput").addEventListener("input", (event) => renderRecords(event.target.value)); $("#dialogClose").addEventListener("click", () => $("#detailDialog").close()); $("#detailDialog").addEventListener("click", (event) => { if (event.target === $("#detailDialog")) $("#detailDialog").close(); }); $("#sortButton").addEventListener("click", () => { records.reverse(); saveRecords(); renderRecords($("#searchInput").value); showToast("排序已更新"); });
renderRecords();

// 浏览器原生语音识别：实时把用户说的话转成文字，并用轻量规则提取重点。
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let speechRecognition = null;
let speechFinalText = "";
let speechInterimText = "";
let speechIsListening = false;
let multiLanguageRecorder = null;
let multiLanguageStream = null;
let multiLanguageChunks = [];
let multiLanguageBusy = false;

function splitSentences(text) {
  return text.replace(/\s+/g, " ").split(/[。！？!?；;\n]+|(?<=[.!?])\s+/u).map((item) => item.trim()).filter(Boolean);
}

function cleanSentence(text) {
  return text.replace(/^(嗯+|呃+|那个|然后|所以|就是|like|um+|uh+|well|so|basically)[，,、\s:]*/iu, "").replace(/[，,、\s]+$/u, "").trim();
}

function compactSentence(text, maxLength = 72) {
  const cleaned = cleanSentence(text).replace(/(我想说的是|我觉得|大家都知道|就是说|基本上|in my opinion|I think|you know|basically)/giu, "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, maxLength - 1).trim()}…`;
}

function uniqueCompact(items, maxItems = Infinity) {
  const seen = new Set();
  return items.map((item) => compactSentence(item)).filter((item) => item.length >= 3 && !seen.has(item) && seen.add(item)).slice(0, maxItems);
}

const algorithmPattern = /(算法|贪心|贪心算法|动态规划|动态规划算法|分治|分治法|递归|递推|回溯|剪枝|二分查找|二分搜索|排序|快速排序|归并排序|堆排序|插入排序|选择排序|广度优先|深度优先|遍历|最短路径|最小生成树|并查集|拓扑排序|网络流|字符串匹配|哈希|哈希表|数据结构|数组|链表|栈|队列|堆|树|二叉树|平衡树|红黑树|字典树|图|复杂度|时间复杂度|空间复杂度|渐进复杂度|最优子结构|重叠子问题|状态转移|状态压缩|单调栈|单调队列|双指针|滑动窗口|greedy|dynamic programming|divide and conquer|recursion|recursive|backtracking|pruning|binary search|sorting|quicksort|merge sort|heap sort|breadth-first|depth-first|traversal|shortest path|minimum spanning tree|union-find|topological sort|network flow|string matching|hash table|data structure|array|linked list|stack|queue|heap|tree|graph|time complexity|space complexity|big[- ]?o|optimal substructure|overlapping subproblems|state transition|memoization|monotonic stack|two pointers|sliding window)/iu;
const academicPattern = new RegExp(`(?:定义|指的是|意味着|理论|概念|原理|机制|模型|框架|假设|命题|定理|公理|变量|自变量|因变量|相关性|因果|方法|方法论|实验|样本|数据|统计|显著|结果|发现|证据|结论|研究表明|文献|引用|参考文献|论文|学术|推导|公式|方程|定性|定量|实验组|对照组|基线|误差|置信区间|p值|effect size|definition|theory|concept|principle|mechanism|model|framework|hypothesis|proposition|theorem|variable|causal|methodology|experiment|sample|data|statistical|significant|result|evidence|conclusion|study shows|literature|citation|equation|formula|qualitative|quantitative|control group|baseline|confidence interval|correlation|causation|${algorithmPattern.source})`, "iu");
const academicLabelPattern = new RegExp(`(?:定义|理论|概念|原理|机制|模型|假设|变量|因果|方法|实验|数据|统计|结果|证据|结论|文献|公式|definition|theory|concept|principle|mechanism|model|hypothesis|variable|causal|method|experiment|data|statistic|result|evidence|conclusion|literature|equation|formula|${algorithmPattern.source})`, "iu");
let learningKnowledgePattern = algorithmPattern;
let learningKnowledgeCategories = [];

async function loadLearningKnowledge() {
  try {
    const response = await fetch("knowledge-db.json", { cache: "no-store" });
    if (!response.ok) return;
    const database = await response.json();
    const entries = Object.entries(database.categories || {});
    learningKnowledgeCategories = entries;
    const terms = entries.flatMap(([, values]) => values).filter((term) => term.length >= 2).sort((a, b) => b.length - a.length).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (terms.length) learningKnowledgePattern = new RegExp(terms.join("|"), "iu");
    $("#liveHint").textContent = `已加载 ${terms.length} 个学习知识术语；识别到相关内容会自动标为重点。`;
  } catch {
    // 知识库不可用时继续使用内置算法与学术词库。
  }
}

function knowledgeCategory(text) {
  for (const [category, terms] of learningKnowledgeCategories) if (terms.some((term) => text.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) return category;
  if (algorithmPattern.test(text)) return "算法与数据结构";
  return "";
}

function extractHighlights(text) {
  const sentences = splitSentences(text);
  const language = $("#languageSelect")?.value || "zh-CN";
  const signalMap = {
    zh: /(重点|关键|核心|需要|要做|必须|请|待办|任务|决定|确定|计划|目标|截止|时间|问题|结论|希望|记得|提醒)/i,
    en: /(important|key|core|need|must|action|task|decide|decision|plan|goal|deadline|problem|conclusion|remember|reminder)/i,
    es: /(importante|clave|necesario|debe|tarea|decidir|decisión|plan|objetivo|fecha límite|problema|conclusión|recordar)/i,
    hi: /(महत्वपूर्ण|मुख्य|ज़रूरी|करना|कार्य|निर्णय|योजना|लक्ष्य|समय सीमा|समस्या|निष्कर्ष)/i,
    ar: /(مهم|أساسي|يجب|مهمة|قرار|خطة|هدف|موعد|مشكلة|خلاصة|تذكير)/i,
    pt: /(importante|principal|precisa|deve|tarefa|decisão|plano|objetivo|prazo|problema|conclusão|lembrar)/i,
    bn: /(গুরুত্বপূর্ণ|মূল|প্রয়োজন|কাজ|সিদ্ধান্ত|পরিকল্পনা|লক্ষ্য|সময়সীমা|সমস্যা|উপসংহার)/i,
    ru: /(важно|ключевой|нужно|должен|задача|решение|план|цель|срок|проблема|вывод|напомнить)/i,
    ur: /(اہم|ضروری|کام|فیصلہ|منصوبہ|مقصد|آخری تاریخ|مسئلہ|نتیجہ|یاد رکھیں)/i,
    id: /(penting|utama|perlu|harus|tugas|keputusan|rencana|tujuan|batas waktu|masalah|kesimpulan|ingat)/i,
    fr: /(important|clé|nécessaire|doit|tâche|décision|plan|objectif|échéance|problème|conclusion|rappel)/i,
    de: /(wichtig|Schlüssel|muss|Aufgabe|Entscheidung|Plan|Ziel|Frist|Problem|Fazit|merken)/i,
    ja: /(重要|要点|必要|必ず|タスク|決定|計画|目標|締切|問題|結論|覚えて)/i,
    ko: /(중요|핵심|필요|해야|작업|결정|계획|목표|마감|문제|결론|기억)/i,
    tr: /(önemli|anahtar|gerekli|zorunda|görev|karar|plan|hedef|son tarih|sorun|sonuç|hatırla)/i
  };
  const signals = language === "auto" ? new RegExp(Object.values(signalMap).map((item) => item.source).join("|"), "iu") : (signalMap[language.split("-")[0]] || signalMap.en);
  const priority = /(\d+[%％]?|\b\d{1,2}[:：]\d{2}\b|今天|明天|本周|下周|截止|deadline|due|urgent|紧急|必须|必須|مهم|важно|重要|핵심)/iu;
  const scored = sentences.map((sentence, index) => {
    let score = 0;
    const algorithm = algorithmPattern.test(sentence);
    const learning = learningKnowledgePattern.test(sentence);
    const academic = academicPattern.test(sentence);
    if (signals.test(sentence)) score += 4;
    if (priority.test(sentence)) score += 3;
    if (academic) score += 8;
    if (algorithm) score += 5;
    if (learning) score += 12;
    if (sentence.length >= 12) score += 1;
    if (sentence.length > 130) score -= 1;
    return { sentence, score, index, academic, algorithm, learning };
  }).filter((item) => item.score >= 3).sort((a, b) => b.score - a.score || a.index - b.index);
  const learningItems = uniqueCompact(scored.filter((item) => item.learning).map((item) => item.sentence));
  const academicItems = uniqueCompact(scored.filter((item) => item.academic && !item.learning).map((item) => item.sentence));
  const otherItems = uniqueCompact(scored.filter((item) => !item.academic && !item.learning).map((item) => item.sentence));
  return [...learningItems, ...academicItems, ...otherItems];
}

function summarizeText(text) {
  const sentences = splitSentences(text);
  const highlights = extractHighlights(text);
  const actionPattern = /(需要|要做|必须|待办|任务|截止|行动|action|need|must|task|deadline|tarea|debe|tâche|muss|Aufgabe|कार्य|مهمة|タスク|해야|작업)/iu;
  const decisionPattern = /(决定|确定|计划|目标|结论|decision|decide|plan|goal|conclusion|decisión|plan|objetivo|решение|план|قرار|خطة|決定|計画|결정|계획)/iu;
  const actions = uniqueCompact(sentences.filter((item) => actionPattern.test(item)));
  const decisions = uniqueCompact(sentences.filter((item) => decisionPattern.test(item)));
  const summaryParts = highlights.length ? highlights.slice(0, 2) : uniqueCompact(sentences, 2);
  const summary = summaryParts.join("；") || "等待更多内容后生成总结。";
  const academicKnowledge = uniqueCompact(sentences.filter((item) => academicPattern.test(item)));
  const algorithmKnowledge = uniqueCompact(sentences.filter((item) => algorithmPattern.test(item)));
  const learningKnowledge = uniqueCompact(sentences.filter((item) => learningKnowledgePattern.test(item)));
  return { summary, highlights, actions, decisions, academicKnowledge, algorithmKnowledge, learningKnowledge };
}

function renderSpeech() {
  const transcriptBox = $("#transcriptOutput");
  const fullText = `${speechFinalText}${speechInterimText}`.trim();
  transcriptBox.innerHTML = fullText ? escapeHtml(fullText) : '<span class="transcript-placeholder">点击“开始说话”，然后自然地说出你的内容……</span>';
  const result = summarizeText(speechFinalText || fullText);
  const highlights = result.highlights;
  $("#focusCount").textContent = `${highlights.length} 条`;
  $("#liveHighlights").innerHTML = highlights.length ? highlights.map((item) => { const category = knowledgeCategory(item); const isAlgorithm = algorithmPattern.test(item); const isAcademic = academicLabelPattern.test(item); return `<li class="${isAcademic ? "academic-highlight" : ""} ${isAlgorithm ? "algorithm-highlight" : ""} ${category ? "knowledge-highlight" : ""}">${category ? `<b>${escapeHtml(category)}</b> ` : (isAlgorithm ? '<b>算法知识</b> ' : (isAcademic ? '<b>学术知识</b> ' : ""))}${escapeHtml(item)}</li>`; }).join("") : '<li class="highlights-empty">说话后，重点会显示在这里</li>';
  $("#liveSummary").textContent = result.summary;
  $("#liveActions").textContent = result.actions[0] || "—";
  $("#liveDecisions").textContent = result.decisions[0] || "—";
  $("#saveLiveButton").disabled = !fullText;
}

function setSpeechButton(listening) {
  speechIsListening = listening;
  const button = $("#speechButton");
  button.classList.toggle("is-listening", listening);
  button.innerHTML = listening ? '<span>■</span> 停止说话' : '<span>●</span> 开始说话';
  $("#speechStatus").textContent = listening ? "正在聆听…" : "准备就绪";
}

async function checkAsrStatus() {
  try {
    const response = await fetch("/api/asr-status");
    const status = await response.json();
    const badge = $("#asrStatus");
    if (status.configured && status.contextRepairConfigured) {
      badge.textContent = "● 多语种识别与 OpenDev 修复已连接";
      badge.classList.add("asr-status-ready");
      $("#liveHint").textContent = "自动识别模式会检测同一段话中的多种语言，并在停止后整理结果。";
    } else if (status.contextRepairConfigured) {
      badge.textContent = "● OpenDev 上下文修复已连接 · ASR 未配置";
      badge.classList.add("asr-status-ready");
      $("#liveHint").textContent = "OpenDev 已负责上下文修复和重点总结；自动混合语言转写仍需单独配置 Whisper 兼容 ASR。";
    } else {
      badge.textContent = "● 多语种服务未配置";
      badge.classList.add("asr-status-missing");
      $("#liveHint").textContent = "自动识别需要配置 Whisper 兼容 ASR 服务；固定语言模式仍可直接使用浏览器识别。";
    }
  } catch {
    $("#asrStatus").textContent = "● 本地服务未连接";
    $("#asrStatus").classList.add("asr-status-missing");
  }
}

async function startMultiLanguageCapture() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    showToast("当前浏览器不支持音频录制，请使用最新版 Chrome 或 Edge");
    return;
  }
  try {
    multiLanguageStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    multiLanguageChunks = [];
    multiLanguageRecorder = new MediaRecorder(multiLanguageStream, { mimeType: "audio/webm;codecs=opus" });
    multiLanguageRecorder.addEventListener("dataavailable", (event) => { if (event.data.size) multiLanguageChunks.push(event.data); });
    multiLanguageRecorder.addEventListener("stop", transcribeMultiLanguageAudio, { once: true });
    multiLanguageRecorder.start(1000);
    setSpeechButton(true);
    $("#speechStatus").textContent = "正在录音 · 停止后自动检测语言";
    $("#asrStatus").textContent = "● 正在采集混合语言音频";
  } catch (error) {
    multiLanguageStream?.getTracks().forEach((track) => track.stop());
    multiLanguageStream = null;
    showToast(`无法开始多语种录音：${error.message || "请检查麦克风权限"}`);
  }
}

async function transcribeMultiLanguageAudio() {
  multiLanguageBusy = true;
  setSpeechButton(false);
  $("#speechStatus").textContent = "正在检测语言并转写…";
  $("#asrStatus").textContent = "● 多语种 ASR 处理中";
  multiLanguageStream?.getTracks().forEach((track) => track.stop());
  multiLanguageStream = null;
  try {
    const audioBlob = new Blob(multiLanguageChunks, { type: "audio/webm;codecs=opus" });
    if (audioBlob.size < 1000) throw new Error("录音太短，请至少说几秒钟");
    const response = await fetch("/api/transcribe", { method: "POST", headers: { "Content-Type": audioBlob.type }, body: audioBlob });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `ASR 服务返回 ${response.status}`);
    speechFinalText = result.text || "";
    speechInterimText = "";
    renderSpeech();
    const detected = result.language ? ` · 检测到 ${result.language}` : "";
    $("#speechStatus").textContent = `识别完成${detected}`;
    $("#asrStatus").textContent = "● 多语种识别已完成";
    showToast(result.repair?.usedModel
      ? (result.repair.uncertain?.length ? "混合语言已识别；个别不确定处已保留标记" : "混合语言已识别，并已根据上下文修复")
      : "混合语言已识别并完成重点提取；未配置上下文修复模型");
  } catch (error) {
    $("#speechStatus").textContent = "识别失败";
    $("#asrStatus").textContent = "● 多语种服务需要配置";
    showToast(error.message || "多语种识别失败");
  } finally {
    multiLanguageBusy = false;
  }
}

async function repairCurrentSpeech() {
  const text = speechFinalText.trim();
  if (!text) return;
  try {
    const response = await fetch("/api/repair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, language: $("#languageSelect").value }) });
    const result = await response.json();
    if (response.ok && result.repair?.text) {
      speechFinalText = result.repair.text;
      renderSpeech();
      if (result.repair.uncertain?.length) showToast("上下文修复完成；不确定内容已保留标记");
    }
  } catch {
    // 本地浏览器识别结果保留，不影响用户继续使用。
  }
}

function startSpeechRecognition() {
  if ($("#languageSelect").value === "auto") { startMultiLanguageCapture(); return; }
  if (!SpeechRecognition) { showToast("当前浏览器不支持语音识别，请使用最新版 Chrome 或 Edge"); $("#speechStatus").textContent = "浏览器不支持"; return; }
  if (!speechRecognition) {
    speechRecognition = new SpeechRecognition(); speechRecognition.lang = $("#languageSelect").value === "auto" ? (navigator.language || "en-US") : $("#languageSelect").value; speechRecognition.continuous = true; speechRecognition.interimResults = true; speechRecognition.maxAlternatives = 1;
    speechRecognition.onresult = (event) => { speechInterimText = ""; for (let i = event.resultIndex; i < event.results.length; i += 1) { const text = event.results[i][0].transcript; if (event.results[i].isFinal) speechFinalText += `${text}。`; else speechInterimText += text; } renderSpeech(); };
    speechRecognition.onerror = (event) => { if (event.error === "not-allowed") showToast("请允许浏览器使用麦克风"); else showToast(`语音识别暂时不可用：${event.error}`); setSpeechButton(false); };
    speechRecognition.onend = () => { if (speechIsListening) { try { speechRecognition.start(); } catch {} } };
  }
  speechRecognition.lang = $("#languageSelect").value === "auto" ? (navigator.language || "en-US") : $("#languageSelect").value;
  if ($("#languageSelect").value === "auto") showToast("浏览器暂不支持真正的混合语言自动识别，当前使用浏览器默认语言；接入多语种 ASR 后可自动切换");
  try { speechRecognition.start(); setSpeechButton(true); } catch { showToast("语音识别正在启动，请稍候"); }
}

function stopSpeechRecognition() {
  if ($("#languageSelect").value === "auto") {
    if (multiLanguageRecorder?.state === "recording") multiLanguageRecorder.stop();
    return;
  }
  if (speechRecognition) speechRecognition.stop(); setSpeechButton(false); speechInterimText = ""; renderSpeech(); repairCurrentSpeech();
}

$("#speechButton").addEventListener("click", () => speechIsListening ? stopSpeechRecognition() : startSpeechRecognition());
$("#languageSelect").addEventListener("change", () => { if (speechIsListening) { stopSpeechRecognition(); startSpeechRecognition(); } renderSpeech(); });
$("#clearSpeechButton").addEventListener("click", () => { stopSpeechRecognition(); speechFinalText = ""; speechInterimText = ""; renderSpeech(); });
$("#saveLiveButton").addEventListener("click", () => { const fullText = speechFinalText.trim(); if (!fullText) return; const result = summarizeText(fullText); const labeledKnowledge = result.learningKnowledge.map((item) => `${knowledgeCategory(item) || "学习知识"}：${item}`); const labeledAcademic = result.academicKnowledge.filter((item) => !result.learningKnowledge.includes(item)).map((item) => `${algorithmPattern.test(item) ? "算法知识" : "学术知识"}：${item}`); const keyPoints = labeledKnowledge.concat(labeledAcademic).concat(result.highlights.filter((item) => !result.learningKnowledge.includes(item) && !result.academicKnowledge.includes(item))); const record = { id: `speech-${Date.now()}`, title: `语音记录 · ${new Date().toLocaleDateString("zh-CN")}`, summary: result.summary, time: "刚刚", duration: "实时听写", tag: result.learningKnowledge.length ? "学习重点" : (result.academicKnowledge.length ? "学术重点" : "实时语音"), type: "lavender", icon: "◉", keyPoints: keyPoints.length ? keyPoints : [fullText], actions: result.actions, decisions: result.decisions, learningKnowledge: result.learningKnowledge, academicKnowledge: result.academicKnowledge, algorithmKnowledge: result.algorithmKnowledge, transcript: fullText, demo: false }; records = [record, ...records]; saveRecords(); renderRecords($("#searchInput").value); openRecord(record.id); showToast(result.learningKnowledge.length ? "已从学习知识库匹配并保存重点" : (result.academicKnowledge.length ? "已保留全部重要信息并优先标记学术知识" : "已保留全部重要信息并保存")); });
checkAsrStatus();
loadLearningKnowledge();
