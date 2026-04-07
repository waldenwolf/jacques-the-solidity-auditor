import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_MODEL, createMessageWithRetry } from "../../utils/anthropic.js";

describe("DEFAULT_MODEL", () => {
  it("exports a non-empty string", () => {
    assert.ok(typeof DEFAULT_MODEL === "string");
    assert.ok(DEFAULT_MODEL.length > 0);
  });
});

describe("createMessageWithRetry", () => {
  it("returns result on first try when API succeeds", async () => {
    const fakeAgent = {
      messages: {
        create: async () => ({ content: [{ text: "ok" }] }),
      },
    };
    const result = await createMessageWithRetry(fakeAgent, { model: "m", max_tokens: 1 });
    assert.deepStrictEqual(result.content[0].text, "ok");
  });

  it("retries on 429 then succeeds", async () => {
    let calls = 0;
    const fakeAgent = {
      messages: {
        create: async () => {
          calls++;
          if (calls === 1) {
            const err = new Error("rate limit");
            err.status = 429;
            throw err;
          }
          return { content: [{ text: "recovered" }] };
        },
      },
    };
    const result = await createMessageWithRetry(fakeAgent, { model: "m", max_tokens: 1 }, { maxRetries: 2 });
    assert.equal(result.content[0].text, "recovered");
    assert.equal(calls, 2);
  });

  it("retries on 529 (overload)", async () => {
    let calls = 0;
    const fakeAgent = {
      messages: {
        create: async () => {
          calls++;
          if (calls <= 2) {
            const err = new Error("overloaded");
            err.status = 529;
            throw err;
          }
          return { content: [{ text: "ok" }] };
        },
      },
    };
    const result = await createMessageWithRetry(fakeAgent, { model: "m", max_tokens: 1 }, { maxRetries: 3 });
    assert.equal(result.content[0].text, "ok");
    assert.equal(calls, 3);
  });

  it("throws immediately on non-retryable errors (e.g. 401)", async () => {
    const fakeAgent = {
      messages: {
        create: async () => {
          const err = new Error("unauthorized");
          err.status = 401;
          throw err;
        },
      },
    };
    await assert.rejects(
      () => createMessageWithRetry(fakeAgent, { model: "m", max_tokens: 1 }),
      { message: "unauthorized" },
    );
  });

  it("throws after exhausting retries", async () => {
    let calls = 0;
    const fakeAgent = {
      messages: {
        create: async () => {
          calls++;
          const err = new Error("rate limit");
          err.status = 429;
          throw err;
        },
      },
    };
    await assert.rejects(
      () => createMessageWithRetry(fakeAgent, { model: "m", max_tokens: 1 }, { maxRetries: 1 }),
      { message: "rate limit" },
    );
    assert.equal(calls, 2);
  });
});
