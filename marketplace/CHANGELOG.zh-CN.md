---
changelogVersion: 1
plugin: "decision"
version: "1.0.2"
locale: "zh-CN"
---
# Changelog

## [1.0.2]

### Added

- 渠道里可以直接勾选 106 个决策模型，不用模型重定向。覆盖 TypeSafe Jev、Liquid d1、Laya、OpenAI `gpt-6-luna`、Gemini Decision 1、Perplexity Decider、Microsoft Decision 1、Upstage Solar Decide、Bespoke Nimble、SubQ Snap、Inception Mercury Decide、Telnyx、Cloudflare Clef、ScaleDown、Baseten、Fireworks、Nace.AI Drex、Morph Reflex、Respan、Together Tev1，以及这些模型在 OpenRouter 和 Vercel AI Gateway 上的名字。每个 ID 都来自厂商文档或实时模型目录。

### Changed

- 1.0.1 声明的模型全部保留。其它名字仍然可以重定向到 `decision-custom` 使用。

### Migration

- 新启用的模型要先配模型级任务表达式价格再开放，声明模型不会自动设置价格。
- 勾选和渠道上游一致的写法，例如 Liquid 官方接口用 `d1.1`、OpenRouter 用 `liquid/d1.1`；也可以把一个名字重定向到上游的 ID。
