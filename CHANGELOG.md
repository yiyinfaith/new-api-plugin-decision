# 更新日志

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
