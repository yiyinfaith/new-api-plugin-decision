---
changelogVersion: 1
plugin: "decision"
version: "1.0.1"
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [1.0.1]

### Added

- Call Databricks ai-decide. Clients can send its format to `POST /api/2.0/ai-functions/ai-decide` with a `model` for routing, and channels can use the `databricks` upstream protocol. The upstream request carries no model.
- Price a model per request with the new `requests` usage field, which is 1 for each successful request. ai-decide reports no tokens, so it reports only this field and is billed per request. Failed requests are not charged.

### Changed

- Only `gpt-6-luna` models need the plugin override `decision::<model>`. `gemini-decision-1`, Jev and every other model use their model-level task expression.
- A model priced by ratio is still refused, as is one with a fixed per-call price unless its upstream reports no tokens. New API charges a ratio-priced task half the ratio in USD per request and never settles it by tokens.

### Fixed

- A `vercel_sdk` channel that points at another New API gateway now sends to that gateway's `/decision/v1/evaluate` with the model. Earlier versions left out the model, and the gateway refused the request.

### Migration

- For a model whose model-level price is a ratio or a chat expression and that only serves decisions, such as `gemini-decision-1`, replace that price with a task expression, for example `tier("base", u("input_tokens") * 0.10 / 1000000)`. Keep the `decision::gpt-6-luna` override for `gpt-6-luna`.
- Price an ai-decide model with a task expression such as `u("requests") * 0.002`. A fixed per-call price also works when neither the name nor the model it maps to has a task expression.
