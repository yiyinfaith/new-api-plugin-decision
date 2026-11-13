<p align="center"><img src="icon.svg" alt="Decision" width="128" /></p>

# Decision — New API 决策模型插件

NewAPI 通用决策模型插件，支持多种决策协议双向转换、任意模型接入、自定义上游协议及路径、智能路由与灵活计费。

- **N × N 协议互通**：客户端可以用 TypeSafe System One、OpenAI Decisions、Gemini Decisions、Vercel Evaluation、OpenRouter、Databricks ai-decide 任一格式请求，上游可以是其中任一协议，也可以是 Parallel、Cloudflare Workers AI 的原生接口。插件经统一中间表示（Decision IR）转换请求，并把回复转回客户端自己的格式。
- **上游协议手动指定**：在渠道里选协议、路径和密钥请求头，可按模型分别覆盖；从不根据域名猜协议，未知中转站也能接。
- **抽取（Extractions）**：支持 OpenRouter 的 Extractions API，从文本或图片里抽取有类型的字段，上游可以是 OpenRouter 或 Cloudflare Clairic，见[抽取](#抽取extractions)。
- **常见模型开箱即用**：声明了 100 多个经官方文档或模型目录核实的决策模型 ID（Jev、Liquid d1、Laya、OpenAI、Gemini、Perplexity 等），渠道里直接勾选；其它名字重定向到 `decision-custom` 即可，见[模型](#模型)。
- **按真实用量计费**：输入、缓存读取、缓存写入、输出分开上报。普通模型直接用 New API 的模型级任务表达式；只有 `gpt-6-luna` 要另配插件覆盖价，和它的普通聊天计费互不影响。不报用量的 Databricks ai-decide 按次计费。
- **完整的 System One 能力**：四种问题类型、图片、TypeSafe SDK 的 multipart 上传、长上下文、错误格式、JSON 键顺序。

当前版本：v1.1.0，渠道配置（`channelConfig`）需要 rc.50 及以上。

**完整的接口字段、转换规则、兼容性矩阵和报错格式见 [API.md](API.md)。**

## 安装

1. Root 账户登录 New API 后台 →「任务插件」→「上传插件」→「从 URL 导入」，填入 Raw 地址：

   ```text
   https://raw.githubusercontent.com/yiyinfaith/new-api-plugin-decision/main/plugin.js
   ```

2. 确认 key 为 `decision`，安装并启用。更新时重复这一步，渠道和价格都会保留。
3. 新建渠道：类型 **Task Plugin（61）**，插件选 **Decision**；Base URL 填上游地址（不带接口路径），密钥填上游的 API Key 原文。
4. 在渠道的插件配置里选**上游协议**，勾选模型，然后[配置价格](#计费)。

## 渠道配置

| 配置项 | 说明 |
| --- | --- |
| 上游协议 `protocol` | 发往本渠道的请求格式，默认 `systemone`，见下表 |
| 上游路径 `path` | 留空用协议默认路径；可写任意路径，`{model}` 代表上游模型 ID（会做 URL 编码） |
| 密钥请求头 `authType` | `auto`（协议默认）、`bearer`、`x-goog-api-key`、`api-key`、`x-api-key`、`custom`、`none` |
| 自定义密钥请求头名 `authHeader` | `authType` 为 `custom` 时填写，如 `X-Vendor-Key` |
| 按模型指定上游协议 `modelProtocols` | `{"模型名": "协议"}`，覆盖渠道协议 |
| 按模型指定上游路径 `modelPaths` | `{"模型名": "/路径"}`，覆盖渠道路径 |
| 按模型指定上游模型 ID `upstreamModels` | `{"模型名": "上游 ID"}`，覆盖模型重定向后的名字 |
| System One 上游的图片写法 `imageMode` | 默认 `assets`（TypeSafe）。兼容 System One、但图片写法不同的厂商要改：`images-base64`（Ollama）、`images-subq`（SubQ）、`images-cloudflare`（Cloudflare Clef）、`state-image-url`（Perplexity、Requesty、Inception），见[多模态](#多模态)。上游是另一台 New API 时不生效，总按 `assets` 发送 |
| 允许模型固定按次价格 `perCallPrice` | 默认关。打开后，本渠道的模型可以用 New API 的固定价格（按次计费），上游回复有没有用量、有没有费用都能正常调用，见[按次计费](#按次计费模型固定价格) |
| 缺少指令时用问题名补上 `fillInstructions` | 默认关。发往 System One 族上游时，没写 `instructions` 的问题用问题名补上；OpenCSG、Telnyx、Requesty 等要求每题都有指令的上游需要打开 |
| 单次问题数上限 `maxQuestions` | 0 = 协议上限（OpenAI 400，其余不限）；超出直接报错，不拆分 |
| 最多预扣输入 token `reserveTokens` | 0 = 协议上下文上限；见[预扣](#预扣与结算) |

优先级：**按模型的配置 > 渠道配置 > 协议默认值**。按模型的配置先按客户端请求的模型名找，再按重定向后的名字找。

| 协议 `protocol` | 默认路径 | 默认密钥头 | 适用 |
| --- | --- | --- | --- |
| `systemone` | `/v1/systemone` | Bearer | TypeSafe、Liquid（Base URL 加 `/decisions`）、Upstage、Bespoke、Microsoft Foundry、Databricks System One 路由、Fireworks、Baseten、Telnyx、vLLM、Ollama、Requesty、LiteLLM、OpenCode 等 System One 兼容接口 |
| `openrouter` | `/api/alpha/decisions` | Bearer | OpenRouter（System One 加 `provider` 等字段） |
| `openai` | `/v1/decisions` | Bearer | OpenAI、Azure OpenAI（路径 `/openai/v1/decisions`，密钥头 `api-key`）、Fireworks、LiteLLM、Bifrost、LLM Gateway、Vercel `/v1/decisions` |
| `gemini` | `/v1beta/decisions` | `x-goog-api-key` | Google Gemini Decisions |
| `vercel` | `/v1/evaluate` | Bearer | Vercel AI Gateway Evaluation（旧接口，仍可用） |
| `vercel_sdk` | `/v4/ai/evaluation-model` | Bearer | Vercel AI SDK 内部接口（模型放在 `ai-model-id` 头） |
| `databricks` | `/api/2.0/ai-functions/ai-decide` | Bearer | Databricks AI Functions ai-decide（Beta）。请求里不带模型，回复没有 token 用量，[按次计费](#databricks-ai-decide按次计费) |
| `parallel` | `/v1/decisions` | `x-api-key` | Parallel 官方接口，Base URL `https://api.parallel.ai`。请求里不带模型、不能带图片；Parallel 按次收费，价格用 `u("requests") * 0.001` |
| `cloudflare_openai` | `/ai/run` | Bearer | Cloudflare Workers AI 的 `openai/decisions`（GPT-6 Luna），Base URL `https://api.cloudflare.com/client/v4/accounts/<账号ID>`，`upstreamModels` 把模型映射为 `openai/decisions`；图片只能是 data URL |
| `extractions` | `/api/alpha/extractions` | Bearer | [抽取](#抽取extractions)：OpenRouter Extractions API，Base URL `https://openrouter.ai` |
| `clairic` | `/ai/run/@cf/cloudflare/clairic` | Bearer | [抽取](#抽取extractions)：Cloudflare Workers AI Clairic，Base URL `https://api.cloudflare.com/client/v4/accounts/<账号ID>`，上游模型 `clairic` |

- Base URL 末尾已带路径第一段时不会重复：`https://api.typesafe.ai/v1` + `/v1/systemone` → `https://api.typesafe.ai/v1/systemone`。
- 地址带账号 ID 的平台（如 Cloudflare Workers AI）把完整路径写进 `path`，例如 `/client/v4/accounts/<账号ID>/ai/run/@cf/cloudflare/{model}`；Workers AI 外层的 `{result, success}` 会自动拆开。
- Databricks 的 Base URL 填工作区地址，如 `https://dbc-xxxx.cloud.databricks.com`，密钥填个人访问令牌或 OAuth 令牌（需要 `ai-functions` 权限）。
- 上游是另一台装了本插件的 New API 时，渠道类型选 **New API（60）**，在扩展插件里勾选 Decision。插件会自动使用对方的 Decision 专属入口，以确保跨网关路由准确；这是插件内部行为，不影响客户端优先使用原生路径。使用对方的令牌鉴权；`databricks` 协议这时会带上 `model`，供对方路由。
- 其它请求头（如厂商要求的版本头）用渠道自带的「请求头覆盖」设置。

### 示例：一个渠道里不同模型走不同上游协议

```json
{
  "protocol": "systemone",
  "modelProtocols": { "gpt-6-luna": "openai", "gemini-decision-1": "gemini" },
  "modelPaths": { "gpt-6-luna": "/openai/v1/decisions" },
  "upstreamModels": { "gpt-6-luna": "my-azure-deployment" }
}
```

效果如下：

- `jev-1.14.0` 走 System One。
- `gpt-6-luna` 用 OpenAI Decisions 发到 Azure 风格路径，并改名为部署名。
- `gemini-decision-1` 走 Gemini Decisions。

注意 Gemini 用 `x-goog-api-key`，而 `authType` 是渠道级的：协议默认密钥头不同的模型最好分开建渠道，或都用 `auto`。

### 示例：未知第三方中转站

中转站说它的接口是 `https://relay.example.com/proxy/decide`，请求体和 OpenAI Decisions 相同，密钥放在 `X-Relay-Key` 头里，模型叫 `vendor/luna-d`：

- Base URL：`https://relay.example.com`
- 插件配置：`{"protocol": "openai", "path": "/proxy/decide", "authType": "custom", "authHeader": "X-Relay-Key"}`
- 模型：勾选 `gpt-6-luna`，模型重定向 `{"gpt-6-luna": "vendor/luna-d"}`

## 模型

New API 只把插件声明过的模型、或重定向到声明模型的名字交给插件，这是宿主限制，见[已知限制](#已知限制)。所以插件声明了常见决策模型的 ID，在渠道「模型」里直接勾选即可，不用重定向。下表的每个 ID 都在厂商官方文档或模型目录里核实过（2026-11-13），没有编造；未来的新模型和自建模型用 `decision-custom` 接入。

| 厂商 | 可直接勾选的模型 ID | 上游怎么接 |
| --- | --- | --- |
| TypeSafe Jev | `jev-1.14.0`、`jev-1.13.0`、`jev-latest`、`jev-preview`、`jev` | `systemone`，Base URL `https://api.typesafe.ai` |
| Jev（网关写法） | `typesafe/jev-1.14`、`typesafe/jev-1.13`、`~typesafe/jev-latest`（OpenRouter）；`typesafe-ai/jev`、`typesafe-ai/jev-1.14.0`、`typesafe-ai/jev-1.13.0`（Vercel）；`typesafe/jev-latest`（LiteLLM、Eden AI） | 对应网关的协议 |
| Databricks System One 路由 | `system.ai.typesafeai-jev-1-14-0`、`system.ai.openjev-qwen35-4b` | `systemone` + 路径 `/ai-gateway/typesafe/v1/systemone` |
| OpenAI | `gpt-6-luna`、`gpt-6-luna-decisions`、`openai/gpt-6-luna`、`openai/gpt-6-luna-decisions` | `openai`；OpenRouter 用 `openai/gpt-6-luna-decisions` |
| Google Gemini | `gemini-decision-1`、`google/gemini-decision-1` | `gemini` |
| Liquid AI | `d1.1`、`d1-ultra`；`liquid/d1`、`liquid/d1.1`、`liquid/d1-ultra`、`~liquid/d1-latest`、`~liquid/d1-ultra-latest` | 官方 `systemone`，Base URL `https://api.liquid.ai/decisions`；带前缀的是 OpenRouter / Vercel 写法 |
| Laya（Convai Innovations） | `convaiinnovations/laya` | Vercel AI Gateway；自建 `laya-serve` 见下 |
| Perplexity（发图片时 `imageMode` 选 `state-image-url`） | `pplx-decider-v1.3`、`pplx-decider-flash-v1.3`、`pplx-decider-v1.2`、`pplx-decider-flash-v1.2`、`pplx-decider-latest`、`pplx-decider-flash-latest`、旧名 `pplx-decider-v1.1-27b`、`pplx-decider-v1-27b`；`perplexity/pplx-decider-v1.3`、`perplexity/pplx-decider-flash-v1.3`、`perplexity/pplx-decider-v1.2`、`perplexity/pplx-decider-flash-v1.2`、`perplexity/pplx-decider-latest`、`perplexity/pplx-decider-flash-latest`、`perplexity/pplx-decider-v1.3:free`、`perplexity/pplx-decider-flash-v1.3:free`、`~perplexity/pplx-decider-latest`、`~perplexity/pplx-decider-flash-latest` | 官方 `systemone` + 路径 `/v1/decisions` |
| Microsoft | `microsoft-decision-1`、`microsoft/microsoft-decision-1` | Foundry 用 `systemone` + 路径 `/providers/microsoft/v1/systemone`，模型重定向到你的部署名 |
| Upstage | `solar-decide`、`upstage/solar-decide`、`upstage/solar-decide-flash` | `systemone` |
| Bespoke Labs Nimble | `nimble-latest`、`nimble-v4.1-max`、`nimble-v4-max`、`nimble-v4`、`nimble-v3` | `systemone`，`maxQuestions` 64 |
| SubQ | `subq-snap-1.2`、`subq-snap-1.1`、`subq-snap-latest`、`subq-snap-preview` | `systemone`，`imageMode` 选 `images-subq` |
| Inception | `mercury-decide` | `systemone` + 路径 `/v1/decisions`，`imageMode` 选 `state-image-url` |
| Telnyx | `telnyx/decision-flash`、`telnyx/decision-pro` | `systemone` + 路径 `/v2/ai/typesafe/v1/systemone`，打开 `fillInstructions` |
| Cloudflare Clef | `clef`、`clef-flash`、`clef-omni`；`cloudflare/clef`、`cloudflare/clef-flash`、`cloudflare/clef-omni` | Workers AI 用 `systemone` + 路径 `/client/v4/accounts/<账号ID>/ai/run/@cf/cloudflare/{model}`，`imageMode` 选 `images-cloudflare` |
| Ollama | `nimble`、`clef:cloud` | `systemone`，`imageMode` 选 `images-base64` |
| ScaleDown | `classify`、`classify-1`、`scaledown/classify-1`、`scaledown/scaledown-classify-1` | `systemone` + 路径 `/v1/scaledown` |
| Baseten | `decision-models/baseten-joey-2b-latest`、`decision-models/baseten-elephant-9b-latest`、`decision-models/baseten-mammoth-27b-latest`；`baseten/joey-1`、`baseten/elephant-1`、`baseten/mammoth-1` | `systemone`，Base URL `https://inference.baseten.co` |
| Fireworks | `accounts/fireworks/models/rune` | `systemone` + 路径 `/inference/v1/systemone`，或 `openai` + `/inference/v1/decisions` |
| Nace.AI Drex | `drex-latest`、`drex-max`、`drex-v2.0`、`drex-v1.5`；`nace-ai/drex-max`、`nace-ai/drex-max-finance`、`nace-ai/drex-v2.0`、`nace-ai/drex-v1.5`、`nace-ai/drex-max-v1.1` | `systemone`，Base URL `https://console.nace.ai` |
| Morph | `reflex`、`morph/reflex` | `systemone`，Base URL `https://api.morphllm.com` |
| Respan | `span-02`、`respan/span-02`、`respan/span-01`、`respan/span-01-lite`、`respan/span-01-lite:free` | `systemone` + 路径 `/api/v1/systemone` |
| Together AI | `together/Tev1-4B-experimental`、`togethercomputer/tev1-4b-experimental` | 按 Together / OpenRouter 的接口 |
| 只在 OpenRouter | `heygen/heygen-decision-1`、`heygen/heygen-decision-1-turbo`、`jaredpalmer/kev-4b`、`parallel/decisions-fast:free` | `openrouter` |
| Parallel | `parallel/parallel-decisions-fast`（Vercel） | Vercel 的协议；Parallel 官方接口用 `parallel` 协议，模型名随意（不发给上游） |
| 抽取模型（[Extractions](#抽取extractions)） | `cloudflare/clairic`、`clairic`、`scaledown/extract`、`inference-net/schematron-v2-small`、`inference-net/schematron-v2-turbo`、`inception/mercury-decide`、`levanto/sage-2`，以及决策模型 `perplexity/pplx-decider-v1.3`、`perplexity/pplx-decider-flash-v1.3` | `extractions`（OpenRouter）；`clairic`（Cloudflare Workers AI） |
| 其它任意名字 | 路由槽位 `decision-custom` | 见[完整示例](#完整示例接入任意模型名) |

- **按渠道选写法**：同一个模型在不同平台的 ID 不同（Liquid 官方是 `d1.1`，OpenRouter 是 `liquid/d1.1`）。上游默认收到渠道里的这个名字，所以要勾选和渠道上游一致的写法；想对外统一用一个名字时，用模型重定向或 `upstreamModels` 换成上游的写法，见[下文](#示例声明的模型换上游-id)。
- `~` 开头的是 OpenRouter 的别名，始终指向该系列的最新模型；`:free` 是 OpenRouter 的免费档。
- 模型名不区分大小写：请求 `togethercomputer/Tev1-4B-experimental` 也能匹配，但上游收到的是声明的写法 `togethercomputer/tev1-4b-experimental`；上游区分大小写时，用 `upstreamModels` 指定原样的 ID。
- 自建的 Laya（`laya-serve`）兼容 System One，用 `systemone` 协议；它的路由名（如 `english`、`multilingual`）比较通用，没有声明，按[任意模型名](#完整示例接入任意模型名)重定向到 `decision-custom`。
- 价格不随声明自动生效：每个要用的模型都按[计费](#计费)配置价格。

### 一个请求涉及的三个名字

| 名字 | 在哪里配 | 作用 |
| --- | --- | --- |
| 客户端模型名 | 请求的 `model`；渠道「模型」里要有它 | New API 按它选渠道、找价格 |
| 重定向后的名字 | 渠道「模型重定向」 | 未声明的客户端名字必须重定向到一个声明模型（通常是 `decision-custom`）；也是价格的后备，见[计费](#价格从哪里来) |
| 上游模型 ID | 插件配置 `upstreamModels`，或模型重定向 | 发给上游的 `model`；Databricks ai-decide 不带模型 |

发给上游的模型 ID 按顺序取第一个有值的：

1. `upstreamModels` 里客户端模型名对应的值。
2. `upstreamModels` 里重定向后名字对应的值。
3. 重定向到 `decision-custom` 时，用客户端模型名。
4. 否则用重定向后的名字。

直接请求 `decision-custom` 本身会报错（`invalid_model`）。

### 完整示例：接入任意模型名

假设中转站 `https://relay.example.com` 提供 System One 接口，有 `acme/decide-x` 和 `acme-decide-v2` 两个插件没声明的模型。你想让客户端用 `acme/decide-x` 和 `my-decider` 两个名字调用，其中 `my-decider` 实际发给 `acme-decide-v2`。

1. 新建渠道：类型 Task Plugin（61），插件 Decision，Base URL `https://relay.example.com`，密钥填中转站的 Key。
2. 「模型」填 `acme/decide-x,my-decider`。
3. 「模型重定向」填：

   ```json
   {"acme/decide-x": "decision-custom", "my-decider": "decision-custom"}
   ```

4. 插件配置填：

   ```json
   {"protocol": "systemone", "upstreamModels": {"my-decider": "acme-decide-v2"}}
   ```

5. 价格：在「模型价格」里给 `decision-custom` 配一个模型级任务表达式，所有重定向到它的名字共用。要分开定价时，给 `acme/decide-x`、`my-decider` 各配一个，名字自己的价格优先。

   ```text
   tier("base", u("input_tokens") * 0.05 / 1000000)
   ```

结果：

| 客户端 `model` | 上游收到的 `model` | 价格来自 |
| --- | --- | --- |
| `acme/decide-x` | `acme/decide-x` | `acme/decide-x` 自己的表达式，没有就用 `decision-custom` 的 |
| `my-decider` | `acme-decide-v2` | `my-decider` 自己的表达式，没有就用 `decision-custom` 的 |

```bash
curl https://你的域名/v1/decisions -H "Authorization: Bearer $NEW_API_KEY" -H "Content-Type: application/json" -d '{
  "model": "my-decider",
  "input": "The package arrived crushed.",
  "questions": [{"type": "predicate", "name": "damaged", "instructions": "Is the item damaged?"}]
}'
```

### 示例：声明的模型换上游 ID

声明过的名字可以直接重定向到任何上游 ID，不用经过 `decision-custom`。例如渠道「模型」勾选 `jev-latest`，模型重定向 `{"jev-latest": "jev-1.13-free"}`：客户端请求 `jev-latest`，上游收到 `jev-1.13-free`。价格仍然先找 `jev-latest` 的。用插件配置 `{"upstreamModels": {"jev-latest": "jev-1.13-free"}}` 效果相同，只是不改 New API 里记录的模型名。

## 调用

**默认直接使用各协议的原生请求路径，不需要添加任何插件前缀**（例如 `/v1/systemone`、`/v1/decisions`、`/v1beta/decisions`）。只有在路径确实被 New API 中的其他路由占用、请求无法进入 Decision 时（例如 `/v1/systemone` 的请求没有走到 Decision 的渠道），才在原路径前添加 `/decision`，例如 `/decision/v1/systemone`。带前缀的路径只进入本插件，适合排查路由问题；`/v1`、`/api` 这些路径段本身不代表冲突。路径决定客户端协议，`model` 决定渠道和上游协议。

| 客户端协议 | 路径 |
| --- | --- |
| TypeSafe System One | `POST /v1/systemone`（推荐）；兼容 `/decisions/v1/systemone`（Liquid）、`/providers/microsoft/v1/systemone`（Foundry） |
| OpenRouter | `POST /api/alpha/decisions`、`/api/v1/systemone` |
| OpenAI Decisions | `POST /v1/decisions`、`/openai/v1/decisions`（Azure、Bifrost） |
| Gemini Decisions | `POST /v1beta/decisions` |
| Vercel Evaluation | `POST /v1/evaluate` |
| ScaleDown | `POST /v1/scaledown` |
| Databricks ai-decide | `POST /api/2.0/ai-functions/ai-decide`（请求体加 `model`，供 New API 路由） |
| OpenRouter Extractions（[抽取](#抽取extractions)） | `POST /api/alpha/extractions` |

- `/v1/decisions` 按请求体区分：`input` + `questions` 数组是 OpenAI 格式；`state` 或 `questions` 对象是 Perplexity、Inception、Requesty 使用的 System One 形状，按 System One 处理，并返回 System One 格式。
- 鉴权只认 New API 令牌的 Bearer 写法：`Authorization: Bearer sk-...`。New API 只给内置的 google、vidu 插件转换厂商密钥头，所以本插件的路由不认 `x-goog-api-key`、`api-key`、`x-api-key`。
- 官方 SDK 换 Base URL 即可：
  - TypeSafe SDK 用 `https://你的域名`。
  - OpenAI SDK 用 `https://你的域名/v1`。
  - OpenRouter SDK 用 `https://你的域名/api`。
  - Google GenAI SDK 用 `https://你的域名`，并在 http options 里加 `Authorization: Bearer sk-...` 头（它默认只发 `x-goog-api-key`）。Azure SDK 同理，要改成发 Bearer 头。
  - Databricks ai-decide 格式直接用 HTTP 调用 `https://你的域名/api/2.0/ai-functions/ai-decide`，令牌填 New API 令牌，请求体里加 `model`。

```text
            客户端协议                         上游协议（按渠道/模型配置）
 System One ─┐                           ┌─ System One（TypeSafe 等）
 OpenAI     ─┤                           ├─ OpenRouter
 Gemini     ─┤                           ├─ OpenAI Decisions（含 Azure 等）
 Vercel     ─┼─ 解码 → Decision IR → 编码 ─┼─ Gemini Decisions
 OpenRouter ─┤                           ├─ Vercel Evaluation / AI SDK
 Databricks ─┘   回复按原路转回客户端格式    ├─ Databricks ai-decide
                                           └─ Parallel、Cloudflare openai/decisions
```

### Curl 示例

System One 格式调用 OpenAI Decisions（渠道协议 `openai`，模型 `gpt-6-luna`）：

```bash
curl https://你的域名/v1/systemone -H "Authorization: Bearer $NEW_API_KEY" -H "Content-Type: application/json" -d '{
  "model": "gpt-6-luna",
  "state": {"ticket": "The package arrived crushed and the mug inside is broken."},
  "questions": {
    "wants_refund": {"type": "noul", "instructions": "Does the customer want a refund?"},
    "request": {"type": "choice", "criteria": {"refund": "Wants the money back", "replacement": "Wants a new mug", "other": null}},
    "severity": {"type": "score", "criteria": ["Minor", "Moderate", "Severe"]}
  }
}'
```

OpenAI Decisions 格式调用 Gemini Decisions（渠道协议 `gemini`，模型 `gemini-decision-1`）：

```bash
curl https://你的域名/v1/decisions -H "Authorization: Bearer $NEW_API_KEY" -H "Content-Type: application/json" -d '{
  "model": "gemini-decision-1",
  "input": "The package arrived crushed and the mug inside is broken.",
  "questions": [
    {"type": "predicate", "name": "wants_refund", "instructions": "Does the customer want a refund?"},
    {"type": "choice", "name": "request", "instructions": "What does the customer want?",
     "choices": [{"value": "refund", "description": "Money back"}, {"value": "replacement", "description": "A new mug"}]},
    {"type": "score", "name": "severity", "instructions": "How severe is the damage?",
     "levels": [{"label": "Minor"}, {"label": "Moderate"}, {"label": "Severe"}]}
  ]
}'
```

Databricks ai-decide 格式调用 TypeSafe Jev（渠道协议 `systemone`，模型 `jev-latest`）：

```bash
curl https://你的域名/api/2.0/ai-functions/ai-decide -H "Authorization: Bearer $NEW_API_KEY" -H "Content-Type: application/json" -d '{
  "model": "jev-latest",
  "state": {"ticket": "The package arrived crushed and the mug inside is broken."},
  "questions": {
    "wants_refund": {"type": "noul", "instructions": "Does the customer want a refund?"},
    "request": {"type": "choice", "instructions": "What does the customer want?", "criteria": {"refund": "Money back", "replacement": "A new mug"}},
    "severity": {"type": "score", "instructions": "How severe is the damage?", "criteria": ["Minor", "Moderate", "Severe"]}
  }
}'
```

回复永远是客户端那种格式；各格式的回复字段见 [API.md](API.md#回复)。

## 抽取（Extractions）

抽取是和决策并列的另一种任务：给一段文本（或图片），按字段定义抽出有类型的值，每个字段带置信度、原文位置和"没有这一项"的概率。客户端用 [OpenRouter Extractions API](https://openrouter.ai/docs/api/api-reference/alphaextractions/submit-an-extractions-request) 的格式请求 `POST /api/alpha/extractions`。

- 渠道上游协议选 `extractions`（OpenRouter，或另一台装了本插件的 New API）或 `clairic`（Cloudflare Workers AI 官方接口）。同一个渠道既有决策模型又有抽取模型时，用 `modelProtocols` 给抽取模型单独指定。
- 字段类型：`text`、`number`、`date`、`time`、`datetime`、`duration`、`list`、`estimate`、`forecast`；各类型可用的键（`instructions`、`unit`、`decimals`、`items`、`min`/`max` 等）和 OpenRouter 文档一致，多写或写错的键直接报错。
- 图片放在 `assets` 里（PNG、JPEG、WebP、PDF 的 Base64），在 `state` 或字段的 `instructions` 里写它的键来引用；`state` 为空或正好是唯一图片的键时，按"只读文件"处理。发往 Clairic 时图片转成它的 `images` 数组（最多 4 张，不支持 PDF）。
- 决策请求和抽取请求不会互相转换：抽取请求发到决策协议的渠道（或反过来）会直接报错。
- 计费和决策相同，用模型级任务表达式；字段是 `input_tokens`、`output_tokens`、`requests`，OpenRouter 回复里的费用是 `upstream_cost`。Clairic 官方价格为每百万输入 0.10 美元，输出免费。
- ScaleDown `extract`、Inference.net Schematron 的官方接口是 OpenAI Chat Completions + JSON Schema，不是这种格式；经 OpenRouter 的 `extractions` 协议调用它们即可。

```bash
curl https://你的域名/api/alpha/extractions -H "Authorization: Bearer $NEW_API_KEY" -H "Content-Type: application/json" -d '{
  "model": "cloudflare/clairic",
  "state": "Invoice INV-7, due 1 Dec 2026. Total 41.50 USD.",
  "reference_date": "2026-11-13",
  "fields": {
    "invoice_number": {"type": "text"},
    "due_date": {"type": "date", "instructions": "When payment is due"},
    "total": {"type": "number", "decimals": 2, "unit": "USD"}
  }
}'
```

回复是 OpenRouter 的格式：`{id, model, provider, answers: {字段名: {type, value, guess, p_null, confidence, span…}}, truncated, usage}`，见 [API.md](API.md#extractions)。

## 计费

插件只上报用量，不含任何模型的单价或专属计费规则；单价全部在 New API 后台「模型价格」里配置。

### 价格从哪里来

New API 给插件请求定价时按下面的顺序找，找到就停（rc.50 实测）：

1. **插件覆盖价** `decision::<模型>`：只在两种情况下需要：
   - 模型同时用于普通聊天，目前只有 `gpt-6-luna`，见[下文](#gpt-6-luna聊天和-decisions-分开计费)。
   - 保存模型级表达式时 New API 报 `usage key cache_read_tokens is not declared` 之类的错误：同名模型在 New API 里还有别的任务计费来源，模型级表达式只能读各方共有的字段。这时把完整表达式配在 `decision::<模型>` 上（如 `decision::jev-latest`），模型级表达式保持原样。
2. **客户端模型名的模型级任务表达式**：计费方式选「表达式」，表达式里用 `u("…")` 读插件上报的用量，结果单位是美元/次。
3. **重定向后名字的模型级任务表达式**：如所有重定向到 `decision-custom` 的名字共用它的表达式，`my-jev → jev-latest` 共用 `jev-latest` 的表达式。
4. 都没有时，New API 走按次路径，用模型的**固定价格**（按次计费）或**倍率**。插件在渠道打开了 `perCallPrice`、或上游不报用量（Databricks ai-decide）时接受这条路径，其余情况都拒绝：返回 400，不请求上游、不扣费。

| 价格配置 | 用于决策请求 |
| --- | --- |
| 模型级任务表达式（带 `u()`） | ✓ 推荐，Jev、Gemini 和其它模型都用这种 |
| 插件覆盖价 `decision::模型` | ✓ 只有聊天、决策共用模型名时需要（`gpt-6-luna`） |
| 倍率（按量计费） | ✗ 插件拒绝，原因见下 |
| 固定价格（按次计费） | ✓ 渠道打开 `perCallPrice` 后可用；Databricks ai-decide 不用打开 |
| 聊天表达式（用 `p`、`c` 等） | ✗ New API 拒绝 |

### 普通倍率为什么不能用于决策请求

已在 rc.50 上验证：New API 给任务插件定价时，倍率不按 token 计算。没有任务表达式时，同步任务按「模型倍率 ÷ 2」美元每次固定扣费，之后也不按 token 结算。实测一个倍率 0.021（相当于 0.042 美元/百万 token）的模型：96 token 和 652 token 的请求都扣 5250 额度（0.0105 美元），而按 token 应只扣约 2 和 14 额度。

因此插件不接受倍率，也不接受固定按次价格给按 token 计费的决策请求定价，避免错误地退回按次收费。这时 New API 返回 400 `plugin usage hook failed`（宿主隐藏了插件的说明文字）。请改成下面的模型级任务表达式。同一模型的普通聊天照常用倍率，不受影响。

### 任务表达式写法与模型广场价格展示

**计费是否生效**与**模型广场能否展开价格表**是两回事。New API rc.50 的模型广场只识别部分规范写法；即使表达式能够正常执行和结算，界面仍可能显示「特殊计费表达式」及原始公式。此时不要仅凭展示判断为计费错误。

为尽可能让价格在模型广场按档位展示，建议按以下规则书写任务表达式：

- 用 `tier("档位名", ...)` 包裹每个档位的价格。
- **每个 Token 字段独立除以 `1000000`，再相加**，例如 `u("input_tokens") * 0.10 / 1000000 + u("cache_read_tokens") * 0.01 / 1000000`；避免把多个字段先加起来、最后统一除以 `1000000`。
- 布尔条件写成显式比较，如 `u("long_context") == true`；不要只写 `u("long_context")` 作为条件。这只适用于插件用量 Schema 已声明的布尔字段。
- 只使用插件声明且上游确实会上报的用量字段；一般模型不要照抄 `gpt-6-luna` 的专属 `long_context` 条件。

```text
# 推荐：模型广场更容易展开成价格表
tier("base", u("input_tokens") * 0.10 / 1000000 + u("cache_read_tokens") * 0.01 / 1000000)

# 不推荐：计费数学结果相同，但模型广场可能只显示原始表达式
tier("base", (u("input_tokens") * 0.10 + u("cache_read_tokens") * 0.01) / 1000000)
```

若仍显示「特殊计费表达式」，先检查表达式与模型的用量 Schema，再通过实际请求和消费日志核对结算；**不要仅为了展示而改动价格**。切换可视化编辑模式前请先备份原始表达式，防止编辑器重建公式时覆盖自定义逻辑。以下示例已尽量采用更易展示的格式。

### 模型级任务表达式（普通模型）

「模型价格」→ 选模型（没有就新增）→ 计费方式选**表达式**，填入表达式。可用字段：

| 字段 | 含义 |
| --- | --- |
| `u("input_tokens")` | 未命中缓存、也不是缓存写入的输入 token（含图片 token） |
| `u("cache_read_tokens")` | 缓存读取 token |
| `u("cache_write_tokens")` | 缓存写入 token |
| `u("output_tokens")` | 输出 token |
| `u("requests")` | 成功请求数，恒为 1；不报用量的上游只有这个字段 |
| `u("upstream_cost")` | 上游回复里报告的本次费用（美元）。只有 OpenRouter、ScaleDown、Eden AI、OpenCode 这类会报告费用的上游才有，见[按上游实际费用计费](#按上游实际费用计费) |

三个输入字段互不重叠，相加等于上游报告的总输入。用量来自上游回复，客户端在请求里写的用量字段会被拒绝。

**缓存 token 别漏收**：大多数决策模型的缓存读取和普通输入同价，但插件把缓存读取单独放在 `cache_read_tokens` 里。表达式只写 `u("input_tokens")` 时，上游报告的缓存 token 就不收费了，所以下面的模板把三个输入字段都按输入价计费。

示例价格如下，每百万 token，美元，2026-11-12 核对。以官网为准，价格会变。

| 模型 | 输入 | 缓存读取 | 缓存写入 | 输出 | 来源 |
| --- | --- | --- | --- | --- | --- |
| TypeSafe Jev 1.13 / 1.14 | 0.042 | 未公布 | 未公布 | 免费 | [docs.typesafe.ai/models](https://docs.typesafe.ai/models) |
| OpenAI `gpt-6-luna` Decisions，≤272K | 0.10 | 0.01 | 0.125（30 分钟缓存） | 不收费 | [Decisions 指南](https://developers.openai.com/api/docs/guides/decisions)、[价格页](https://developers.openai.com/api/docs/pricing) |
| OpenAI `gpt-6-luna` Decisions，>272K | 0.20 | 0.02 | 0.25 | 不收费 | 同上 |
| Gemini Decision 1（付费档） | 0.10 | 不支持缓存 | — | 无输出 | [Gemini 价格页](https://ai.google.dev/gemini-api/docs/pricing) |

Jev 的模型级表达式：

```text
tier("base", u("input_tokens") * 0.042 / 1000000 + u("cache_read_tokens") * 0.042 / 1000000 + u("cache_write_tokens") * 0.042 / 1000000)
```

Gemini Decision 1 的模型级表达式（`gemini-decision-1` 不用于聊天，不需要插件覆盖价）：

```text
tier("base", u("input_tokens") * 0.10 / 1000000 + u("cache_read_tokens") * 0.10 / 1000000 + u("cache_write_tokens") * 0.10 / 1000000)
```

按次收费的模型（如 Parallel 每次 0.001 美元）：

```text
u("requests") * 0.001
```

### 按次计费（模型固定价格）

想按次收费时有两种做法，上游回复里有没有用量、有没有费用都能正常调用：

- **模型固定价格**：「模型价格」里把模型设为按次计费并填价格，再在渠道插件配置里打开 `perCallPrice`（允许模型固定按次价格）。
- **任务表达式** `u("requests") * 单价`：不用打开开关，名字自己的表达式优先于重定向目标的。

`perCallPrice` 默认关，因为插件分不清 New API 走的是固定价格还是倍率（宿主没有把这个信息交给插件），而倍率会按每次「倍率 ÷ 2」美元扣费。打开后，本渠道的模型要设固定价格，不要只设倍率；按 token 计费的模型放在没打开开关的渠道，或给它们配任务表达式（表达式优先于固定价格）。

### 常见模型价格模板

把表达式里的 `P` 换成下表的输入价（美元/百万 token），在「模型价格」里给对应模型逐个填入：

```text
tier("base", u("input_tokens") * P / 1000000 + u("cache_read_tokens") * P / 1000000 + u("cache_write_tokens") * P / 1000000)
```

价格取自厂商官网和 OpenRouter 实时模型目录，2026-11-13 核对；以官网为准，价格会变。下表的模型都不收输出费。

| `P` | 模型 |
| --- | --- |
| 0.01 | `pplx-decider-flash-v1.3`、`pplx-decider-flash-v1.2`、`pplx-decider-flash-latest`、`perplexity/pplx-decider-flash-v1.3`、`perplexity/pplx-decider-flash-v1.2`、`perplexity/pplx-decider-flash-latest`、`~perplexity/pplx-decider-flash-latest`；`span-02`、`respan/span-02`；`baseten/joey-1`、`decision-models/baseten-joey-2b-latest` |
| 0.019 | `cloudflare/clef-flash`（OpenRouter） |
| 0.02 | `pplx-decider-v1.3`、`pplx-decider-v1.2`、`pplx-decider-latest`、`perplexity/pplx-decider-v1.3`、`perplexity/pplx-decider-v1.2`、`perplexity/pplx-decider-latest`、`~perplexity/pplx-decider-latest`；`d1.1`、`liquid/d1`、`liquid/d1.1`、`~liquid/d1-latest`；`respan/span-01` |
| 0.035 | `baseten/elephant-1`、`decision-models/baseten-elephant-9b-latest` |
| 0.04 | `nimble-latest`、`nimble-v4.1-max`、`nimble-v4-max`；`scaledown/classify-1`、`classify-1`、`classify`；`drex-v1.5`、`nace-ai/drex-v1.5` |
| 0.042 | Jev 全部写法（`jev-1.14.0`、`jev-1.13.0`、`jev-latest`、`jev-preview`、`typesafe/…`、`typesafe-ai/…`、`~typesafe/jev-latest`）；`microsoft-decision-1`、`microsoft/microsoft-decision-1`；`d1-ultra`、`liquid/d1-ultra`、`~liquid/d1-ultra-latest`；`jaredpalmer/kev-4b`；`togethercomputer/tev1-4b-experimental` |
| 0.05 | `upstage/solar-decide`、`upstage/solar-decide-flash`（OpenRouter；Upstage 官网 `solar-decide` 为 0.10） |
| 0.06 | `drex-max`、`drex-v2.0`、`nace-ai/drex-max`、`nace-ai/drex-max-finance`、`nace-ai/drex-v2.0` |
| 0.09 | `heygen/heygen-decision-1-turbo` |
| 0.10 | `gemini-decision-1`、`google/gemini-decision-1`；`solar-decide`（Upstage 官网）；`baseten/mammoth-1`、`decision-models/baseten-mammoth-27b-latest` |
| 0.14 | `heygen/heygen-decision-1` |
| 0.15 | `cloudflare/clef-omni`（OpenRouter） |
| 0.192 | `cloudflare/clef`（OpenRouter；Cloudflare Workers AI 官网 `clef` 为 0.24） |
| 0 | 带 `:free` 的 OpenRouter 免费档、`respan/span-01-lite` |

例外：
- 模型级表达式保存被拒（报 `usage key … is not declared`）时，把模板表达式配在插件覆盖价 `decision::<模型>` 上，原因见[价格从哪里来](#价格从哪里来)。
- `reflex`、`morph/reflex`：输入 0.042，缓存读取 0.002，表达式里把 `cache_read_tokens` 的单价换成 0.002。
- `gpt-6-luna` 系列用[插件覆盖价](#gpt-6-luna聊天和-decisions-分开计费)。
- 按次收费：`parallel/parallel-decisions-fast`、`parallel/decisions-fast:free` 等 Parallel 模型用 `u("requests") * 0.001`；Databricks ai-decide 见[下文](#databricks-ai-decide按次计费)。
- 没查到公开价格的（SubQ、Inception、Telnyx、Fireworks、Ollama、自建模型）按你的进价自行填写。

### 按上游实际费用计费

OpenRouter、ScaleDown、Eden AI、OpenCode 等中转会在回复里报告本次请求的费用，插件把它上报为 `u("upstream_cost")`（美元），不会返回给客户端。这样可以给价格各不相同的一批模型配同一个"成本加价"表达式，例如给 `decision-custom` 或某个 OpenRouter 模型配：

```text
tier("base", (u("upstream_cost") ?? (u("input_tokens") * 0.10 / 1000000 + u("cache_read_tokens") * 0.10 / 1000000 + u("cache_write_tokens") * 0.10 / 1000000)) * 1.2)
```

- `??` 前面是上游报告的费用，后面括号里是它缺席时的 token 价（括号不能省，New API 不允许 `??` 和 `*` 不加括号混写）。请求时上游还没报费用，New API 按后面的 token 价预扣；回复后有费用就按费用结算，多退少补。`* 1.2` 是加价 20%。
- 不能只写 `u("upstream_cost") * 1.2`：预扣时没有这个字段，请求会被拒绝。
- 官方 OpenAI、Gemini、TypeSafe 不报告费用，`??` 会一直用 token 价，对它们直接用上面的价格模板更清楚。
- OpenRouter 的费用已包含联网检索等附加费；Perplexity 官方接口的联网检索费（每次 0.001 美元）不在回复里，需要联网时建议走 OpenRouter。

### gpt-6-luna：聊天和 Decisions 分开计费

`gpt-6-luna` 既可能走 `/v1/chat/completions`（普通 OpenAI 渠道），也可能走 `/v1/decisions`（Decision 插件渠道），两者用两套价格：

1. **聊天价格配在模型上**，用倍率方式：「模型价格」→ `gpt-6-luna` → 按量计费。
   - 模型倍率 `0.05`（0.10 美元/百万；倍率 1 = 2 美元/百万）
   - 补全倍率 `5`（输出 0.50）
   - 缓存倍率 `0.1`（0.01）
   - 缓存创建倍率 `1.25`（0.125）

   聊天请求照旧按这套结算，装插件前后不变。
2. **Decisions 价格配成插件覆盖价**：在同一页面的插件价格里，给 `decision::gpt-6-luna`（插件 Decision 的 `gpt-6-luna`）填下面的表达式。插件请求优先用这个覆盖价，不会用到聊天倍率。
3. 不要把带 `u()` 的表达式配在模型级：普通聊天请求遇到它会直接报 `model_price_error`。

`gpt-6-luna` 系列（`gpt-6-luna`、`openai/gpt-6-luna`、`openai/gpt-6-luna-decisions`、`gpt-6-luna-decisions`）的用量字段和普通模型不同：

| 字段 | 含义 |
| --- | --- |
| `u("input_tokens")`、`u("cache_read_tokens")`、`u("cache_write_tokens")` | 同上；OpenAI 不收输出费，所以没有 `output_tokens` |
| `u("long_context")` | 总输入超过 272K token 时为 true，此时官方价格翻倍 |

```text
u("long_context") == true ? tier("long", u("input_tokens") * 0.20 / 1000000 + u("cache_read_tokens") * 0.02 / 1000000 + u("cache_write_tokens") * 0.25 / 1000000) : tier("base", u("input_tokens") * 0.10 / 1000000 + u("cache_read_tokens") * 0.01 / 1000000 + u("cache_write_tokens") * 0.125 / 1000000)
```

**注意：**这里将 `long_context` 显式比较为 `true`，并对每个 Token 费用分别除以 `1000000`；与旧公式的计费结果相同，但更容易被 New API rc.50 的价格展示解析器识别。模型广场能否展示价格表不影响实际结算，请以消费日志为准。

别名重定向到 `gpt-6-luna` 时共用 `decision::gpt-6-luna`；直接勾选的别名（如 `openai/gpt-6-luna`）要单独配 `decision::openai/gpt-6-luna`。

计费跟着**实际选中的渠道和模型**走，和客户端用哪个路径、哪种格式无关。例如用 System One 格式请求 `gpt-6-luna`，选中的是 OpenAI Decisions 渠道，就按 `decision::gpt-6-luna` 计费，用量取 OpenAI 回复里的 usage。

没配 `decision::gpt-6-luna` 时，请求会被拒绝，不扣费、不请求上游：

- 模型级是聊天表达式时，New API 返回 400 `Model gpt-6-luna has no task price for plugin decision`。
- 模型级是倍率时，返回 400 `plugin usage hook failed`。

### Databricks ai-decide：按次计费

ai-decide 不返回 token 用量，插件也不编造 token：只上报 `u("requests") = 1`，成功才扣费，上游报错不扣费。给它用的模型名（如 `databricks-decide`，按[任意模型名](#完整示例接入任意模型名)重定向到 `decision-custom`）配置价格，二选一：

- **推荐：模型级任务表达式**，如每次 0.002 美元：

  ```text
  u("requests") * 0.002
  ```

  这个名字自己的表达式优先于 `decision-custom` 的，最稳妥。
- **模型固定价格**（按次计费）`0.002`：前提是这个名字和它重定向到的名字（如 `decision-custom`）**都没有**任务表达式。否则按[第 3 步](#价格从哪里来)用了 `decision-custom` 的表达式；那个表达式读 token 字段时，请求会以 400 `expr run error: invalid operation: <nil> …` 被拒绝，不会免费。

不要用倍率：会按「倍率 ÷ 2」美元每次扣费。

客户端用 System One、OpenAI 等格式请求 ai-decide 上游时，回复里的 token 用量都是 0；Databricks 格式的回复本来就没有用量字段。

### 预扣与结算

- 请求时按输入的上界预扣：
  - 文本按 UTF-8 字节数（token 数不会超过字节数）
  - 内联图片按字节数
  - URL 图片按 8192
  - 再加模板余量，并以上游上下文上限（或 `reserveTokens`）封顶；TypeSafe 带长上下文头时上限是 262,400
- 回复后按上游报告的实际用量结算，多退少补。
- 上游回复里没有用量时，不会当作免费：token 表达式按预扣额度结算；`u("requests")` 表达式和固定按次价格照常按次结算。Databricks ai-decide 本来就没有用量，按次结算。
- 上游报错、超时、插件拒绝的请求不扣费。

## 多模态

| 内容 | System One 上游 | OpenAI 上游 | Gemini 上游 | Vercel 上游 | Databricks 上游 |
| --- | --- | --- | --- | --- | --- |
| 文本、JSON | ✓ | ✓（JSON 用 `input_json`） | 文本 ✓；JSON 转成 JSON 文本 | ✓ | ✓ |
| 图片 Base64 / data URL | ✓（PNG、JPEG） | ✓ | ✓ | ✓ | ✗ |
| 图片 URL | ✗ | ✓ | ✓ | ✓ | ✗ |
| multipart 上传（TypeSafe SDK） | ✓ 原样转发 | ✓ 转 data URL | ✓ 转 Base64 | ✓ 转 Base64 | ✗ |
| 音频、视频、PDF | ✗ | ✗ | ✓ | 交给 Vercel 路由的模型 | ✗ |
| Box 定位题 | ✓（需 Jev 1.14） | 交给上游（OpenAI 官方不支持，Vercel/LiteLLM/Bifrost 支持） | ✗ | ✓ | ✗ |

- System One 上游一列按 TypeSafe 的 `assets` 写法。兼容 System One 的其它厂商用渠道的 `imageMode` 选它们的写法：Ollama `images-base64`、SubQ `images-subq`、Cloudflare Clef `images-cloudflare`、Perplexity / Requesty / Inception `state-image-url`。这些写法只接受共享输入（state）里的 Base64 或上传图片，不接受图片 URL，也不接受指令、选项里的图片。
- Parallel 不接受图片；Cloudflare `openai/decisions` 只接受 data URL 图片。

不支持的内容直接报错，不转成文字、不丢弃。System One 把图片引用放在 JSON 对象里时，只能发往 System One 上游。详见 [API.md](API.md#多模态)。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `model "xxx" is not served by this plugin` | 模型没声明：先查[模型表](#模型)里有没有别的写法，没有就按[任意模型名](#完整示例接入任意模型名)重定向到 `decision-custom` |
| `plugin usage hook failed`（400） | 模型只有倍率或固定价格（或没配价格），见[价格从哪里来](#价格从哪里来)：普通模型配模型级任务表达式，`gpt-6-luna` 配 `decision::gpt-6-luna`；要按次收费就给模型设固定价格，并打开渠道的 `perCallPrice` |
| `Model xxx has no task price for plugin decision` | 模型级价格是聊天表达式（用了 `p`、`c` 等），给 `decision::xxx` 配插件覆盖价 |
| `expr run error: invalid operation: <nil> …` | 表达式读了上游没报告的字段，常见于 Databricks ai-decide 用了 token 表达式：改成 `u("requests") * 单价` |
| `no 'instructions'; add the text the model should answer` | 上游要求每题都有指令：打开渠道的 `fillInstructions`，或在请求里写上指令 |
| `model_price_error` | 按[价格从哪里来](#价格从哪里来)配置；不要把带 `u()` 的表达式配给也走聊天的模型 |
| 模型广场显示「特殊计费表达式」、无法展开价格表 | 一般是展示解析器不支持当前写法，不等于扣费失败；按[表达式写法说明](#任务表达式写法与模型广场价格展示)调整格式，再用消费日志核对 |
| `unsupported_modality` / `unsupported_question_type` | 上游协议不支持这种内容或题型，换上游协议或改请求 |
| `limit_exceeded` | 超过上游的问题数、选项数或等级数；插件不拆分请求 |
| `/v1/systemone` 未进入 Decision 或出现路由冲突 | 检查模型与渠道绑定，必要时使用 `/decision/v1/systemone` 明确指定本插件 |
| 回复里 `answers` 的键顺序和请求不同 | New API 按键名排序输出 JSON 对象；按键取值即可，OpenAI 格式的数组顺序不变 |

## 已知限制

- **任意模型名需要模型重定向**：New API 原生路由只接受插件 `meta.models` 里的模型或重定向到它们的名字，未声明的名字在插件执行前就被拒绝（`middleware/task_plugin.go` 的 `checkTaskPluginRouteIntent`）。Provider Relay 的 `re:.*` 通配只适用于聊天等宿主中转路径，`/v1/decisions` 这类决策路径不在其中，所以用 `decision-custom` 槽位解决，不改宿主。
- **倍率不能给决策请求计费**：New API 对任务插件只按「倍率 ÷ 2」美元每次扣费、不按 token 结算（`relay/helper/price.go` 的 `ModelPriceHelperPerCall`），所以决策模型要用模型级任务表达式，见[计费](#普通倍率为什么不能用于决策请求)。
- **不拆分超限请求**：任务插件每次提交只能发一个上游请求（`utils.fetch` 在驱动钩子里只读），超过上限直接报 `limit_exceeded`，请在客户端拆分。
- **键名对象的顺序**：回复由宿主序列化，`answers` 等对象按键名排序。发往上游的请求保持客户端的键顺序（`json-order@1`）；但用 multipart 图片转成内联 Base64 的请求例外，宿主会按键名排序。
- multipart 转发给 System One 时，宿主写的 `request` 分段没有 `Content-Type` 头。
- 价格配置不对时宿主隐藏插件的说明文字，只显示 `plugin usage hook failed`。
- Gemini Decisions、Vercel Evaluation 的部分字段只在第三方资料或 SDK 文档中出现，按 [API.md](API.md#兼容性) 的标注使用。
- 只用严格的模拟上游测过、还没有真实渠道的：Databricks ai-decide、Parallel、Cloudflare Workers AI（openai/decisions、Clairic）、OpenRouter Extractions，以及 `imageMode` 的各种图片写法。OpenAI Decisions、Gemini Decisions（官方渠道）和 System One（OpenCode、OpenCSG）已用真实上游测过。
- Extractions 是 OpenRouter 的 Alpha 接口，字段可能变化；Perplexity `locate`、Inception `extract`、Respan `number` 等厂商自有题型只能发往 System One 族上游，不做跨协议转换。

## 开发与测试

```bash
node build.mjs                 # 把 src/ 打包成 plugin.js（和 marketplace/plugin.js）
node build.mjs --check         # 检查 plugin.js 是否与 src/ 一致（CI 会跑）
node --test tests/*.test.mjs   # 单元测试和 N × N 协议矩阵，离线
node scripts/check-release.mjs # 版本号、更新日志和发布文件检查
```

端到端测试需要一个**隔离的** New API 实例和模拟上游。不要指向生产网关，它会创建渠道和价格：

```bash
docker run -d --name decision-test --network host -e PORT=49300 -v /tmp/decision-test:/data calciumion/new-api:latest
node tests/mock-upstream.mjs 49311 &
NA_BASE=http://127.0.0.1:49300 MOCK=http://127.0.0.1:49311 python3 tests/e2e/e2e.py plugin.js
```

源码分层：

- `src/systemone.js`、`openai.js`、`gemini.js`、`vercel.js`、`databricks.js`、`extractions.js`：各管一个协议的解码、编码、回复解析和渲染（Parallel 在 `systemone.js`，Cloudflare `openai/decisions` 在 `protocols.js`）。
- `ir.js`：中间表示。
- `protocols.js`：协议注册表和路由。
- `channel.js`：渠道配置。
- `billing.js`：用量和计费。
- `plugin.js`：插件入口。

新增协议只需加一个协议模块，在 `protocols.js` 注册，并加进 `build.mjs` 的模块列表。

## 交流与反馈

使用问题、Bug 反馈和功能建议欢迎加群交流：

| 吟枢苑✨吟窝（插件反馈群） |
| :---: |
| 群号：1059351824 |
| <img src="https://raw.githubusercontent.com/yiyinfaith/new-api-plugin-decision/main/assets/qq-group-chat.jpg" alt="插件反馈群二维码" width="240" /> |

## 参考与许可

项目：[yiyinfaith/new-api-plugin-decision](https://github.com/yiyinfaith/new-api-plugin-decision)。参考资料：

- [New API 插件 API](https://github.com/QuantumNous/new-api/blob/main/docs/plugin-api/v1.md)
- [TypeSafe System One](https://docs.typesafe.ai/api)
- [OpenAI Decisions](https://developers.openai.com/api/reference/resources/decisions/methods/create)
- [Gemini Decisions](https://aistudio.google.com/api-reference/decisions)
- [Vercel AI Gateway](https://vercel.com/docs/ai-gateway/modalities/decision)
- [OpenRouter](https://openrouter.ai/docs)
- [Databricks ai-decide](https://docs.databricks.com/api/ai-functions/v1/ai-decide)

本项目以 [AGPL-3.0](LICENSE) 许可发布。第三方代码的归属说明保留在 `plugin.js` 文件头。
