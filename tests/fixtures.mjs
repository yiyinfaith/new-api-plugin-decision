// Shared client request fixtures: one logical request in every client protocol.
const TEXT = "The package arrived crushed and the mug inside is broken.";
export const LEVELS = ["Minor", "Moderate", "Severe"];

export const CLIENT_BODIES = {
  systemone: {
    path: "/v1/systemone",
    body: {
      model: "jev-latest",
      state: { ticket: TEXT, channel: "email" },
      questions: {
        wants_refund: { type: "noul", instructions: "Does the customer want a refund?", criteria: { true: "Asks for money back", false: "Does not" } },
        request: { type: "choice", criteria: { refund: "Wants the money back", replacement: "Wants a new mug", other: null } },
        severity: { type: "score", criteria: LEVELS },
      },
    },
  },
  openrouter: {
    path: "/api/alpha/decisions",
    body: {
      model: "jev-latest",
      state: TEXT,
      questions: {
        wants_refund: { type: "noul", instructions: "Does the customer want a refund?" },
        request: { type: "choice", instructions: "What does the customer want?", criteria: { refund: "Wants the money back", replacement: "Wants a new mug", other: null } },
        severity: { type: "score", criteria: LEVELS },
      },
    },
  },
  openai: {
    path: "/v1/decisions",
    body: {
      model: "gpt-6-luna",
      input: TEXT,
      questions: [
        { type: "predicate", name: "wants_refund", instructions: "Does the customer want a refund?" },
        { type: "choice", name: "request", instructions: "What does the customer want?", choices: [{ value: "refund", description: "Wants the money back" }, { value: "replacement", description: "Wants a new mug" }, { value: "other" }] },
        { type: "score", name: "severity", instructions: "How severe is the damage?", levels: LEVELS.map((label) => ({ label })) },
      ],
    },
  },
  gemini: {
    path: "/v1beta/decisions",
    body: {
      model: "gemini-decision-1",
      input: TEXT,
      questions: {
        wants_refund: { type: "noul", instructions: "Does the customer want a refund?", criteria: { true_description: "Asks for money back" } },
        request: { type: "choice", instructions: "What does the customer want?", criteria: { refund: "Wants the money back", replacement: "Wants a new mug", other: "Something else" } },
        severity: { type: "score", instructions: "How severe is the damage?", criteria: LEVELS },
      },
    },
  },
  vercel: {
    path: "/v1/evaluate",
    body: {
      model: "jev-latest",
      state: TEXT,
      questions: {
        wants_refund: { type: "boolean", instructions: "Does the customer want a refund?" },
        request: { type: "choice", criteria: { refund: "Wants the money back", replacement: "Wants a new mug", other: "Something else" } },
        severity: { type: "score", criteria: LEVELS },
      },
    },
  },
  s1compat: {
    path: "/v1/decisions",
    body: {
      model: "jev-latest",
      state: TEXT,
      questions: {
        wants_refund: { type: "noul", instructions: "Does the customer want a refund?" },
        request: { type: "choice", criteria: { refund: "Wants the money back", replacement: "Wants a new mug", other: null } },
        severity: { type: "score", criteria: LEVELS },
      },
    },
  },
  databricks: {
    path: "/api/2.0/ai-functions/ai-decide",
    body: {
      model: "jev-latest",
      state: { ticket: TEXT, channel: "email" },
      questions: {
        wants_refund: { type: "noul", instructions: "Does the customer want a refund?", criteria: { true: "Asks for money back", false: "Does not" } },
        request: { type: "choice", instructions: "What does the customer want?", criteria: { refund: "Wants the money back", replacement: "Wants a new mug", other: null } },
        severity: { type: "score", instructions: "How severe is the damage?", criteria: LEVELS },
      },
      options: { version: "1.0" },
    },
  },
  scaledown: {
    path: "/v1/scaledown",
    body: {
      model: "jev-latest",
      state: { text: TEXT },
      questions: {
        wants_refund: { type: "noul", instructions: "Does the customer want a refund?" },
        request: { type: "choice", criteria: { refund: "Wants the money back", replacement: "Wants a new mug", other: null } },
        severity: { type: "score", criteria: LEVELS },
      },
    },
  },
};
