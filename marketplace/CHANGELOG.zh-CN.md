---
changelogVersion: 1
plugin: "decision"
version: "1.0.0"
locale: "zh-CN"
---
# Changelog

## [1.0.0]

### Added

- 可用七种客户端格式调用决策模型：TypeSafe System One、OpenRouter、ScaleDown、OpenAI Decisions、Gemini Decisions、Vercel Evaluation，以及 Perplexity、Inception 使用的 System One 形状 `/v1/decisions`；所有路径也能加 `/decision` 前缀。
- 每个渠道可以按 System One、OpenRouter、OpenAI Decisions、Gemini Decisions 或 Vercel Evaluation 发送请求，回复会转回客户端的格式。
- 可按渠道选择上游协议、路径和密钥请求头，并按模型指定协议、路径和上游模型 ID。
- 在渠道里把任意模型名重定向到 `decision-custom` 即可使用。
- 输入、缓存读取、缓存写入和输出分开定价；`gpt-6-luna` 系列用长上下文字段代替输出字段，决策价格可以和聊天价格分开。
- 保留官方 TypeSafe 插件的全部功能：四种题型、Base64 或 SDK 上传的图片、长上下文请求头、TypeSafe 错误格式和键顺序。

### Migration

- 给启用的每个模型配置任务用量表达式价格。`gpt-6-luna` 的表达式配在插件覆盖价 `decision::gpt-6-luna` 上，聊天价格仍配在模型上。没有任务表达式价格的模型会被拒绝。
