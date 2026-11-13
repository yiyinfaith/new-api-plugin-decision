---
changelogVersion: 1
plugin: "decision"
version: "1.0.3"
locale: "zh-CN"
---
# Changelog

## [1.0.3]

### Added

- 可以按上游报告的费用计费。回复里带有美元费用时，插件把它上报为用量字段 `upstream_cost`，来源包括 OpenRouter、ScaleDown、OpenCode 的 `usage.cost` 和 Eden AI 顶层的 `cost`。成本加价表达式如 `(u("upstream_cost") ?? (token 价)) * 1.2`：预扣按 token 价，结算按上游费用。费用不会返回给客户端。

- 渠道新增 `perCallPrice` 设置（默认关），打开后可以使用模型的固定按次价格，回复有没有用量或费用都能正常调用。默认关的原因：插件分不清固定价格和倍率，而 New API 对倍率定价的模型按每次「倍率 ÷ 2」美元扣费。

### Changed

- 回复缺少用量时改为按一次请求结算：`u("requests")` 价格能准确结算，token 表达式仍按预扣额度结算，不会按 0 计费。

### Migration

- 决策价格要计入缓存 token。大多数决策模型的缓存读取和输入同价，但插件把缓存 token 单独上报为 `cache_read_tokens`，表达式只读 `input_tokens` 时它们就不收费了。README 提供了常见模型的价格模板，三个输入字段都按输入价计费。
