---
changelogVersion: 1
plugin: "decision"
version: "1.0.0"
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [1.0.0]

### Added

- Call decision models in seven client formats: TypeSafe System One, OpenRouter, ScaleDown, OpenAI Decisions, Gemini Decisions, Vercel Evaluation, and the System One-shaped `/v1/decisions` that Perplexity and Inception use. Every path is also served under `/decision`.
- Send each channel's requests as System One, OpenRouter, OpenAI Decisions, Gemini Decisions or Vercel Evaluation, with replies converted back to the client's format.
- Choose the upstream protocol, path and key header per channel, and the protocol, path and upstream model ID per model.
- Use any model name by mapping it to `decision-custom` on the channel.
- Price input, cached input, cache writes and output separately. `gpt-6-luna` models get a long-context field instead of an output field, so their decision price can stay apart from their chat price.
- Keep everything the official TypeSafe plugin offers: four question types, images as base64 or SDK uploads, the long-context header, TypeSafe error replies and member order.

### Migration

- Price every model you enable with a task usage expression. For `gpt-6-luna`, set the expression on the plugin override `decision::gpt-6-luna` and keep its chat price on the model. Requests for a model without a task expression are refused.
