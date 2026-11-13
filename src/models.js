// Declared models. New API serves a task plugin only the models it declares
// (or names mapped to them), so common decision model IDs are listed here and
// can be picked on a channel directly. Any other name still works by mapping
// it to decision-custom. Every ID below appears in the vendor's official
// documentation or live model catalog (checked 2026-11-13); none is guessed.
// Declared IDs are never removed: channels and prices may name them.

import { CUSTOM_SLOT } from "./channel.js";

export const MODEL_GROUPS = [
  // https://docs.typesafe.ai/models; bare jev is kept from 1.0.0 for existing channels
  { vendor: "TypeSafe Jev", models: ["jev-1.14.0", "jev-1.13.0", "jev-latest", "jev-preview", "jev"] },
  // OpenRouter, Vercel AI Gateway, LiteLLM / Eden AI
  { vendor: "TypeSafe Jev (gateways)", models: ["typesafe/jev-1.14", "typesafe/jev-1.13", "~typesafe/jev-latest", "typesafe/jev-latest", "typesafe-ai/jev", "typesafe-ai/jev-1.14.0", "typesafe-ai/jev-1.13.0"] },
  // Databricks System One route, Unity Catalog names
  { vendor: "Databricks", models: ["system.ai.typesafeai-jev-1-14-0", "system.ai.openjev-qwen35-4b"] },
  // OpenAI Decisions (gpt-6-luna); LLM Gateway, OpenRouter, Vercel, LiteLLM
  { vendor: "OpenAI", models: ["gpt-6-luna", "gpt-6-luna-decisions", "openai/gpt-6-luna", "openai/gpt-6-luna-decisions"] },
  // Gemini Decisions
  { vendor: "Google Gemini", models: ["gemini-decision-1", "google/gemini-decision-1"] },
  // docs.liquid.ai (d1.1, d1-ultra); OpenRouter and Vercel
  { vendor: "Liquid AI", models: ["d1.1", "d1-ultra", "liquid/d1", "liquid/d1.1", "liquid/d1-ultra", "~liquid/d1-latest", "~liquid/d1-ultra-latest"] },
  // Convai Innovations, on Vercel AI Gateway
  { vendor: "Laya", models: ["convaiinnovations/laya"] },
  // docs.perplexity.ai (incl. accepted legacy IDs); OpenRouter and Vercel
  {
    vendor: "Perplexity",
    models: [
      "pplx-decider-v1.3",
      "pplx-decider-flash-v1.3",
      "pplx-decider-v1.2",
      "pplx-decider-flash-v1.2",
      "pplx-decider-latest",
      "pplx-decider-flash-latest",
      "pplx-decider-v1.1-27b",
      "pplx-decider-v1-27b",
      "perplexity/pplx-decider-v1.3",
      "perplexity/pplx-decider-flash-v1.3",
      "perplexity/pplx-decider-v1.2",
      "perplexity/pplx-decider-flash-v1.2",
      "perplexity/pplx-decider-latest",
      "perplexity/pplx-decider-flash-latest",
      "perplexity/pplx-decider-v1.3:free",
      "perplexity/pplx-decider-flash-v1.3:free",
      "~perplexity/pplx-decider-latest",
      "~perplexity/pplx-decider-flash-latest",
    ],
  },
  // Azure / Microsoft Foundry (requests name the deployment); OpenRouter and Vercel
  { vendor: "Microsoft", models: ["microsoft-decision-1", "microsoft/microsoft-decision-1"] },
  { vendor: "Upstage", models: ["solar-decide", "upstage/solar-decide", "upstage/solar-decide-flash"] },
  { vendor: "Bespoke Labs Nimble", models: ["nimble-latest", "nimble-v4.1-max", "nimble-v4-max", "nimble-v4", "nimble-v3"] },
  // api.subq.ai/v1/models
  { vendor: "SubQ", models: ["subq-snap-1.2", "subq-snap-1.1", "subq-snap-latest", "subq-snap-preview"] },
  { vendor: "Inception", models: ["mercury-decide"] },
  { vendor: "Telnyx", models: ["telnyx/decision-flash", "telnyx/decision-pro"] },
  // Workers AI request model values; OpenRouter
  { vendor: "Cloudflare Clef", models: ["clef", "clef-flash", "clef-omni", "cloudflare/clef", "cloudflare/clef-flash", "cloudflare/clef-omni"] },
  // Ollama System One models
  { vendor: "Ollama", models: ["nimble", "clef:cloud"] },
  { vendor: "ScaleDown", models: ["classify", "classify-1", "scaledown/classify-1", "scaledown/scaledown-classify-1"] },
  // Baseten Model APIs slugs; OpenRouter and Vercel
  {
    vendor: "Baseten",
    models: [
      "decision-models/baseten-joey-2b-latest",
      "decision-models/baseten-elephant-9b-latest",
      "decision-models/baseten-mammoth-27b-latest",
      "baseten/joey-1",
      "baseten/elephant-1",
      "baseten/mammoth-1",
    ],
  },
  { vendor: "Fireworks", models: ["accounts/fireworks/models/rune"] },
  // console.nace.ai; OpenRouter and Vercel
  { vendor: "Nace.AI Drex", models: ["drex-latest", "drex-max", "drex-v2.0", "drex-v1.5", "nace-ai/drex-max", "nace-ai/drex-max-finance", "nace-ai/drex-v2.0", "nace-ai/drex-v1.5", "nace-ai/drex-max-v1.1"] },
  { vendor: "Morph", models: ["reflex", "morph/reflex"] },
  // gateway.respan.ai (span-02); OpenRouter
  { vendor: "Respan", models: ["span-02", "respan/span-02", "respan/span-01", "respan/span-01-lite", "respan/span-01-lite:free"] },
  // Together API and OpenRouter (matches the Hugging Face repo case-insensitively)
  { vendor: "Together AI", models: ["together/Tev1-4B-experimental", "togethercomputer/tev1-4b-experimental"] },
  // OpenRouter
  { vendor: "OpenRouter-only", models: ["heygen/heygen-decision-1", "heygen/heygen-decision-1-turbo", "jaredpalmer/kev-4b", "parallel/decisions-fast:free"] },
  // Vercel AI Gateway
  { vendor: "Parallel", models: ["parallel/parallel-decisions-fast"] },
];

export const MODELS = MODEL_GROUPS.reduce((all, group) => all.concat(group.models), []).concat([CUSTOM_SLOT]);
