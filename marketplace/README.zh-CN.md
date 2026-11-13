---
locale: zh-CN
---
# Decision

决策模型网关：对输入提出类型化问题，返回带概率的答案。客户端可以用 TypeSafe System One、OpenAI Decisions、Gemini Decisions、Vercel Evaluation 或 OpenRouter 的格式调用，每个渠道按自己的上游格式发送，回复始终是客户端的格式。

## 渠道设置

- 渠道类型选 Task Plugin（61），插件选 Decision。
- Base URL 填上游地址，不带接口路径；密钥填上游 API Key 原文。
- 在插件配置里选上游协议：`systemone`（默认）、`openrouter`、`openai`、`gemini`、`vercel` 或 `vercel_sdk`。插件不会根据域名猜测协议。
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

所有路径也能加 `/decision` 前缀。声明的模型包括 `jev-1.14.0`、`jev-latest`、`gpt-6-luna`、`gemini-decision-1`；其它模型名填进渠道，再重定向到 `decision-custom`，上游收到的是客户端的名字。

## 计费

- 每个模型用任务用量表达式定价。
- `input_tokens` 是既非缓存读取、也非缓存写入的输入 token；`cache_read_tokens` 和 `cache_write_tokens` 是缓存部分；`output_tokens` 是输出。
- `gpt-6-luna` 系列没有输出字段；输入超过 272K token 时，`long_context` 为 true。
- 模型同时用于聊天时，把决策价格配在插件覆盖价 `decision::<模型>` 上，聊天保留原价。
- 请求时按输入上界预扣，回复后按上游报告的用量结算；上游没报用量时保留预扣。
- 没有任务表达式价格的模型返回 400。

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
- 上游不支持的内容或题型（如发给 System One 的音频）直接拒绝。
- 回复中按问题名索引的对象，键按名称排序。
- 完整字段参考：[API.md](https://github.com/yiyinfaith/new-api-plugin-decision/blob/main/API.md)。
