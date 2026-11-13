---
translations:
  zh-CN: README.zh-CN.md
---
# Decision

A gateway for decision models: typed questions answered with probabilities. Clients call in the format of TypeSafe System One, OpenAI Decisions, Gemini Decisions, Vercel Evaluation or OpenRouter, and each channel sends its own upstream format. Replies always come back in the client's format.

## Channel setup

- Choose the Task Plugin (61) channel type and bind the Decision plugin.
- Enter the upstream base URL without an endpoint path, and the upstream API key as it is.
- In the plugin settings, choose the upstream protocol: `systemone` (default), `openrouter`, `openai`, `gemini`, `vercel` or `vercel_sdk`. The plugin never guesses it from the host.
- Optional settings: a custom upstream path, where `{model}` stands for the upstream model; the key header (Bearer, `x-goog-api-key`, `api-key`, `x-api-key` or a custom header); and a protocol, path or upstream model ID per model.
- To call another New API gateway with this plugin, choose New API (60) and add Decision to its extension plugins.

## Models and endpoints

| Endpoint | Client format |
| --- | --- |
| `POST /v1/systemone`, `/typesafe/v1/systemone`, `/decisions/v1/systemone`, `/providers/microsoft/v1/systemone` | TypeSafe System One |
| `POST /api/alpha/decisions`, `/api/v1/systemone` | OpenRouter |
| `POST /v1/decisions`, `/openai/v1/decisions` | OpenAI Decisions, or System One-shaped bodies on `/v1/decisions` |
| `POST /v1beta/decisions` | Gemini Decisions |
| `POST /v1/evaluate` | Vercel Evaluation |
| `POST /v1/scaledown` | ScaleDown |

Every path is also served under `/decision`. Declared models include `jev-1.14.0`, `jev-latest`, `gpt-6-luna` and `gemini-decision-1`. For any other model name, list it on the channel and map it to `decision-custom`; the upstream receives the client's name.

## Billing

- Price each model with a task usage expression.
- `input_tokens` counts input tokens that were neither read from nor written to the cache. `cache_read_tokens` and `cache_write_tokens` count the cached input, and `output_tokens` counts the output.
- `gpt-6-luna` models have no output field. Their `long_context` field is true above 272K input tokens.
- When a model also serves chat, put its decision price on the plugin override `decision::<model>` so chat keeps its own price.
- The gateway reserves an upper bound of the input tokens and settles on the usage the upstream reports. A reply without usage keeps the reservation.
- A model without a task expression is refused with 400.

## Example

```bash
curl https://your-gateway.example.com/v1/decisions \
  -H "Authorization: Bearer sk-..." \
  -H "Content-Type: application/json" \
  -d '{"model": "jev-latest", "input": "The mug arrived broken.", "questions": [{"type": "predicate", "name": "refund", "instructions": "Does the customer want a refund?"}]}'
```

## Limits

- Model names that are not declared need a channel mapping to `decision-custom`.
- Requests over an upstream limit are refused, never split or truncated.
- Content or question types the upstream cannot take, such as audio for System One, are refused.
- Objects keyed by question name in replies are written with sorted keys.
- Full field reference: [API.md](https://github.com/yiyinfaith/new-api-plugin-decision/blob/main/API.md).
