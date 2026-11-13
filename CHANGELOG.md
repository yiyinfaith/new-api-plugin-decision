# 更新日志

## 1.1.0（2026-11-13）

新增抽取任务和更多厂商协议。

- **抽取（Extractions）**：
  - 新增客户端路由 `POST /api/alpha/extractions`，格式同 OpenRouter Extractions API：按字段定义从文本或图片中抽取有类型的值。字段类型有 text、number、date、time、datetime、duration、list、estimate、forecast，按 OpenRouter 的 schema 严格校验。
  - 新增上游协议 `extractions`（OpenRouter，或另一台装了本插件的 New API）和 `clairic`（Cloudflare Workers AI 官方接口，图片转成它的 `images` 数组）。
  - 决策和抽取请求互不转换，发错协议时明确报错。
  - 声明抽取模型 `cloudflare/clairic`、`clairic`、`scaledown/extract`、`inference-net/schematron-v2-small`、`inference-net/schematron-v2-turbo`、`inception/mercury-decide`、`levanto/sage-2`。
- **新上游协议**：
  - `parallel`：Parallel 官方接口，不带模型、用 `x-api-key`，按 Parallel 的限制检查题目。
  - `cloudflare_openai`：Cloudflare Workers AI 的 `openai/decisions`，OpenAI 请求体包在 `{model, input}` 里，自动拆开 Workers AI 的回复外层和 `success: false` 错误。
- **图片写法 `imageMode`**：兼容 System One 的厂商可以收到它们自己的图片写法：Ollama 的 Base64 字符串、SubQ 的 `{mediaType, base64}`、Cloudflare Clef 的 `{content_type, base64}`，以及 Perplexity、Requesty、Inception 的 `state` 内 `image_url`。之前这些厂商只能发文本。
- **厂商自有题型**：`/v1/systemone` 等所有 System One 路由都接受 Perplexity `locate`、Inception `extract`、Respan `number` 等题型，原样发往 System One 族上游；其它协议仍明确拒绝。
- **修复**：图片写法不是 `assets` 时，上传的图片文件不再被当作 multipart 分段转发。
- 测试：N × N 矩阵扩展到 8 种客户端格式 × 9 种上游协议，新增抽取和厂商格式测试，共 159 个。

## 1.0.3（2026-11-13）

按上游实际费用计费，并提供价格模板和模型目录同步。

- **新增用量字段 `upstream_cost`**：
  - 上游回复里报告了本次费用（美元）时，插件上报这个字段。来源是 OpenRouter、ScaleDown、OpenCode 等的 `usage.cost`，或 Eden AI 顶层的 `cost`。
  - 可以写"成本加价"表达式，如 `(u("upstream_cost") ?? (token 价)) * 1.2`：预扣按 token 价，结算按上游费用。
  - 上游不报告费用时没有这个字段，不会当作 0。费用只进计费，不返回给客户端；Eden AI 回复顶层的 `cost` 也一并去掉。
- **按次计费更兼容**：
  - 新增渠道开关 `perCallPrice`（允许模型固定按次价格，默认关）。打开后，模型可以用 New API 的固定按次价格，上游回复有没有用量、有没有费用都能正常调用。
  - 默认关的原因：插件分不清 New API 走的是固定价格还是倍率，而倍率会按每次「倍率 ÷ 2」美元扣费。
  - 上游回复缺少用量时，改为按一次请求结算（之前是让结算报错并保留预扣）：`u("requests")` 表达式能准确结算，token 表达式仍按预扣额度结算，不会当作免费。
- **价格模板**：README 按输入价列出常见模型的任务表达式，价格取自厂商官网和 OpenRouter 实时目录，2026-11-13 核对。模板把缓存读取和缓存写入也按输入价计费，避免上游报告的缓存 token 漏收。
- **模型目录同步**：
  - 新增 `scripts/sync-models.mjs`，比对 OpenRouter、Vercel AI Gateway、SubQ 的实时决策模型目录和插件声明的模型，列出未声明和可能已下架的 ID，只报告不自动修改。
  - 新增每周运行的 GitHub Action `Model catalogs`：有未声明的新模型时运行失败，GitHub 会发邮件提醒。
- 测试：新增 `upstream_cost` 的单元测试和端到端测试（成本加价按费用结算、无费用时退回 token 价）。

## 1.0.2（2026-11-13）

扩充声明的决策模型，常见模型开箱即用。

- **106 个声明模型**（1.0.1 是 16 个）：TypeSafe Jev、Liquid d1、Laya、OpenAI `gpt-6-luna`、Gemini Decision 1、Perplexity Decider、Microsoft Decision 1、Upstage Solar Decide、Bespoke Nimble、SubQ Snap、Inception Mercury Decide、Telnyx、Cloudflare Clef、ScaleDown、Baseten、Fireworks、Nace.AI Drex、Morph Reflex、Respan、Together Tev1、Databricks System One 路由，以及 OpenRouter、Vercel AI Gateway、LiteLLM 等网关上的写法。渠道里直接勾选，不用再重定向到 `decision-custom`。
- **严格核实**：每个 ID 都来自厂商官方文档或实时模型目录（OpenRouter、Vercel AI Gateway、SubQ 的 `/models` 接口），2026-11-13 核对；只出现在第三方页面的名字没有收录。来源列在 API.md 的「声明的模型」。
- **兼容**：1.0.1 的 16 个模型全部保留，`decision-custom` 继续用于未知模型；路由、协议转换和计费逻辑不变。
- 模型清单移到 `src/models.js`，按厂商分组注明来源。
- `check-release.mjs` 检查每个声明的模型都出现在 README 和 API.md 里；新增测试检查模型名唯一（不区分大小写）、不含 `@` 和空白、旧模型没被删掉。
- 文档：README 的「模型」一节改成按厂商的模型表，说明不同平台写法的选择；「任意模型名」示例换成未声明的名字。

## 1.0.1（2026-11-13）

新增 Databricks ai-decide，调整计费设计。

- **Databricks ai-decide**：
  - 新增客户端路径 `POST /api/2.0/ai-functions/ai-decide`，请求体另加 `model` 用于 New API 路由。
  - 新增上游协议 `databricks`：发往上游的请求自动去掉 `model`；只发文本和 JSON，图片和 Box 题报错；缺少的指令用问题名补上。
  - 与其它七种客户端格式、六种上游协议双向转换；错误用 Databricks 的 `{error_code, message}` 格式。
- **按次计费**：新增用量字段 `requests`，每个成功请求为 1。
  - ai-decide 不返回 token，只上报这个字段，不编造 token 用量。
  - 成功按次结算，失败不扣费；读 token 字段的表达式会被拒绝，不会免费。
  - 可用模型级任务表达式 `u("requests") * 单价`；名字没有任务表达式时，也可用模型固定价格。
- **计费设计**：只有 `gpt-6-luna` 系列需要插件覆盖价 `decision::gpt-6-luna`；`gemini-decision-1`、Jev 和其它模型直接用 New API 的模型级任务表达式（重定向的名字可继承目标模型的表达式）。插件里不含任何模型的单价。
- **倍率验证**：在 rc.50 上实测，New API 对任务插件只按每次「倍率 ÷ 2」美元扣费、不按 token 结算（96 和 652 token 的请求都扣 5250 额度）。所以按 token 计费的上游继续拒绝倍率和固定按次价格，不会错误地按次收费；拒绝时的说明文字改为指向正确的配置方法。
- **修复**：上游是另一台 New API 网关的 `vercel_sdk` 渠道，之前发出的请求漏了 `model`，会被对方拒绝；现在改发对方的 `/decision/v1/evaluate` 并带上模型。
- **构建**：`src/` 里有文件没列进打包清单时，`build.mjs` 报错。
- **文档**：README 详细说明任意模型名的三个名字（客户端模型名、重定向后的名字、上游模型 ID）并给出完整示例；分开说明普通模型定价、模型级任务表达式、`gpt-6-luna` 插件覆盖价和 Databricks 按次计费。

## 1.0.0（2026-11-13）

首个版本。

- 七种客户端格式：TypeSafe System One、OpenRouter、ScaleDown、OpenAI Decisions（以及 Perplexity 等使用的 System One 形状 `/v1/decisions`）、Gemini Decisions、Vercel Evaluation；所有路径也能加 `/decision` 前缀。
- 六种上游协议：`systemone`、`openrouter`、`openai`、`gemini`、`vercel`、`vercel_sdk`，经 Decision IR 双向转换；渠道可指定协议、路径（支持 `{model}`）、密钥请求头，并按模型覆盖协议、路径和上游模型 ID。
- 任意客户端模型名：重定向到 `decision-custom` 即可，上游收到客户端的名字或 `upstreamModels` 指定的 ID。
- 计费字段：输入、缓存读取、缓存写入、输出；`gpt-6-luna` 系列另有长上下文字段、没有输出字段。按上界预扣，按上游用量结算；上游没报用量时保留预扣；模型没配任务表达式价格时拒绝请求。
- 保留官方 TypeSafe 插件 1.2.0 的全部能力：四种题型、图片（Base64 与 SDK multipart）、图片与长上下文请求头、TypeSafe 错误格式、JSON 键顺序。
- 多模态：图片在各协议间转换；音频、视频、PDF 发往 Gemini；上游不支持的内容和题型明确报错。
