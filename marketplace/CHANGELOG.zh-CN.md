---
changelogVersion: 1
plugin: "decision"
version: "1.1.0"
locale: "zh-CN"
---
# Changelog

## [1.1.0]

### Added

- 可以从文本或图片中抽取有类型的值。客户端按 OpenRouter Extractions API 的格式调用 `POST /api/alpha/extractions`，渠道发往 OpenRouter（协议 `extractions`）或 Cloudflare Workers AI Clairic（协议 `clairic`）。已声明 `cloudflare/clairic`、`scaledown/extract`、Schematron 等抽取模型。
- 可以把决策请求发往 Parallel 官方接口（协议 `parallel`，不带模型字段，用 `x-api-key`）和 Cloudflare Workers AI 的 `openai/decisions`（协议 `cloudflare_openai`）。
- 用渠道的 `imageMode`，按兼容 System One 的厂商各自的写法发送图片：Ollama 的 Base64 字符串、SubQ 的 `{mediaType, base64}`、Cloudflare Clef 的 `{content_type, base64}`，以及 Perplexity、Requesty、Inception 的 `state` 内 `image_url`。
- 所有 System One 路由都可以使用厂商自有题型，如 Perplexity `locate`、Inception `extract`、Respan `number`，原样发往 System One 族上游。

### Fixed

- 图片写法不是 `assets` 时，上传的图片不再作为 multipart 分段转发。
- 问题名、资源名、选项名与 JavaScript 对象自带成员同名（如 `constructor`）时按普通名字处理；题型、图片格式、字段类型写成这类名字时明确拒绝。
- 请求里任何位置用 `__proto__` 作键名时返回 400，不再让对应的问题或答案丢失。
- Base URL 只有主机名、且与路径第一段同名时（如 `http://api`），不再截掉主机名。
- `authType` 不是有效取值时报配置错误，不再静默不发密钥。
- 上游是另一台 New API 时忽略 `imageMode`，图片按 `assets` 发送。
- `state-image-url` 写法下只有一张图片时，`state` 仍发成数组。

### Migration

- 抽取模型和决策模型一样，用模型级任务表达式定价。
- 要给 SubQ、Ollama、Cloudflare Clef、Perplexity、Requesty 或 Inception 发图片，请设置渠道的 `imageMode`。
