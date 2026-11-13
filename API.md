# Decision 插件接口参考

版本 **1.1.0**。本文件是调用方和管理员的完整字段参考；安装、渠道和价格配置见 [README](README.md)。

## 目录

- [接口一览](#接口一览)
- [通用规则](#通用规则)
- [请求格式](#请求格式)：[System One](#typesafe-system-one)、[OpenRouter](#openrouter)、[ScaleDown](#scaledown)、[System One 形状的 /v1/decisions](#system-one-形状的-v1decisions)、[OpenAI Decisions](#openai-decisions)、[Gemini Decisions](#gemini-decisions)、[Vercel Evaluation](#vercel-evaluation)、[Databricks ai-decide](#databricks-ai-decide)、[Extractions](#extractions)
- [回复](#回复)
- [上游协议](#上游协议)
- [转换规则](#转换规则)
- [多模态](#多模态)
- [数量限制](#数量限制)
- [错误](#错误)
- [计费字段](#计费字段)
- [兼容性](#兼容性)
- [声明的模型](#声明的模型)

## 接口一览

所有路径都是 `POST`。**客户端优先直接使用下表中的原生路径，不要默认添加插件前缀**；仅当与 New API 主程序或其他插件发生实际路由冲突时，才在原路径前添加 `/decision`，例如 `/decision/v1/systemone`、`/decision/v1beta/decisions`。`/v1`、`/api` 这样的路径段不构成冲突。

| 客户端协议 | 路径 | 请求体 | 回复 |
| --- | --- | --- | --- |
| TypeSafe System One | `/v1/systemone`（推荐）；兼容 `/decisions/v1/systemone`、`/providers/microsoft/v1/systemone` | JSON，或 TypeSafe SDK 的 multipart | System One |
| OpenRouter | `/api/alpha/decisions`、`/api/v1/systemone` | JSON | System One + `id`、缓存 token |
| ScaleDown | `/v1/scaledown` | JSON | System One |
| OpenAI Decisions | `/v1/decisions`（`input` + `questions` 数组）、`/openai/v1/decisions` | JSON | OpenAI Decisions |
| System One 形状 | `/v1/decisions`（`state` 或 `questions` 对象） | JSON | System One |
| Gemini Decisions | `/v1beta/decisions` | JSON | Gemini Decisions |
| Vercel Evaluation | `/v1/evaluate` | JSON | AI SDK 评估格式 |
| Databricks ai-decide | `/api/2.0/ai-functions/ai-decide` | JSON（加 `model`） | Databricks ai-decide |
| OpenRouter Extractions（抽取） | `/api/alpha/extractions` | JSON | OpenRouter Extractions |

- Decision 独立支持 System One，不要求安装其他插件。如果同时安装官方 TypeSafe 插件，`/v1/systemone` 可能成为共享入口：优先检查模型和渠道绑定，必要时使用 `/decision/v1/systemone` 精确进入 Decision。
- 请求都是同步的：一次请求一次回复，没有任务 ID 要轮询。
- 不会占用 `/v1/tasks`、`/v1/chat/completions` 等其它接口。

## 通用规则

- **鉴权**：`Authorization: Bearer <New API 令牌>`。插件路由不认厂商自己的密钥头。
- **模型**：`model` 必填，决定渠道；渠道的插件配置决定上游协议（见 [README](README.md#渠道配置)）。模型名大小写不同也能匹配声明的模型。
- **未知字段**：每种格式都拒绝它没定义的顶层字段（`does not accept the request field …`），防止拼错的参数被静默丢弃。少数厂商扩展字段见各格式说明。
- **用量**：只取上游回复里的 usage；请求里不能写用量。上游不报用量时（Databricks ai-decide），其它格式回复里的 token 数为 0，计费按次。
- **键顺序**：发往上游的请求保持客户端的 JSON 键顺序（TypeSafe 会把 state 当文本读，顺序影响答案）；回复中按名字索引的对象（如 `answers`）由 New API 按键名排序输出，OpenAI 格式的 `answers` 数组按提问顺序。
- **同协议直通**：客户端和上游是同一协议族时，请求体原样转发（只换 `model`；Databricks ai-decide 去掉 `model`）；Databricks 请求发往 System One 族上游时也原样转发 `state` 和 `questions`。客户端和上游是同一种协议（System One、OpenAI、Gemini、Databricks）时，回复也原样返回，厂商扩展字段保留，只有 `usage` 换成该协议的标准字段（中转站加在 usage 里的成本、计费来源等不返回给客户端）。
- **大小**：请求体受 New API 的 `MAX_REQUEST_BODY_MB` 限制；大图片优先用 URL（上游支持时）。

## 请求格式

### TypeSafe System One

字段与 [TypeSafe 官方接口](https://docs.typesafe.ai/api) 一致，校验规则与官方 TypeSafe 插件 1.2.0 相同。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | 必填 |
| `state` | string / object / array | 必填，不能为 null。数组是一组文本值，可混合字符串和对象 |
| `questions` | object | 必填，键是问题名，值是问题，至少 1 个 |
| `assets` | object | 可选，图片。键是引用名，写在 state、instructions 或 criteria 的字符串里即代表该图片；每个图片都必须被引用 |

问题：

| `type` | 字段 | 说明 |
| --- | --- | --- |
| `noul` | `instructions?`、`criteria?: {true?, false?}` | 是非题，答案为"是"的概率 |
| `choice` | `instructions?`、`criteria: {选项: 描述或 null}` | 1–255 个选项 |
| `score` | `instructions?`、`criteria: [等级…]` | 1–10 个等级，从低到高，下标从 0 开始 |
| `box` | `instructions?` | 在图片中定位，需要 Jev 1.14 |

`instructions`、选项描述、noul 的 true/false 可以是字符串、对象、数组或 null；等级不能为 null。

图片 `assets.<引用>`：`{"type": "image", "format": "png" | "jpg" | "jpeg", "data_base64": "<标准 Base64，无 data: 前缀>"}`，或 multipart 上传时 `{"type": "image", "part": "<文件分段名>"}`。

multipart：第一个分段名为 `request`，内容是上面的 JSON；每张图片一个文件分段，由某个 asset 的 `part` 指向。没被 asset 指向的文件分段会被拒绝。

请求头：

| 请求头 | 作用 |
| --- | --- |
| `TypeSafe-Danger-Zone-Long-Context: true` | 转发给 System One 上游，启用约 262K 长上下文；预扣上限相应提高 |
| `TypeSafe-Danger-Zone-Images` | 不用写，有图片或 Box 题时插件自动加 |

```json
{
  "model": "jev-1.14.0",
  "state": {"ticket": "The mug is broken.", "photo": "9b1c…-uuid"},
  "questions": {
    "request": {"type": "choice", "criteria": {"refund": "Wants the money back", "replacement": "Wants a new mug", "other": null}},
    "severity": {"type": "score", "criteria": ["Minor", "Moderate", "Severe"]},
    "where": {"type": "box", "instructions": "Where is the crack in `photo`?"}
  },
  "assets": {"9b1c…-uuid": {"type": "image", "format": "png", "data_base64": "iVBORw0KGgo…"}}
}
```

### OpenRouter

System One 加 OpenRouter 的字段：

| 字段 | 处理 |
| --- | --- |
| `provider` | OpenRouter 的路由偏好（含 `max_price`）。上游是 `openrouter` 时转发，其它上游无法遵守，报错 |
| `session_id`、`trace`、`user` | 上游是 `openrouter` 时转发，其它上游丢弃（只是标记） |

回复多一个 `id`（网关请求 ID），noul 答案带 `confidence`（上游给了时），`usage.input_tokens_details.cached_tokens`（有缓存时）。不返回上游的 `cost`。

### ScaleDown

System One，另外 `state` 可以写成 `{"text": "…"}`，或 `{"document": "<Base64>", "document_mime_type": "application/pdf"}`。文档只能发往 Gemini 上游。

### System One 形状的 /v1/decisions

Perplexity、Inception、Requesty 在 `/v1/decisions` 上用 System One 的形状（`state` + `questions` 对象）。插件按 System One 处理并返回 System One 格式，另外：

- 接受 Perplexity 的 `mode`、`max_staleness`、`user`、`metadata`：发往 System One 族上游时原样转发，由上游校验；`mode`、`max_staleness` 发往其它上游报错，`user`、`metadata` 丢弃。
- 接受厂商自有的问题类型（如 `locate`、`extract`），但只能发往 System One 族上游，答案原样返回。
- 错误用 OpenAI 风格 `{"error": {…}}`，与这些厂商一致。

### OpenAI Decisions

字段与 [OpenAI 官方接口](https://developers.openai.com/api/reference/resources/decisions/methods/create) 一致。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | 必填 |
| `input` | string / array | 必填。字符串，或输入项数组 |
| `questions` | array | 必填，1–400 个，回复按同样顺序 |
| `prompt_cache_key`、`prompt_cache_options`、`safety_identifier` | | OpenAI 上游原样转发；其它上游丢弃（只影响缓存和风控） |
| `providerOptions`、`fallbacks` | | Vercel、Bifrost 的扩展。OpenAI 族上游转发，其它上游报错 |

输入项：`{"role": "user", "content": "…" 或 [片段…]}`，片段为 `input_text {text}`、`input_image {image_url: data URL 或 http(s) URL, detail?}`、`input_json {data: 对象或对象数组}`。`developer`、`system`、`assistant` 消息和工具调用项只能发往 OpenAI 上游，其它上游报错。

问题：

| `type` | 字段 | 说明 |
| --- | --- | --- |
| `predicate` | `name?`、`instructions` | 陈述为真的概率 |
| `choice` | `name?`、`instructions`、`choices: [{value: string 或 boolean, description?}]` | 2–255 个，值不能重复 |
| `score` | `name?`、`instructions`、`levels: [{label, description?}]` | 2–10 个，从低到高 |
| `box` | `name?`、`instructions` | Vercel、LiteLLM、Bifrost 的扩展 |

`instructions` 必填，可以是字符串或片段数组。`name` 可省略：发往需要名字的上游时插件生成 `question_0`、`question_1`…（不和已有名字冲突），回复里仍是 `null`。

### Gemini Decisions

字段与 [Gemini Decisions 接口参考](https://aistudio.google.com/api-reference/decisions) 一致（Beta）。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | 必填，可带 `models/` 前缀 |
| `input` | string / 块 / 块数组 | 必填 |
| `questions` | object | 必填，键是问题 ID |

块：`{"type": "text", "text"}`；`{"type": "image" | "audio" | "video" | "document", "data": "<Base64>" 或 "uri": "…", "mime_type": "…"}`，可带 `resolution`、`channels`、`sample_rate`、`processing`、`name`（只转发给 Gemini 上游）。

问题：

| `type` | 字段 | 说明 |
| --- | --- | --- |
| `noul` | `instructions`、`criteria?: {true_description?, false_description?}` | |
| `choice` | `instructions`、`criteria: {选项 ID: 描述}` | 2–255 个；ID 非空、无控制字符、首尾无空格 |
| `score` | `instructions`、`criteria: [等级…]` | 2–255 个非空字符串 |

`instructions` 只能是文本（字符串、文本块或文本块数组）。

### Vercel Evaluation

Vercel AI Gateway 旧接口 `/v1/evaluate`（已被 `/v1/decisions` 取代但仍提供），即 AI SDK 的评估格式：

| 字段 | 说明 |
| --- | --- |
| `model` | 必填 |
| `state` | 字符串、JSON 对象，或片段数组：`{type: "text", text}`、`{type: "json", value}`、`{type: "file", mediaType, data: Base64 / data URL / http(s) URL}` |
| `questions` | 对象。`type` 为 `boolean`（同 noul，`criteria: {true, false}`）、`choice`、`score`、`box` |
| `providerOptions` | Vercel 网关选项，只转发给 Vercel 上游，其它上游报错 |

### Databricks ai-decide

字段与 [Databricks ai-decide 参考](https://docs.databricks.com/api/ai-functions/v1/ai-decide)（Beta）一致，另加 `model` 供 New API 路由。发往 Databricks 上游时去掉 `model`。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | 必填（Databricks 原接口没有），决定渠道 |
| `state` | string / object / array | 必填 |
| `questions` | object | 必填，键是问题 ID（不能为空白） |
| `options` | object | 可选，只有 `version`，只能是 `"1.0"`；只转发给 Databricks 上游 |

问题（每题只能有 `type`、`instructions`、`criteria`）：

| `type` | 字段 | 说明 |
| --- | --- | --- |
| `noul` | `instructions`、`criteria?: {true?, false?}` | 指令和真/假说明至少一项有内容 |
| `choice` | `instructions`、`criteria: {选项: 描述或 null}` | 1–255 个选项 |
| `score` | `instructions`、`criteria: [等级…]` | 2–10 个非空等级，从低到高 |

`instructions` 必填，可以是字符串、对象或数组（noul 有真/假说明时可以是空串）。不支持图片和 Box 题。

### Extractions

抽取请求，字段与 [OpenRouter Extractions API](https://openrouter.ai/docs/api/api-reference/alphaextractions/submit-an-extractions-request)（Alpha）一致，未知字段一律报错。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string | 必填 |
| `fields` | object | 必填，字段名到字段定义，至少 1 个 |
| `state` | string | 默认 `""`；只有带 `assets` 时可以为空 |
| `assets` | object | 引用键到 `{type?: image | document, format: png | jpg | jpeg | webp | pdf, data_base64}`；`state` 有文字时每个键都要在 `state` 或字段 `instructions` 里出现 |
| `reference_date` | string | `YYYY-MM-DD`，给没有年份的日期定基准 |
| `provider` | object | OpenRouter 的路由偏好；发往 Clairic 时只能有 `options.cloudflare`（`include_quantiles`、`return_state_text`） |
| `user`、`session_id`、`trace` | | 只转发给 OpenRouter |

字段定义（`type` 必填）：

| `type` | 可用的键 | 必填 |
| --- | --- | --- |
| `text`、`date`、`time`、`datetime` | `instructions`、`unit`、`null_threshold`（0–1） | |
| `number`、`duration` | 同上，加 `integer`、`decimals`（0–6） | |
| `list` | 同上，加 `items`（`text`、`number`、`date`） | `items` |
| `estimate` | `instructions`、`unit`、`min`、`max`、`step`（正数或 `month`、`year`）、`scale`（`linear`、`log`） | `min`、`max` |
| `forecast` | `estimate` 的键，加 `horizon`（1–64）、`interval`（`step`、`minute`、`hour`、`day`、`week`、`month`、`quarter`、`year`） | `min`、`max`、`horizon`、`interval` |

各模型支持的类型不同（如 Perplexity 只有 `text` 和文本 `list`），由上游校验。

## 回复

成功一律 HTTP 200。

**System One**

```json
{
  "model": "jev-1.14.0",
  "answers": {
    "wants_refund": {"type": "noul", "noul": 0.81},
    "request": {"type": "choice", "choice": "refund", "confidence": 0.62, "probabilities": {"refund": 0.81, "replacement": 0.15, "other": 0.04}},
    "severity": {"type": "score", "score": 1.2, "confidence": 0.55, "legend": {"0": "Minor", "1": "Moderate", "2": "Severe"}, "probabilities": {"0": 0.2, "1": 0.4, "2": 0.4}},
    "where": {"type": "box", "box": {"top": 0.1, "bottom": 0.5, "left": 0.2, "right": 0.6}, "confidence": null}
  },
  "usage": {"input_tokens": 285, "output_tokens": 0}
}
```

上游拒答的问题为 `{"type": "refusal"}`（OpenRouter 的写法）。上游没给的 `confidence`、`probabilities` 为 `null`，插件不会编造。

**OpenAI Decisions**

```json
{
  "model": "gpt-6-luna",
  "answers": [
    {"type": "predicate", "name": "wants_refund", "probability": 0.81},
    {"type": "choice", "name": "request", "choice": "refund", "probabilities": [{"value": "refund", "probability": 0.81}, {"value": "replacement", "probability": 0.19}], "confidence": 0.62},
    {"type": "score", "name": "severity", "score": 1.2, "probabilities": [{"value": 0, "label": "Minor", "probability": 0.2}, {"value": 1, "label": "Moderate", "probability": 0.4}, {"value": 2, "label": "Severe", "probability": 0.4}], "confidence": 0.55}
  ],
  "usage": {"input_tokens": 300, "input_tokens_details": {"cached_tokens": 0, "cache_write_tokens": 0}, "output_tokens": 0, "output_tokens_details": {"reasoning_tokens": 0}, "total_tokens": 300}
}
```

拒答为 `{"type": "refusal", "name": …}`；Box 为 `{"type": "box", "name", "box": {…}, "confidence"}`。

**Gemini Decisions**

```json
{
  "answers": {
    "wants_refund": {"type": "noul", "noul": 0.81, "confidence": 0.81},
    "request": {"type": "choice", "choice": "refund", "probabilities": {"refund": 0.81, "replacement": 0.19}, "confidence": 0.81},
    "severity": {"type": "score", "score": 1.2, "legend": {"0": "Minor", "1": "Moderate", "2": "Severe"}, "probabilities": {"0": 0.2, "1": 0.4, "2": 0.4}, "confidence": 0.4}
  },
  "usage": {"total_input_tokens": 300, "total_cached_tokens": 0, "total_output_tokens": 0, "total_thought_tokens": 0, "total_tokens": 300}
}
```

上游拒答的问题不出现在 `answers` 里，`prompt_feedback.block_reason` 为 `other`，`block_reason_message` 列出这些问题。

**Vercel Evaluation**

```json
{
  "answers": {
    "wants_refund": {"type": "boolean", "probability": 0.81},
    "request": {"type": "choice", "choice": "refund", "probabilities": {"refund": 0.81, "replacement": 0.19}},
    "severity": {"type": "score", "score": 1.2, "probabilities": {"0": 0.2, "1": 0.4, "2": 0.4}}
  },
  "usage": {"inputTokens": 300, "outputTokens": 0, "totalTokens": 300},
  "providerMetadata": {"decision": {"confidence": {"request": 0.62, "severity": 0.55}, "legend": {"severity": {"0": "Minor", "1": "Moderate", "2": "Severe"}}}}
}
```

**Databricks ai-decide**

```json
{
  "response": {
    "answers": {
      "wants_refund": {"type": "noul", "probability": 0.81},
      "request": {"type": "choice", "choice": "refund", "probabilities": {"refund": 0.81, "replacement": 0.19}, "confidence": 0.62},
      "severity": {"type": "score", "score": 1.2, "probabilities": {"0": 0.2, "1": 0.4, "2": 0.4}, "legend": {"0": "Minor", "1": "Moderate", "2": "Severe"}, "confidence": 0.55}
    }
  },
  "metadata": {"version": "1.0"}
}
```

没有 `model` 和 `usage`，与 Databricks 原接口一致。上游拒答的问题为 `{"type": "refusal"}`。

**Extractions**

```json
{
  "id": "task_…",
  "model": "cloudflare/clairic",
  "provider": "Cloudflare",
  "answers": {
    "invoice_number": {"type": "text", "value": "INV-7", "guess": "INV-7", "span": [8, 13], "p_null": 0.01, "confidence": 0.98},
    "total": {"type": "number", "value": 41.5, "guess": 41.5, "p_null": 0.02, "confidence": 0.9}
  },
  "truncated": false,
  "usage": {"input_tokens": 120, "output_tokens": 0, "state_tokens": 30, "image_tokens": 0, "schema_tokens": 40, "passes": 1}
}
```

`answers` 原样来自上游（OpenRouter 和 Clairic 的答案格式相同），`id` 是网关的请求 ID；`usage.cost` 不返回给客户端。

## 上游协议

| `protocol` | 发送 | 密钥头 | 读取的用量 |
| --- | --- | --- | --- |
| `systemone` | `{model, state, questions, assets?}`；有图片时 multipart 或 Base64；渠道开了 `fillInstructions` 时，没有指令的问题用问题名作指令 | Bearer；有图片或 Box 时加 `TypeSafe-Danger-Zone-Images: true`；客户端要求时加长上下文头 | `input_tokens`、`output_tokens`、`input_tokens_details.cached_tokens`、`cached_input_tokens` |
| `openrouter` | 同上，加 `provider`、`session_id`、`trace`、`user` | Bearer | 同上 |
| `openai` | `{model, input, questions}` | Bearer | `input_tokens`、`input_tokens_details.{cached_tokens, cache_write_tokens}`、`output_tokens`；Bifrost 的 `prompt_tokens`、`completion_tokens` |
| `gemini` | `{model, input, questions}` | `x-goog-api-key` | `total_input_tokens`、`total_cached_tokens`、`total_output_tokens`、`total_thought_tokens` |
| `vercel` | `{model, state, questions}`（`boolean` 题型） | Bearer | `inputTokens`、`outputTokens`，或 snake_case |
| `vercel_sdk` | `{state, questions}`，模型在 `ai-model-id` 头，另加 `ai-evaluation-model-specification-version: 4` 等头 | Bearer | 同上 |
| `databricks` | `{state, questions, options?}`，不带模型；每题都有 `instructions`（缺省时用问题名）；noul 的 null 说明省略 | Bearer | 无，按次计费（`requests`） |
| `parallel` | `{state, questions}`，不带模型；指令、说明都写成文本，缺省的指令用问题名，null 选项说明用选项名；不带图片 | `x-api-key` | `input_tokens`、`output_tokens`（Parallel 按次收费） |
| `cloudflare_openai` | `{model, input: <OpenAI Decisions 请求体去掉 model>}`，发到 `/ai/run` | Bearer | 同 `openai` |
| `extractions` | OpenRouter Extractions 请求体原样（换 `model`） | Bearer | `input_tokens`、`output_tokens`、`cost` |
| `clairic` | `{model, state, fields, images?: [{content_type, base64}], reference_date?, options?}` | Bearer | `input_tokens`、`output_tokens` |

System One 族上游的图片写法由渠道 `imageMode` 决定：`assets`（默认，TypeSafe）、`images-base64`（顶层 `images` 为 Base64 字符串数组，Ollama）、`images-subq`（`images: [{mediaType, base64}]`，SubQ）、`images-cloudflare`（`images: [{content_type, base64}]`，Cloudflare Clef）、`state-image-url`（`state` 里放 `{type: "image_url", image_url: {url: data URL}}`，Perplexity、Requesty、Inception）。

上游是另一台装了本插件的 New API 时，`parallel` 按 `systemone`、`cloudflare_openai` 按 `openai`、`clairic` 按 `extractions` 发给对方。插件内部会使用对方的专属入口确保命中 Decision：`vercel_sdk` 使用 `/decision/v1/evaluate`（带 `model`），`databricks` 使用 `/decision/api/2.0/ai-functions/ai-decide` 并带上 `model`。这不改变普通客户端默认直接使用原生路径的建议。

上游回复如果包在 `{result, success}` 里（Cloudflare Workers AI），会先拆开。回复是 200 但带 `error` 对象时按上游错误处理。

## 转换规则

可以无损的原样保留；能可靠对应的做兼容转换；无法表达的报错，不静默丢弃问题、输入、概率或会影响结果的参数，也不编造上游没给的数据。

### 共享输入

| 来源 → 目标 | System One `state` | OpenAI `input` | Gemini `input` | Vercel `state` | Databricks `state` |
| --- | --- | --- | --- | --- | --- |
| 纯文本 | 字符串 | 字符串 | 字符串 | 字符串 | 字符串 |
| JSON 对象 | 对象 | `[{role: user, content: [input_json]}]` | JSON 文本块 | 对象 | 对象 |
| 文本、JSON、图片混合 | 数组；图片变成新的引用（UUID）放进 `assets` | `input_text` / `input_json` / `input_image` 片段 | `text` / 图片块，JSON 写成文本 | 片段数组 | 文本和 JSON 组成数组；有图片报错 |
| System One 字符串里的图片引用 | 原样 | 拆成文本和图片片段 | 拆成文本和图片块 | 拆成文本和 file 片段 | 报错 |
| System One JSON 对象里的图片引用 | 原样 | 报错 | 报错 | 报错 | 报错 |
| OpenAI 非 user 消息、工具项 | 报错 | 原样 | 报错 | 报错 | 报错 |

System One 和 Databricks 客户端发往 Databricks 上游时，`state`、指令、选项说明和等级按客户端原样发送（无图片时）。

JSON 转文本的做法与 Vercel 官方迁移指南一致。

### 问题

| 概念 | System One | OpenAI | Gemini | Vercel | Databricks |
| --- | --- | --- | --- | --- | --- |
| 是非题 | `noul` | `predicate` | `noul` | `boolean` | `noul` |
| 是非题的真/假说明 | `criteria.true/false` | 追加到 `instructions` 末尾：`true: …` / `false: …`（Vercel 迁移指南的做法） | `true_description` / `false_description` | `criteria.true/false` | `criteria.true/false`（null 省略） |
| 选项 | `criteria` 对象的键 | `choices[].value`（字符串或布尔） | `criteria` 的键 | `criteria` 的键 | `criteria` 的键 |
| 选项说明 | 对象的值（可为对象、null） | `description`（JSON 写成文本，null 省略） | 值（文本，null 写成空串） | 值 | 对象的值（可为对象、null） |
| 等级 | `criteria` 数组 | `levels[].label`（来自 OpenAI 的 `description` 写成 `标签: 说明`） | `criteria` 数组（同左） | `criteria` 数组 | `criteria` 数组（同左） |
| 问题名 | 键 | `name`（可省略，自动生成） | 键 | 键 | 键 |
| 指令 | 可省略 | 必填：省略时用问题名，System One 本来就把问题名给模型看 | 必填，同左；只能是文本 | 可省略 | 必填，同左 |

OpenAI 的布尔选项值发往其它协议时写成 `"true"` / `"false"`，回复时还原成布尔；同一题里同时有 `true` 和 `"true"` 会报错。

### 答案

| 概念 | 说明 |
| --- | --- |
| 是非题概率 | System One `noul`、OpenAI `probability`、Gemini `noul`、Vercel `probability`、Databricks `probability`，都是"为真"的概率，直接对应 |
| 选项概率 | 对象和数组互转，按请求里的选项顺序；选中项按值匹配 |
| 分数 | 各家都是等级下标的概率加权平均（可为小数），直接对应 |
| 等级概率 | 按下标对应；`legend` 由请求里的等级生成，`label` 同理 |
| `confidence` | System One、OpenAI 的 confidence 是厂商自己的统计量，原样转递，没有就为 `null`；Gemini 文档定义 confidence 为 noul 的 max(p, 1−p)、选择和评分的最高概率，所以 Gemini 客户端拿到的是按此定义从概率算出的值 |
| 拒答 | OpenAI `refusal` ↔ System One `{"type":"refusal"}` ↔ Gemini `prompt_feedback`；Gemini 整体拦截（`block_reason`）在其它协议里每题都是拒答 |

上游少答、答错类型、选了不存在的选项时返回 502，不补答案。

### 用量

统一成"总输入（含缓存读写）、缓存读取、缓存写入、输出、推理"，再按客户端格式输出。计费字段见下文。上游回复没有 usage 时，回复正常返回，计费保留预扣；Databricks ai-decide 本来就不报用量，按次结算，其它格式的回复里 token 数为 0。

## 多模态

| 内容 | 客户端可用格式 | System One 上游 | OpenAI 上游 | Gemini 上游 | Vercel 上游 | Databricks 上游 |
| --- | --- | --- | --- | --- | --- | --- |
| 文本 | 全部 | 原生 | 原生 | 原生 | 原生 | 原生 |
| JSON | System One、OpenAI、Vercel、Databricks | 原生 | 原生（`input_json`） | 转成 JSON 文本 | 原生 | 原生 |
| 图片 Base64 | 除 Databricks 外 | 原生（PNG、JPEG） | 转 data URL | 原生 | 原生 | 不支持 |
| 图片 URL | OpenAI、Gemini、Vercel | 不支持（TypeSafe 只收 Base64 和上传） | 原生 | 原生（需能从扩展名得知类型） | 原生 | 不支持 |
| multipart 文件 | System One | 原样转发分段 | 转 data URL | 转 Base64 | 转 Base64 | 不支持 |
| 音频、视频 | Gemini、Vercel | 不支持 | 不支持 | 原生 | 取决于 Vercel 路由的模型 | 不支持 |
| PDF 等文档 | Gemini、Vercel、ScaleDown | 不支持 | 不支持 | 原生 | 同上 | 不支持 |
| 指令里的图片 | System One、OpenAI | 原生 | 原生 | 不支持 | 不支持 | 不支持 |
| 选项、等级里的图片 | System One | 原生 | 不支持 | 不支持 | 不支持 | 不支持 |
| Box 定位 | System One、OpenAI、Vercel | 原生 | 交给上游 | 不支持 | 原生 | 不支持 |

System One 上游一列是默认的 `assets` 写法；其它 `imageMode` 只接受共享输入里的 Base64 或上传图片（PNG、JPEG，Ollama 以外还有 WebP），不接受图片 URL、指令或选项里的图片。Parallel 不接受图片，Cloudflare `openai/decisions` 只接受 data URL 图片。

"不支持"都会报 `unsupported_modality` / `unsupported_content` / `unsupported_question_type`，不会把媒体转成文字。

## 数量限制

插件按目标协议检查，超出直接报 `limit_exceeded`（400），**不截断、不拆分**。

| 协议 | 问题数 | 选择题选项 | 评分等级 |
| --- | --- | --- | --- |
| System One | 不限（受上下文限制） | 1–255 | 1–10 |
| OpenAI | 1–400 | 2–255 | 2–10 |
| Gemini | ≥ 1 | 2–255 | 2–255 |
| Vercel | 不限 | ≥ 1 | ≥ 1 |
| Databricks | 不限（文档未写上限） | 1–255 | 2–10 |
| Parallel | 1–100 | 2–255 | 2–10 |
| Cloudflare `openai/decisions` | 1–200 | 2–255 | 同 OpenAI |

渠道的 `maxQuestions` 可以设更小的上限（如 Bespoke 64、Parallel 100、Telnyx 64）。超出时请客户端分批：New API 任务插件每次提交只能发一个上游请求。

## 错误

错误用客户端协议自己的格式，HTTP 状态码保留：

| 客户端协议 | 格式 |
| --- | --- |
| System One、ScaleDown | `{"detail": "…"}`；插件的错误为 `{"detail": {"error_type": "<code>", "message": "…"}}`；上游 TypeSafe 错误原样返回 |
| OpenRouter | `{"error": {"code": <状态码>, "message": "…"}}` |
| OpenAI、System One 形状的 `/v1/decisions` | `{"error": {"message", "type", "param", "code"}}`；上游已是这种格式时原样返回 |
| Gemini | `{"error": {"code", "message", "status"}}` |
| Vercel | `{"error": {"message", "type"}}` |
| Extractions | `{"error": {"code": <状态码>, "message": "…"}}`，同 OpenRouter |
| Databricks | `{"error_code": "INVALID_PARAMETER_VALUE" 等, "message": "…"}`，`error_code` 按状态码取 Databricks 的值；上游已是这种格式时原样返回 |

插件的错误码：

| code | 状态 | 含义 |
| --- | --- | --- |
| `invalid_request` | 400 | 请求不合法 |
| `unknown_field` | 400 | 该格式没有这个字段 |
| `unsupported_content` | 400 | 内容结构无法用上游协议表达 |
| `unsupported_modality` | 400 | 上游不支持这种媒体 |
| `unsupported_question_type` | 400 | 上游不支持这种题型 |
| `unsupported_field` | 400 | 会影响结果的厂商字段无法在上游生效 |
| `limit_exceeded` | 400 | 超出数量限制 |
| `invalid_model` | 400 | 直接请求了 `decision-custom` |
| `invalid_config` | 500 | 渠道配置错误（路径、密钥头） |
| `upstream_invalid` | 502 | 上游回复缺答案或答案不匹配 |
| `upstream_error` | 502 | 上游 200 回复里带错误（含 Cloudflare 的 `success: false`） |
| `unsupported_field_type` | 400 | 抽取字段的类型不存在 |

上游返回的 4xx/5xx（如 401、429）按原状态码返回，消息取自上游。错误里不会带渠道密钥。模型只有倍率或固定价格、渠道又没打开 `perCallPrice` 时（Databricks ai-decide 除外），New API 返回 400 `plugin usage hook failed`，见 [README](README.md#价格从哪里来)。

## 计费字段

| 字段 | 模型 | 含义 |
| --- | --- | --- |
| `input_tokens` | 全部 | 输入 token，不含缓存读取和缓存写入 |
| `cache_read_tokens` | 全部 | 缓存读取 token |
| `cache_write_tokens` | 全部 | 缓存写入 token |
| `output_tokens` | 除 `gpt-6-luna` 外 | 输出 token |
| `requests` | 除 `gpt-6-luna` 外 | 成功请求数，恒为 1 |
| `upstream_cost` | 全部 | 上游回复里报告的费用（美元）：System One 族和 OpenAI 形状的 `usage.cost`，或 Eden AI 顶层的 `cost`。上游不报告时没有这一项；回复给客户端时去掉 |
| `long_context` | `gpt-6-luna` 系列 | 总输入超过 272K token |

- `gpt-6-luna` 系列指 `gpt-6-luna`、`openai/gpt-6-luna`、`openai/gpt-6-luna-decisions`、`gpt-6-luna-decisions`，以及重定向到它们、或由它们重定向而来的名字。这是插件里唯一的专属计费配置，因为只有它同时用于聊天和决策；其它模型都用上表的通用字段，插件不含任何单价。
- 上游是 Databricks ai-decide 时只上报 `requests`，不上报、也不编造 token 字段；读 token 字段的表达式会求值失败，请求被拒绝而不是免费。
- 价格的查找顺序（插件覆盖价 → 模型级任务表达式 → 重定向后名字的表达式 → 固定价格）、倍率为什么不能用、表达式示例和预扣规则见 [README](README.md#计费)。

## 兼容性

2026-11-12 按各家官方文档核对。"已测"指单元测试用严格的模拟上游跑过，核心 3 × 3、Vercel 客户端和 Databricks（客户端与上游）还在隔离的 New API rc.50 上端到端跑过；"真实"指经真实上游（OpenCode、OpenCSG 的 System One 接口）测过。

**核心协议（双向转换，已测）**

| 客户端 \ 上游 | System One | OpenRouter | OpenAI | Gemini | Vercel | Vercel SDK | Databricks | Parallel | Cloudflare openai |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| System One | 已测、真实 | 已测 | 已测、真实 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 |
| OpenRouter | 已测、真实 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 |
| OpenAI | 已测、真实 | 已测 | 已测、真实 | 已测、真实 | 已测 | 已测 | 已测 | 已测 | 已测 |
| Gemini | 已测、真实 | 已测 | 已测 | 已测、真实 | 已测 | 已测 | 已测 | 已测 | 已测 |
| Vercel | 已测、真实 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 |
| System One 形状 `/v1/decisions` | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 |
| ScaleDown | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 |
| Databricks | 已测、真实 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 | 已测 |

抽取：OpenRouter Extractions 客户端 → `extractions`（OpenRouter）、`clairic`（Cloudflare）上游，已测。

**厂商与入口**

| 厂商 / 入口 | 状态 | 请求格式 | 怎么接 |
| --- | --- | --- | --- |
| TypeSafe `api.typesafe.ai/v1/systemone` | 官方 | System One | `systemone` |
| OpenAI `/v1/decisions` | 官方 | OpenAI | `openai` |
| Google `generativelanguage.googleapis.com/v1beta/decisions` | 官方 Beta | Gemini | `gemini` |
| Vercel `/v1/decisions` | 官方 | OpenAI | `openai`，Base URL `https://ai-gateway.vercel.sh` |
| Vercel System One 兼容入口 | 官方 | System One | `systemone`，上游请求路径按 Vercel 官方文档配置 |
| Vercel `/v1/evaluate` | 官方，已弃用仍可用 | AI SDK 评估格式 | `vercel` |
| Vercel `/v4/ai/evaluation-model` | SDK 内部接口 | AI SDK 评估格式 | `vercel_sdk` |
| OpenRouter `/api/alpha/decisions`、`/api/v1/systemone` | 官方（alpha） | System One + 扩展 | `openrouter`，Base URL `https://openrouter.ai` |
| Azure OpenAI `/openai/v1/decisions` | 官方 | OpenAI | `openai`，路径 `/openai/v1/decisions`，密钥头 `api-key`，模型填部署名 |
| Microsoft Foundry `/providers/microsoft/v1/systemone` | 官方 Preview | System One | `systemone` + 该路径；用量字段名未公开，按 System One 读取 |
| Perplexity `/v1/decisions` | 官方 | System One 形状 + 扩展 | `systemone` + 路径 `/v1/decisions`，图片 `imageMode` 选 `state-image-url`；`locate` 题同族直通 |
| Liquid AI `/decisions/v1/systemone` | 官方 | System One | `systemone`，Base URL `https://api.liquid.ai/decisions` |
| Upstage Solar Decide `/v1/systemone` | 官方 Beta，无请求示例 | System One | `systemone` |
| Bespoke Nimble `/v1/systemone` | 官方 | System One 子集 | `systemone`，`maxQuestions` 64 |
| SubQ Snap `/v1/systemone` | 官方 | System One，图片放顶层 `images` | `systemone`，`imageMode` 选 `images-subq` |
| Inception Mercury Decide `/v1/decisions` | 官方 | System One 形状 + `extract` | `systemone` + 路径 `/v1/decisions`；`extract` 只能同族直通 |
| Parallel `/v1/decisions` | 官方 | 无 `model` 字段，`x-api-key`，按次收费 | `parallel`；价格用 `u("requests") * 0.001`；只用模拟上游测过 |
| Cloudflare Workers AI `openai/decisions` | 官方 | OpenAI 请求体包在 `{model, input}` 里 | `cloudflare_openai`，`upstreamModels` 映射为 `openai/decisions`；只用模拟上游测过 |
| OpenRouter `/api/alpha/extractions` | 官方（alpha） | Extractions | 客户端路由和 `extractions` 上游；只用模拟上游测过 |
| Cloudflare Workers AI Clairic | 官方 Preview | Extractions 字段 + `images` 数组 | `clairic`；只用模拟上游测过 |
| Databricks System One 兼容路由 | 官方 | System One | `systemone`，上游请求路径按 Databricks 官方文档配置 |
| Databricks `/api/2.0/ai-functions/ai-decide` | 官方 Beta | System One 形状，无模型、无用量、无图片 | `databricks`，Base URL 填工作区地址；按次计费；只用模拟上游测过 |
| ScaleDown `/v1/scaledown` | 官方 | System One + 文档 state | 客户端路由支持；上游用 `systemone` + 路径 `/v1/scaledown`（只发文本） |
| LiteLLM `/v1/systemone`、`/v1/decisions` | 官方 | System One / OpenAI | `systemone` 或 `openai` |
| Bifrost `/v1/decisions`、`/openai/v1/decisions` | 官方 | OpenAI，用量为 `prompt_tokens` | `openai` |
| Cloudflare Workers AI Clef | 官方 | System One，回复外层 `{result}` | `systemone`，路径 `/client/v4/accounts/<ID>/ai/run/@cf/cloudflare/{model}`，`imageMode` 选 `images-cloudflare` |
| Fireworks `/inference/v1/systemone`、`/inference/v1/decisions` | 官方 | System One / OpenAI | 对应协议 + 路径 |
| Baseten、Telnyx、vLLM、Ollama、Requesty、LLM Gateway、Respan、Eden AI | 官方 | System One 或 OpenAI 形状 | 选对应协议，路径按各家文档 |
| OpenCode `/inference/systemone` | 第三方 | System One，usage 带自有计费字段 | `systemone`，Base URL `https://opencode.ai/inference/systemone`，真实测过 |
| OpenCSG AIGateway | 第三方 | System One，每题必须有指令 | `systemone` + `fillInstructions`，Base URL `https://opencsg.com/aigateway`，真实测过 |

用的是"System One + 扩展"的厂商时，只用 System One 标准字段最稳妥；扩展字段在同族直通时原样转发，跨协议时按上面的规则处理。

## 声明的模型

New API 只把任务插件声明的模型（或重定向到它们的名字）交给插件，所以插件在 `meta.models` 里声明了下列 ID，渠道里可以直接勾选。未声明的名字重定向到路由槽位 `decision-custom`。核实日期 2026-11-13；每个 ID 都来自下列官方来源，没有推测出来的名字。已声明的 ID 以后不会删除，渠道和价格可以放心引用。

| 厂商 | 可直接勾选的模型 ID | 上游怎么接 |
| --- | --- | --- |
| TypeSafe Jev | `jev-1.14.0`、`jev-1.13.0`、`jev-latest`、`jev-preview`、`jev` | `systemone`，Base URL `https://api.typesafe.ai` |
| Jev（网关写法） | `typesafe/jev-1.14`、`typesafe/jev-1.13`、`~typesafe/jev-latest`（OpenRouter）；`typesafe-ai/jev`、`typesafe-ai/jev-1.14.0`、`typesafe-ai/jev-1.13.0`（Vercel）；`typesafe/jev-latest`（LiteLLM、Eden AI） | 对应网关的协议 |
| Databricks System One 路由 | `system.ai.typesafeai-jev-1-14-0`、`system.ai.openjev-qwen35-4b` | `systemone` + 路径 `/ai-gateway/typesafe/v1/systemone` |
| OpenAI | `gpt-6-luna`、`gpt-6-luna-decisions`、`openai/gpt-6-luna`、`openai/gpt-6-luna-decisions` | `openai`；OpenRouter 用 `openai/gpt-6-luna-decisions` |
| Google Gemini | `gemini-decision-1`、`google/gemini-decision-1` | `gemini` |
| Liquid AI | `d1.1`、`d1-ultra`；`liquid/d1`、`liquid/d1.1`、`liquid/d1-ultra`、`~liquid/d1-latest`、`~liquid/d1-ultra-latest` | 官方 `systemone`，Base URL `https://api.liquid.ai/decisions`；带前缀的是 OpenRouter / Vercel 写法 |
| Laya（Convai Innovations） | `convaiinnovations/laya` | Vercel AI Gateway；自建 `laya-serve` 见下 |
| Perplexity | `pplx-decider-v1.3`、`pplx-decider-flash-v1.3`、`pplx-decider-v1.2`、`pplx-decider-flash-v1.2`、`pplx-decider-latest`、`pplx-decider-flash-latest`、旧名 `pplx-decider-v1.1-27b`、`pplx-decider-v1-27b`；`perplexity/pplx-decider-v1.3`、`perplexity/pplx-decider-flash-v1.3`、`perplexity/pplx-decider-v1.2`、`perplexity/pplx-decider-flash-v1.2`、`perplexity/pplx-decider-latest`、`perplexity/pplx-decider-flash-latest`、`perplexity/pplx-decider-v1.3:free`、`perplexity/pplx-decider-flash-v1.3:free`、`~perplexity/pplx-decider-latest`、`~perplexity/pplx-decider-flash-latest` | 官方 `systemone` + 路径 `/v1/decisions` |
| Microsoft | `microsoft-decision-1`、`microsoft/microsoft-decision-1` | Foundry 用 `systemone` + 路径 `/providers/microsoft/v1/systemone`，模型重定向到你的部署名 |
| Upstage | `solar-decide`、`upstage/solar-decide`、`upstage/solar-decide-flash` | `systemone` |
| Bespoke Labs Nimble | `nimble-latest`、`nimble-v4.1-max`、`nimble-v4-max`、`nimble-v4`、`nimble-v3` | `systemone`，`maxQuestions` 64 |
| SubQ | `subq-snap-1.2`、`subq-snap-1.1`、`subq-snap-latest`、`subq-snap-preview` | `systemone`（只发文本） |
| Inception | `mercury-decide` | `systemone` + 路径 `/v1/decisions` |
| Telnyx | `telnyx/decision-flash`、`telnyx/decision-pro` | `systemone` + 路径 `/v2/ai/typesafe/v1/systemone`，打开 `fillInstructions` |
| Cloudflare Clef | `clef`、`clef-flash`、`clef-omni`；`cloudflare/clef`、`cloudflare/clef-flash`、`cloudflare/clef-omni` | Workers AI 用 `systemone` + 路径 `/client/v4/accounts/<账号ID>/ai/run/@cf/cloudflare/{model}` |
| Ollama | `nimble`、`clef:cloud` | `systemone` |
| ScaleDown | `classify`、`classify-1`、`scaledown/classify-1`、`scaledown/scaledown-classify-1` | `systemone` + 路径 `/v1/scaledown` |
| Baseten | `decision-models/baseten-joey-2b-latest`、`decision-models/baseten-elephant-9b-latest`、`decision-models/baseten-mammoth-27b-latest`；`baseten/joey-1`、`baseten/elephant-1`、`baseten/mammoth-1` | `systemone`，Base URL `https://inference.baseten.co` |
| Fireworks | `accounts/fireworks/models/rune` | `systemone` + 路径 `/inference/v1/systemone`，或 `openai` + `/inference/v1/decisions` |
| Nace.AI Drex | `drex-latest`、`drex-max`、`drex-v2.0`、`drex-v1.5`；`nace-ai/drex-max`、`nace-ai/drex-max-finance`、`nace-ai/drex-v2.0`、`nace-ai/drex-v1.5`、`nace-ai/drex-max-v1.1` | `systemone`，Base URL `https://console.nace.ai` |
| Morph | `reflex`、`morph/reflex` | `systemone`，Base URL `https://api.morphllm.com` |
| Respan | `span-02`、`respan/span-02`、`respan/span-01`、`respan/span-01-lite`、`respan/span-01-lite:free` | `systemone` + 路径 `/api/v1/systemone` |
| Together AI | `together/Tev1-4B-experimental`、`togethercomputer/tev1-4b-experimental` | 按 Together / OpenRouter 的接口 |
| 只在 OpenRouter | `heygen/heygen-decision-1`、`heygen/heygen-decision-1-turbo`、`jaredpalmer/kev-4b`、`parallel/decisions-fast:free` | `openrouter` |
| Parallel（Vercel） | `parallel/parallel-decisions-fast` | Vercel 的协议 |
| 抽取模型（[Extractions](README.md#抽取extractions)） | `cloudflare/clairic`、`clairic`、`scaledown/extract`、`inference-net/schematron-v2-small`、`inference-net/schematron-v2-turbo`、`inception/mercury-decide`、`levanto/sage-2`，以及决策模型 `perplexity/pplx-decider-v1.3`、`perplexity/pplx-decider-flash-v1.3` | `extractions`（OpenRouter）；`clairic`（Cloudflare Workers AI） |
| 其它任意名字 | 路由槽位 `decision-custom` | 见 [README](README.md#完整示例接入任意模型名) |

来源：

- 官方文档：[TypeSafe](https://docs.typesafe.ai/models)、[OpenAI Decisions](https://developers.openai.com/api/docs/guides/decisions)、[Gemini Decision 1](https://aistudio.google.com/docs/models/gemini-decision-1)、[Liquid AI](https://docs.liquid.ai/api/guides/decisions.md)、[Perplexity](https://docs.perplexity.ai/api-reference/decisions-post.md)、[Upstage](https://console.upstage.ai/docs/models/solar-decide.md)、[Bespoke Labs](https://docs.bespokelabs.ai/api-reference/systemone.md)、[Inception](https://docs.inceptionlabs.ai/api-reference/decisions/create-a-decision.md)、[Telnyx](https://developers.telnyx.com/api-reference/decision-models/evaluate-decision-models-typesafe-compatible.md)、[Cloudflare Clef](https://developers.cloudflare.com/workers-ai/models/clef)、[Microsoft Foundry](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/how-to/use-foundry-models-microsoft-decision)、[ScaleDown](https://docs.scaledown.ai/api-reference/decisions.md)、[Baseten](https://docs.baseten.co/inference/model-apis/decision-models)、[Fireworks](https://docs.fireworks.ai/api-reference/post-systemone.md)、[Databricks](https://docs.databricks.com/aws/en/machine-learning/model-serving/query-systemone-models)、[Nace.AI](https://www.nace.ai/drex.md)、[Morph](https://docs.morphllm.com/models/reflex.md)、[Respan](https://www.respan.ai/docs/ai-gateway/modalities/decisions)、[Together Tev1](https://huggingface.co/togethercomputer/Tev1-4B-experimental)、[Laya](https://huggingface.co/convaiinnovations/laya)、[Ollama](https://docs.ollama.com/api/systemone.md)、[LLM Gateway](https://docs.llmgateway.io/features/system-one)、[LiteLLM](https://docs.litellm.ai/docs/decisions)。
- 实时模型目录：OpenRouter `GET https://openrouter.ai/api/v1/models?output_modalities=decisions`、Vercel AI Gateway `GET https://ai-gateway.vercel.sh/v1/models`（`type` 为 `evaluation`）、SubQ `GET https://api.subq.ai/v1/models`。
- 刻意没有声明的：
  - Cloudflare 的 `@cf/cloudflare/clef` 等目录名：New API 把 `@` 当作模型修饰符分隔符；请求体里的 `clef` 等已覆盖。
  - Cloudflare `openai/decisions`：它只是 Workers AI 上的上游模型 ID，客户端用 `gpt-6-luna` 等名字，渠道用 `cloudflare_openai` 协议并把模型映射为 `openai/decisions`。
  - Microsoft 目录名 `Microsoft-Decision-1`：与 `microsoft-decision-1` 只差大小写，New API 不区分大小写；Foundry 请求实际要填部署名。
  - 第三方 Laya 托管站（laya.studio 等）和自建 `laya-serve` 的 `english`、`multilingual` 等路由名，以及只出现在第三方页面的名字（如 Liquid `d1:free`）。

