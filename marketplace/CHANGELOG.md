---
changelogVersion: 1
plugin: "decision"
version: "1.1.0"
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [1.1.0]

### Added

- Extract typed values from text or images. Clients call `POST /api/alpha/extractions` in the format of OpenRouter's Extractions API, and channels send it to OpenRouter (protocol `extractions`) or to Cloudflare Workers AI Clairic (protocol `clairic`). Extraction models such as `cloudflare/clairic`, `scaledown/extract` and the Schematron models are declared.
- Send decisions to Parallel's own API (protocol `parallel`, no model field, `x-api-key`) and to Cloudflare Workers AI `openai/decisions` (protocol `cloudflare_openai`).
- Send images to System One-compatible vendors in their own format with the channel's `imageMode`: Ollama base64 strings, SubQ `{mediaType, base64}`, Cloudflare Clef `{content_type, base64}`, or `image_url` parts in the state for Perplexity, Requesty and Inception.
- Ask vendor question types, such as Perplexity `locate`, Inception `extract` and Respan `number`, on every System One route. They reach System One-family upstreams as written.

### Fixed

- With an image mode other than `assets`, uploaded images are no longer forwarded as multipart parts.

### Migration

- Price extraction models with a model-level task expression, as for decisions.
- To send images to SubQ, Ollama, Cloudflare Clef, Perplexity, Requesty or Inception, set the channel's `imageMode`.
