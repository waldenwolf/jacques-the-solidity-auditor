import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { Anthropic } from "@anthropic-ai/sdk";

import { validate } from "../../scripts/auditor/perform/validate.js";

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

const SAMPLE_CONTEXT = `### File: contracts/core/Bank.sol
\`\`\`solidity
contract Bank {
    mapping(address => uint256) public balances;
    function deposit() external payable { balances[msg.sender] += msg.value; }
    function withdraw(uint256 amount) external {
        require(balances[msg.sender] >= amount, "Insufficient balance");
        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "ETH transfer failed");
        balances[msg.sender] -= amount;
    }
}
\`\`\``;

const SAMPLE_FINDINGS = `
--- Agent: 01-reentrancy ---
FINDING | confidence: [95] | severity: Critical | contract: Bank | function: withdraw | bug_class: classic-reentrancy | group_key: Bank | withdraw | classic-reentrancy
location: contracts/core/Bank.sol:25-34
path: attacker -> withdraw -> msg.sender.call -> receive() -> re-enter withdraw -> drain
proof: External call via msg.sender.call{value: amount} at line 31 occurs before balances[msg.sender] -= amount at line 34. Attacker deposits 1 ETH, calls withdraw(1 ETH), re-enters in receive(), balance still shows 1 ETH, loops until contract drained.
description: Classic reentrancy — external call before state update allows complete fund drainage.
fix: Move balances[msg.sender] -= amount before the external call.

--- Agent: 02-access-control ---
No access control vulnerabilities detected. The contract uses public functions appropriately for a simple bank.

--- Agent: 08-comprehensive-review ---
FINDING | confidence: [85] | severity: Critical | contract: Bank | function: withdraw | bug_class: classic-reentrancy | group_key: Bank | withdraw | classic-reentrancy
location: contracts/core/Bank.sol:25-34
path: Same reentrancy as agent 01
proof: CEI violation confirmed — the code comment documents the vulnerability intentionally
description: Duplicate of reentrancy finding with intent analysis — code comment suggests deliberate backdoor.
fix: Restore CEI ordering.
`;

describe("validate (integration)", { skip: SKIP && "ANTHROPIC_API_KEY not set" }, () => {
  let agent;

  before(() => {
    agent = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  });

  it("deduplicates and validates findings with 4-gate evaluation", { timeout: 90_000 }, async () => {
    const result = await validate(agent, SAMPLE_FINDINGS, SAMPLE_CONTEXT, SAMPLE_CLASSIFICATION);

    assert.ok(Array.isArray(result.validated), "should have validated array");
    assert.ok(Array.isArray(result.leads), "should have leads array");
    assert.ok(Array.isArray(result.rejected), "should have rejected array");
    assert.ok(result.summary, "should have summary");

    if (result.validated.length > 0) {
      const finding = result.validated[0];
      assert.ok(finding.confidence >= 80, `confidence should be >= 80, got ${finding.confidence}`);
      assert.ok(
        finding.severity === "Critical" || finding.severity === "High",
        `severity should be Critical or High, got ${finding.severity}`,
      );
      assert.ok(finding.proof, "finding should have proof");
    }

    const totalOutput = result.validated.length + result.leads.length + result.rejected.length;
    assert.ok(
      totalOutput < 3,
      `should deduplicate the two identical reentrancy findings, got ${totalOutput} total items`,
    );

    console.log("Validation result:", JSON.stringify(result, null, 2));
  });
});
