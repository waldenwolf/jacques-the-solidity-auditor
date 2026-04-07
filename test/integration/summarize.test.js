import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { Anthropic } from "@anthropic-ai/sdk";

import { summarize } from "../../scripts/auditor/perform/summarize.js";

const SKIP = !process.env.ANTHROPIC_API_KEY;

const SAMPLE_CLASSIFICATION = {
  protocolType: "general",
  features: ["balance-tracking", "raw-eth-transfers"],
  agentPriority: [
    "01-reentrancy", "02-access-control", "03-math-precision", "04-state-consistency",
    "05-economic-attack", "06-logic-flow", "07-external-integration", "08-comprehensive-review",
  ],
  reasoning: "Simple bank contract with deposit/withdraw",
};

const SAMPLE_VALIDATION = {
  validated: [{
    id: "C-1",
    title: "Complete Fund Drain via Reentrancy in withdraw()",
    severity: "Critical",
    confidence: 95,
    contract: "Bank",
    function: "withdraw",
    location: "contracts/core/Bank.sol:25-34",
    bugClass: "classic-reentrancy",
    swc: "SWC-107",
    description: "External call via msg.sender.call{value: amount} occurs before balances[msg.sender] -= amount, allowing recursive re-entry to drain all funds.",
    attackFlow: "1. Deposit 1 ETH 2. Call withdraw(1 ETH) 3. receive() re-enters withdraw 4. Balance still 1 ETH 5. Loop until contract drained",
    proof: "Line 31: msg.sender.call{value: amount} before line 34: balances[msg.sender] -= amount",
    fix: "Move balance deduction before external call",
    intentAnalysis: "Code comment documents the vulnerability — suspected intentional backdoor",
    gates: "Passed all 4 gates",
    agents: ["01-reentrancy", "08-comprehensive-review"],
  }],
  leads: [],
  rejected: [],
  summary: { totalFromAgents: 2, confirmed: 1, leads: 0, rejected: 0, chains: 0 },
};

const SAMPLE_FINDINGS = `
--- Agent: 01-reentrancy ---
FINDING | confidence: [95] | severity: Critical | contract: Bank | function: withdraw
location: contracts/core/Bank.sol:25-34
proof: External call before state update allows reentrancy drain
`;

describe("summarize (integration)", { skip: SKIP && "ANTHROPIC_API_KEY not set" }, () => {
  let agent;

  before(() => {
    agent = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  });

  it("generates a markdown report with validated findings", { timeout: 60_000 }, async () => {
    const report = await summarize(agent, SAMPLE_FINDINGS, SAMPLE_CLASSIFICATION, {
      validationResult: SAMPLE_VALIDATION,
    });

    assert.ok(typeof report === "string");
    assert.ok(report.length > 100, "report should be substantial");
    assert.match(report, /[Ss]ummary/);
    assert.match(report, /[Rr]eentrancy|CEI|withdraw/);
    assert.match(report, /[Cc]ritical/, "should flag as Critical");
    assert.match(report, /SWC-107|SWC/, "should include SWC reference");
    assert.match(
      report,
      /APPROVE|REJECT|REQUEST CHANGES|Verdict/i,
      "should include PR verdict",
    );

    console.log(report);
  });
});
