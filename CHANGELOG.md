# 更新日志

## 1.0.0（2026-11-13）

首个版本。

- 七种客户端格式：TypeSafe System One、OpenRouter、ScaleDown、OpenAI Decisions（以及 Perplexity 等使用的 System One 形状 `/v1/decisions`）、Gemini Decisions、Vercel Evaluation；所有路径也能加 `/decision` 前缀。
- 六种上游协议：`systemone`、`openrouter`、`openai`、`gemini`、`vercel`、`vercel_sdk`，经 Decision IR 双向转换；渠道可指定协议、路径（支持 `{model}`）、密钥请求头，并按模型覆盖协议、路径和上游模型 ID。
- 任意客户端模型名：重定向到 `decision-custom` 即可，上游收到客户端的名字或 `upstreamModels` 指定的 ID。
- 计费字段：输入、缓存读取、缓存写入、输出；`gpt-6-luna` 系列另有长上下文字段、没有输出字段。按上界预扣，按上游用量结算；上游没报用量时保留预扣；模型没配任务表达式价格时拒绝请求。
- 保留官方 TypeSafe 插件 1.2.0 的全部能力：四种题型、图片（Base64 与 SDK multipart）、图片与长上下文请求头、TypeSafe 错误格式、JSON 键顺序。
- 多模态：图片在各协议间转换；音频、视频、PDF 发往 Gemini；上游不支持的内容和题型明确报错。
