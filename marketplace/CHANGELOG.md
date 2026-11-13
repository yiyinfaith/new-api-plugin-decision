---
changelogVersion: 1
plugin: "decision"
version: "1.0.2"
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [1.0.2]

### Added

- Pick 106 decision models on a channel without a model mapping. The list covers TypeSafe Jev, Liquid d1, Laya, OpenAI `gpt-6-luna`, Gemini Decision 1, Perplexity Decider, Microsoft Decision 1, Upstage Solar Decide, Bespoke Nimble, SubQ Snap, Inception Mercury Decide, Telnyx, Cloudflare Clef, ScaleDown, Baseten, Fireworks, Nace.AI Drex, Morph Reflex, Respan, Together Tev1, and the OpenRouter and Vercel AI Gateway names of these models. Each ID comes from the vendor's documentation or live model catalog.

### Changed

- Every model declared in 1.0.1 is still declared. Other names still work when mapped to `decision-custom`.

### Migration

- Price each newly enabled model with a model-level task expression before offering it. Declaring a model does not set a price.
- Pick the ID that matches the channel's upstream, for example `d1.1` for Liquid's own API and `liquid/d1.1` for OpenRouter, or map one name to the upstream's ID.
