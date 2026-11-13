---
locale: zh-CN
---
# Decision

决策模型网关：对输入提出类型化问题，返回带概率的答案。客户端可以用 TypeSafe System One、OpenAI Decisions、Gemini Decisions、Vercel Evaluation、OpenRouter 或 Databricks ai-decide 的格式调用，每个渠道按自己的上游格式发送，回复始终是客户端的格式。

## 渠道设置

- 渠道类型选 Task Plugin（61），插件选 Decision。
- Base URL 填上游地址，不带接口路径；密钥填上游 API Key 原文。
- 在插件配置里选上游协议：`systemone`（默认）、`openrouter`、`openai`、`gemini`、`vercel`、`vercel_sdk` 或 `databricks`。插件不会根据域名猜测协议。
- 可选设置：自定义上游路径，`{model}` 代表上游模型；密钥请求头（Bearer、`x-goog-api-key`、`api-key`、`x-api-key` 或自定义）；按模型指定协议、路径和上游模型 ID。
- 上游是另一台装了本插件的 New API 时，选 New API（60），并在扩展插件里加上 Decision。

## 模型与接口

| 接口 | 客户端格式 |
| --- | --- |
| `POST /v1/systemone`、`/typesafe/v1/systemone`、`/decisions/v1/systemone`、`/providers/microsoft/v1/systemone` | TypeSafe System One |
| `POST /api/alpha/decisions`、`/api/v1/systemone` | OpenRouter |
| `POST /v1/decisions`、`/openai/v1/decisions` | OpenAI Decisions；`/v1/decisions` 也接受 System One 形状的请求 |
| `POST /v1beta/decisions` | Gemini Decisions |
| `POST /v1/evaluate` | Vercel Evaluation |
| `POST /v1/scaledown` | ScaleDown |
| `POST /api/2.0/ai-functions/ai-decide` | Databricks ai-decide，另加 `model` 用于路由 |

所有路径也能加 `/decision` 前缀。声明的模型包括 `jev-1.14.0`、`jev-latest`、`gpt-6-luna`、`gemini-decision-1`；其它模型名填进渠道，再重定向到 `decision-custom`，上游收到的是客户端的名字，或 `upstreamModels` 里指定的 ID。

## 计费

- 每个模型用模型级任务表达式定价。重定向到其它模型的名字，自己没有表达式时用目标模型的。
- `input_tokens` 是既非缓存读取、也非缓存写入的输入 token；`cache_read_tokens` 和 `cache_write_tokens` 是缓存部分；`output_tokens` 是输出；`requests` 是成功请求数，恒为 1。
- 只有 `gpt-6-luna` 系列同时用于聊天，所以只有它需要插件覆盖价 `decision::<模型>`，聊天保留模型原价。这个系列没有输出字段；输入超过 272K token 时，`long_context` 为 true。
- Databricks ai-decide 不报告 token，只上报 `requests`，按次计费，例如 `u("requests") * 0.002`。
- 倍率价格会被拒绝：New API 对倍率定价的任务按每次「倍率 ÷ 2」美元扣费，且不按 token 结算。固定按次价格只接受用于 ai-decide。
- 请求时按输入上界预扣，回复后按上游报告的用量结算；上游没报用量时保留预扣。失败的请求不扣费。

## 示例

```bash
curl https://your-gateway.example.com/v1/decisions \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"model": "jev-latest", "input": "The mug arrived broken.", "questions": [{"type": "predicate", "name": "refund", "instructions": "Does the customer want a refund?"}]}'
```

## 限制

- 未声明的模型名需要在渠道里重定向到 `decision-custom`。
- 超出上游限制的请求直接拒绝，不拆分、不截断。
- 上游不支持的内容或题型（如发给 System One 的音频、发给 ai-decide 的图片）直接拒绝。
- 回复中按问题名索引的对象，键按名称排序。
- 完整字段参考：[API.md](https://github.com/yiyinfaith/new-api-plugin-decision/blob/main/API.md)。
