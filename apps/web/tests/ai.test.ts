/**
 * Where model calls go (convex/ai.ts): librocat.com's fixed pipeline, and a
 * self-hosted librocat's choice of Jev: through the gateway, from TypeSafe,
 * from a server of its own, or not at all. Jev is the one model: there is no
 * writing model (the writing is the person's own agent's), and search calls
 * none.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  DEFAULT_MODELS,
  headers,
  inUse,
  jevChoice,
  modelsInUse,
  resolve,
  TYPESAFE_API,
  TYPESAFE_MODEL,
} from "../convex/ai";
import { answersOf, fromTypeSafe, type Question, typesafeQuestions } from "../convex/jev";

const NAMES = [
  "LIBROCAT_SELF_HOST",
  "AI_GATEWAY_API_KEY",
  "AI_GATEWAY_API_KEY_FREE",
  "LIBROCAT_AI_GATEWAY_URL",
  "TYPESAFE_API_KEY",
  "LIBROCAT_JEV",
  "LIBROCAT_JEV_URL",
  "LIBROCAT_JEV_KEY",
  "LIBROCAT_EVAL_MODEL",
];
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
  for (const n of NAMES) delete process.env[n];
});
afterEach(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
});

describe("librocat.com", () => {
  test("Jev goes through the gateway", () => {
    expect(resolve("eval")).toBeNull();
    process.env.AI_GATEWAY_API_KEY = "k";
    expect(resolve("eval")).toEqual({
      base: "https://ai-gateway.vercel.sh/v1",
      key: "k",
      model: DEFAULT_MODELS.eval,
      gateway: true,
      api: "evaluate",
    });
  });

  test("a Free library's calls use the free key when there is one: its budget caps free traffic", () => {
    process.env.AI_GATEWAY_API_KEY = "paid";
    expect(resolve("eval", "free")?.key).toBe("paid");
    process.env.AI_GATEWAY_API_KEY_FREE = "free";
    expect(resolve("eval", "free")?.key).toBe("free");
    expect(resolve("eval", "individual")?.key).toBe("paid");
    expect(resolve("eval")?.key).toBe("paid");
  });

  test("a self-host setting changes nothing on librocat.com: its users don't choose models", () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    process.env.TYPESAFE_API_KEY = "ts";
    process.env.LIBROCAT_JEV_URL = "http://systemone:8000/v1";
    process.env.LIBROCAT_JEV = "off";
    expect(resolve("eval")).toMatchObject({ gateway: true, api: "evaluate" });
  });

  test("without a key, Jev says what is missing", () => {
    expect(inUse("eval")).toEqual({ off: "AI_GATEWAY_API_KEY is not set" });
    expect(modelsInUse()).toEqual({ jev: { off: "AI_GATEWAY_API_KEY is not set" } });
  });
});

describe("a self-hosted librocat's choice of Jev", () => {
  beforeEach(() => {
    process.env.LIBROCAT_SELF_HOST = "1";
  });

  test("no key: no Jev, and nothing in its place", () => {
    expect(jevChoice()).toBe("off");
    expect(resolve("eval")).toBeNull();
  });

  test("a gateway key: Jev through the gateway", () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    expect(resolve("eval")).toMatchObject({
      gateway: true,
      api: "evaluate",
      model: DEFAULT_MODELS.eval,
    });
  });

  test("a TypeSafe key: Jev from TypeSafe's own API, first when both keys are set", () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    process.env.TYPESAFE_API_KEY = "ts";
    expect(resolve("eval")).toEqual({
      base: TYPESAFE_API,
      key: "ts",
      model: TYPESAFE_MODEL,
      gateway: false,
      api: "systemone",
    });
    process.env.LIBROCAT_EVAL_MODEL = "jev-1.13.0";
    expect(resolve("eval")?.model).toBe("jev-1.13.0");
  });

  test("LIBROCAT_JEV decides over the keys", () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    process.env.TYPESAFE_API_KEY = "ts";
    process.env.LIBROCAT_JEV = "gateway";
    expect(resolve("eval")).toMatchObject({ api: "evaluate" });
    process.env.LIBROCAT_JEV = "off";
    expect(resolve("eval")).toBeNull();
    expect(inUse("eval")).toEqual({ off: "LIBROCAT_JEV is off" });
    process.env.LIBROCAT_JEV = "typesafe";
    delete process.env.TYPESAFE_API_KEY;
    expect(resolve("eval")).toBeNull();
    expect(inUse("eval")).toEqual({
      off: "LIBROCAT_JEV is typesafe, but TYPESAFE_API_KEY is not set",
    });
  });

  test("an open-source System One on a server of your own, first when it's set", () => {
    process.env.AI_GATEWAY_API_KEY = "k";
    process.env.TYPESAFE_API_KEY = "ts";
    process.env.LIBROCAT_JEV_URL = "http://systemone:8000/v1/";
    expect(jevChoice()).toBe("local");
    expect(resolve("eval")).toEqual({
      base: "http://systemone:8000/v1",
      key: "",
      model: "default",
      gateway: false,
      api: "systemone",
      local: true,
    });
    process.env.LIBROCAT_EVAL_MODEL = "von-1.3.0";
    process.env.LIBROCAT_JEV_KEY = "own";
    expect(resolve("eval")).toMatchObject({ model: "von-1.3.0", key: "own" });
    expect(inUse("eval")).toEqual({ model: "von-1.3.0", via: "local" });
    // LIBROCAT_JEV still decides: Jev from TypeSafe, though a local server is set.
    process.env.LIBROCAT_JEV = "typesafe";
    expect(resolve("eval")).toMatchObject({ base: TYPESAFE_API, api: "systemone" });
    process.env.LIBROCAT_JEV = "local";
    delete process.env.LIBROCAT_JEV_URL;
    expect(inUse("eval")).toEqual({
      off: "LIBROCAT_JEV is local, but LIBROCAT_JEV_URL is not set",
    });
  });
});

describe("what the model runs on, for whoever runs the server", () => {
  beforeEach(() => {
    process.env.LIBROCAT_SELF_HOST = "1";
  });

  test("nothing set: off, and why", () => {
    expect(modelsInUse()).toEqual({
      jev: { off: "no System One: set LIBROCAT_JEV_URL, TYPESAFE_API_KEY, or AI_GATEWAY_API_KEY" },
    });
  });

  test("Jev through the gateway or from TypeSafe, never a key or an address", () => {
    process.env.AI_GATEWAY_API_KEY = "secret-gateway-key";
    expect(inUse("eval")).toEqual({ model: DEFAULT_MODELS.eval, via: "gateway" });
    process.env.TYPESAFE_API_KEY = "secret-typesafe-key";
    expect(inUse("eval")).toEqual({ model: TYPESAFE_MODEL, via: "typesafe" });
    const shown = JSON.stringify(modelsInUse());
    expect(shown).not.toContain("secret");
    expect(shown).not.toContain("http");
  });
});

describe("requests", () => {
  test("a server without a key gets no Authorization header", () => {
    const t = { base: "b", model: "m", gateway: false };
    expect(headers({ ...t, key: "" })).toEqual({ "Content-Type": "application/json" });
    expect(headers({ ...t, key: "s" }).Authorization).toBe("Bearer s");
  });
});

describe("Jev from TypeSafe's own API", () => {
  test("a yes/no question is a noul there; the rest go as they are", () => {
    const questions: Record<string, Question> = {
      same: {
        type: "boolean",
        instructions: "Same subject?",
        criteria: { true: "one subject", false: "two" },
      },
      horizon: { type: "choice", instructions: "When?", criteria: { month: "a month" } },
    };
    expect(typesafeQuestions(questions)).toEqual({
      same: {
        type: "noul",
        instructions: "Same subject?",
        criteria: { true: "one subject", false: "two" },
      },
      horizon: questions.horizon,
    });
  });

  test("a reply grouped by type, as some servers that speak the API send it, reads the same", () => {
    const grouped = answersOf({
      nouls: { same: { noul: 0.9 } },
      choices: { horizon: { choice: "month", probabilities: { month: 1 } } },
    });
    expect(fromTypeSafe(grouped)).toEqual({
      same: { type: "boolean", probability: 0.9 },
      horizon: { type: "choice", choice: "month", probabilities: { month: 1 } },
    });
    expect(answersOf({ answers: { same: { type: "noul", noul: 0.1 } } })).toEqual({
      same: { type: "noul", noul: 0.1 },
    });
  });

  test("its answers come back in the gateway's shape, and what isn't an answer is left out", () => {
    expect(
      fromTypeSafe({
        same: { type: "noul", noul: 0.95 },
        horizon: {
          type: "choice",
          choice: "month",
          probabilities: { month: 0.8, year: 0.2 },
          confidence: 0.81,
        },
        level: { type: "score", score: 1.05, legend: {}, probabilities: { "1": 0.9 } },
        broken: { type: "noul" },
        other: "text",
      }),
    ).toEqual({
      same: { type: "boolean", probability: 0.95 },
      horizon: { type: "choice", choice: "month", probabilities: { month: 0.8, year: 0.2 } },
      level: { type: "score", score: 1.05, probabilities: { "1": 0.9 } },
    });
  });
});
