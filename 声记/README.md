# 声记 · Audio Notes

一个无需安装依赖即可打开的音频重点记录 App 原型。

## 当前已实现

- 上传音频并显示记录卡片
- 浏览器麦克风录音（需要用户授权）
- 实时语音听写与重点提取，支持中文、英语、西班牙语、印地语、阿拉伯语、葡萄牙语、孟加拉语、俄语、乌尔都语、印尼语、法语、德语、日语、韩语和土耳其语
- 自动生成整体总结，并将内容归类为重点、行动项和决定
- 重点提取会优先排序任务、决定、时间、数字和紧急信息，但会保留音频中的全部重要信息，不再截断为 3 条
- 识别不清时会结合上下文进行保守修复；无法确认的内容保留 `[听不清]`，避免编造事实
- 学术知识优先：定义、理论、假设、模型、变量、研究方法、实验、数据、统计结果、证据、结论、公式和文献等内容会提高优先级并标记为“学术知识”
- 算法知识单独识别：贪心、动态规划、分治、递归、回溯、二分、排序、图算法、数据结构、复杂度等会标记为“算法知识”
- 内置可扩展学习知识库：算法与数据结构、复杂度与理论、数学统计、机器学习、科学研究、自然科学和经济社会科学；命中术语的内容会直接标为对应类别重点
- 音频播放、记录详情、摘要/重点/待办展示
- 本地 `localStorage` 保存记录
- 记录搜索与排序
- 响应式布局，支持手机窄屏

当前前端使用演示数据和浏览器语音识别。浏览器的 `SpeechRecognition` 一次只能使用一个 `lang`，因此“自动识别（混合语言）”目前会使用浏览器默认语言并提示限制；要可靠识别同一段话里的多种语言，需要接入支持自动语言检测的 Whisper/faster-whisper 等多语种 ASR，再将转写文本交给摘要模型进行归纳。

现在服务端已经提供真正的混合语言转写入口：选择“自动识别（混合语言）”后，应用会录制音频并请求 `/api/transcribe`。服务端使用 OpenAI Whisper 兼容的 transcription API，并把 `language` 与 `segments` 返回给前端。

## 本地运行

直接打开 `index.html` 即可查看；如果浏览器不允许本地文件录音，可在项目目录启动一个静态服务器：

```bash
python -m http.server 5173
```

然后打开 `http://localhost:5173`。

## 后端接口建议

前端可以在 `app.js` 的 `processAudio` 中接入：

```text
POST /api/notes
Content-Type: multipart/form-data
字段：audio
返回：
{
  "title": "…",
  "summary": "…",
  "key_points": ["…"],
  "action_items": ["…"],
  "decisions": ["…"],
  "transcript": "…",
  "segments": [{"text": "…", "start": 0, "end": 12}]
}
```

推荐后端流水线：多语种 ASR（自动检测语言）→ 文本清洗 → 大模型结构化提取（summary/key_points/action_items/decisions）→ 数据库存储。将 ASR provider 和摘要 provider 分开配置，并在日志记录 `provider`、`model` 和 token 用量，避免不清楚哪个服务在消耗额度。

## 配置多语种 ASR

在启动声记服务前设置服务端环境变量（密钥只放在服务端，不写进浏览器代码）：

```powershell
$env:ASR_API_KEY = "你的 ASR API key"
$env:ASR_API_URL = "https://api.openai.com/v1/audio/transcriptions"
$env:ASR_MODEL = "whisper-1"
$env:REPAIR_API_KEY = "用于上下文修复的兼容 Chat API key"
$env:REPAIR_API_URL = "https://api.openai-next.com/v1/chat/completions"
$env:REPAIR_MODEL = "deepseek-v3.2"
node server.js
```

也可以使用任何兼容 OpenAI `/v1/audio/transcriptions` 的多语种服务。未配置密钥时，固定语言模式仍可使用浏览器识别；自动混合语言模式会明确提示服务未配置，不会伪装成自动识别。

上下文修复会遵守“只补高置信度内容”的约束，不会补写原文没有依据的人名、日期、金额或结论；未配置 `REPAIR_API_KEY` 时只执行本地标点和空白清理。

OpenDev 的 OpenAI 兼容 Base URL 是 `https://api.openai-next.com/v1`。OpenDev 当前文档列出的是文本模型，因此它负责上下文修复、重点提取和总结；多语言音频转写仍需单独的 Whisper 兼容 ASR 服务。
