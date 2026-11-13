---
changelogVersion: 1
plugin: "decision"
version: "1.0.1"
locale: "zh-CN"
---
# Changelog

## [1.0.1]

### Added

- 支持 Databricks ai-decide：客户端可以把它的格式发到 `POST /api/2.0/ai-functions/ai-decide`（加 `model` 用于路由），渠道可以选 `databricks` 上游协议。发往上游的请求不带模型。
- 新增用量字段 `requests`，每个成功请求为 1，可以按次定价。ai-decide 不报告 token，只上报这个字段，按次计费；失败的请求不扣费。

### Changed

- 只有 `gpt-6-luna` 系列需要插件覆盖价 `decision::<模型>`；`gemini-decision-1`、Jev 和其它模型都用模型级任务表达式。
- 用倍率定价的模型仍然被拒绝；用固定按次价格的模型也被拒绝，除非上游不报告 token。New API 对倍率定价的任务按每次「倍率 ÷ 2」美元扣费，且不按 token 结算。

### Fixed

- 上游是另一台 New API 网关的 `vercel_sdk` 渠道，现在发到对方的 `/decision/v1/evaluate` 并带上模型。之前的版本漏了模型，对方会拒绝请求。

### Migration

- 只用于决策的模型（如 `gemini-decision-1`），如果模型级价格是倍率或聊天表达式，请换成任务表达式，例如 `tier("base", u("input_tokens") * 0.10 / 1000000)`。`gpt-6-luna` 继续使用 `decision::gpt-6-luna` 覆盖价。
- ai-decide 用的模型请配任务表达式，如 `u("requests") * 0.002`。这个名字和它重定向到的模型都没有任务表达式时，也可以用固定按次价格。
