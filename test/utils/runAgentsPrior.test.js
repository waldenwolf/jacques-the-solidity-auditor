import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runAgents } from "../../scripts/auditor/perform/runAgents.js";

function makeFakeAgent(responseText = "No issues found.") {
  return {
    messages: {
      stream(params) {
        const msg = {
          id: "msg_fake",
          type: "message",
          role: "assistant",
          model: params.model,
          content: [{ type: "text", text: responseText }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50 },
        };
        return {
          async finalMessage() { return msg; },
          [Symbol.asyncIterator]() {
            let done = false;
            return { async next() { if (done) return { done: true }; done = true; return { value: msg, done: false }; } };
          },
        };
      },
      async create(params) {
        return {
          id: "msg_fake",
          type: "message",
          role: "assistant",
          model: params.model,
          content: [{ type: "text", text: responseText }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      },
    },
  };
}

/**
 * Creates a fake agent that records every create() call for inspection.
 * Returns { agent, calls } where calls is an array of { params, response }.
 */
function makeTrackingAgent(responseText = "findings") {
  const calls = [];
  const agent = {
    messages: {
      async create(params) {
        const response = {
          id: "msg_fake",
          type: "message",
          role: "assistant",
          model: params.model,
          content: [{ type: "text", text: responseText }],
          stop_reason: "end_turn",
          usage: { input_tokens: 100, output_tokens: 50 },
        };
        calls.push({ params, response });
        return response;
      },
    },
  };
  return { agent, calls };
}

const CLASSIFICATION = {
  protocolType: "general",
  features: [],
  agentPriority: ["01-reentrancy", "02-access-control"],
  reasoning: "test",
};

const CLASSIFICATION_WITH_08 = {
  protocolType: "general",
  features: [],
  agentPriority: ["01-reentrancy", "02-access-control", "08-comprehensive-review"],
  reasoning: "test",
};

describe("runAgents priorResults", () => {
  it("skips agents present in priorResults", async () => {
    const agent = makeFakeAgent("New findings from API");

    const priorResults = new Map([
      ["01-reentrancy", "Prior reentrancy findings from disk"],
    ]);

    const { agentResults, allFindings } = await runAgents(
      agent,
      "# Context\ncode",
      CLASSIFICATION,
      {
        agentSubset: ["01-reentrancy", "02-access-control"],
        priorResults,
      },
    );

    assert.equal(agentResults.length, 2);
    assert.equal(agentResults[0].agentName, "01-reentrancy");
    assert.equal(agentResults[0].findings, "Prior reentrancy findings from disk");
    assert.equal(agentResults[1].agentName, "02-access-control");

    assert.ok(allFindings.includes("01-reentrancy"));
    assert.ok(allFindings.includes("02-access-control"));
    assert.ok(allFindings.includes("Prior reentrancy findings from disk"));
  });

  it("does not call onAgentComplete for skipped agents", async () => {
    const agent = makeFakeAgent("findings");
    const completedAgents = [];

    const priorResults = new Map([
      ["01-reentrancy", "prior findings"],
    ]);

    await runAgents(
      agent,
      "# Context",
      CLASSIFICATION,
      {
        agentSubset: ["01-reentrancy", "02-access-control"],
        priorResults,
        onAgentComplete: (name) => completedAgents.push(name),
      },
    );

    assert.ok(!completedAgents.includes("01-reentrancy"), "should not call onAgentComplete for skipped agent");
    assert.ok(completedAgents.includes("02-access-control"), "should call onAgentComplete for new agent");
  });
});

describe("runAgents parallel execution", () => {
  it("Phase 1 agents receive 'No prior findings yet.' instead of accumulated findings", async () => {
    const { agent, calls } = makeTrackingAgent();

    await runAgents(agent, "# Context", CLASSIFICATION, {
      agentSubset: ["01-reentrancy", "02-access-control"],
    });

    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.ok(
        call.params.messages[0].content.includes("No prior findings yet."),
        "Phase 1 agents should receive 'No prior findings yet.'",
      );
    }
  });

  it("agent 08 receives all Phase 1 findings as priorFindings", async () => {
    const { agent, calls } = makeTrackingAgent();

    await runAgents(agent, "# Context", CLASSIFICATION_WITH_08, {
      agentSubset: ["01-reentrancy", "02-access-control", "08-comprehensive-review"],
    });

    assert.equal(calls.length, 3, "should make 3 API calls (2 parallel + 1 sequential)");

    // Agent 08 is the last call (Phase 2)
    const agent08Call = calls[calls.length - 1];
    const prompt = agent08Call.params.messages[0].content;

    assert.ok(prompt.includes("01-reentrancy"), "agent 08 prompt should contain agent 01 findings header");
    assert.ok(prompt.includes("02-access-control"), "agent 08 prompt should contain agent 02 findings header");
    assert.ok(!prompt.includes("No prior findings yet."), "agent 08 should NOT have empty prior findings");
  });

  it("runs Phase 1 agents concurrently (wall-clock < sequential sum)", async () => {
    const DELAY_MS = 100;
    const agent = {
      messages: {
        async create(params) {
          await new Promise((r) => setTimeout(r, DELAY_MS));
          return {
            id: "msg_fake", type: "message", role: "assistant", model: params.model,
            content: [{ type: "text", text: "findings" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 100, output_tokens: 50 },
          };
        },
      },
    };

    const start = Date.now();
    await runAgents(agent, "# Context", CLASSIFICATION, {
      agentSubset: ["01-reentrancy", "02-access-control"],
      concurrency: 4,
    });
    const elapsed = Date.now() - start;

    const sequentialMin = DELAY_MS * 2;
    assert.ok(
      elapsed < sequentialMin + 80,
      `parallel should be faster than sequential (${elapsed}ms vs ${sequentialMin}ms sequential minimum)`,
    );
  });

  it("results are ordered by agentOrder regardless of completion order", async () => {
    let callCount = 0;
    const agent = {
      messages: {
        async create(params) {
          const delay = callCount++ === 0 ? 80 : 10;
          await new Promise((r) => setTimeout(r, delay));
          return {
            id: "msg_fake", type: "message", role: "assistant", model: params.model,
            content: [{ type: "text", text: `findings-${callCount}` }],
            stop_reason: "end_turn",
            usage: { input_tokens: 100, output_tokens: 50 },
          };
        },
      },
    };

    const { agentResults } = await runAgents(agent, "# Context", CLASSIFICATION, {
      agentSubset: ["01-reentrancy", "02-access-control"],
      concurrency: 4,
    });

    assert.equal(agentResults[0].agentName, "01-reentrancy");
    assert.equal(agentResults[1].agentName, "02-access-control");
  });

  it("priorResults agents are included in agent 08 context", async () => {
    const { agent, calls } = makeTrackingAgent();

    const priorResults = new Map([
      ["01-reentrancy", "PRIOR_REENTRANCY_FROM_DISK"],
    ]);

    await runAgents(agent, "# Context", CLASSIFICATION_WITH_08, {
      agentSubset: ["01-reentrancy", "02-access-control", "08-comprehensive-review"],
      priorResults,
    });

    // Only 02 and 08 hit the API (01 is loaded from priorResults)
    assert.equal(calls.length, 2, "should make 2 API calls (01 skipped, 02 parallel, 08 sequential)");

    // Agent 08 is the last call (Phase 2)
    const agent08Call = calls[calls.length - 1];
    const prompt = agent08Call.params.messages[0].content;

    assert.ok(
      prompt.includes("PRIOR_REENTRANCY_FROM_DISK"),
      "agent 08 should receive priorResults findings in its context",
    );
    assert.ok(
      prompt.includes("02-access-control"),
      "agent 08 should also receive freshly-computed agent 02 findings",
    );
  });
});
