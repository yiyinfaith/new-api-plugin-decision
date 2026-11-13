---
changelogVersion: 1
plugin: "decision"
version: "1.0.3"
locale: "en"
translations:
  zh-CN: CHANGELOG.zh-CN.md
---
# Changelog

## [1.0.3]

### Added

- Bill at the cost the upstream reports. When a reply carries a USD cost, such as `usage.cost` from OpenRouter, ScaleDown or OpenCode, or Eden AI's top-level `cost`, the plugin reports it as the usage field `upstream_cost`. A cost-plus expression such as `(u("upstream_cost") ?? (<token price>)) * 1.2` reserves at the token price and settles at the reported cost. The cost is never returned to clients.

- Accept a fixed per-call model price on a channel with the new `perCallPrice` setting (off by default). Requests then work whether or not the reply carries usage or a cost. The setting is off by default because the plugin cannot tell a fixed price from a ratio, and New API charges a ratio-priced model half its ratio in USD per call.

### Changed

- A reply without usage now settles as one request. A `u("requests")` price bills exactly, and a token expression still settles at the reserved amount, never at zero.

### Migration

- Charge cached input in decision prices. Most decision models bill cached input at the input price, but the plugin reports cached tokens as `cache_read_tokens`, so an expression that reads only `input_tokens` leaves them free. The README has a price template for common models that bills all three input fields.
