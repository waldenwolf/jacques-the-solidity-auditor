import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergeRuns } from "../../scripts/auditor/perform/mergeRuns.js";

function makeFinding(overrides = {}) {
  return {
    id: "C-1",
    title: "Test finding",
    severity: "High",
    confidence: 85,
    contract: "TestContract",
    function: "testFunc",
    location: "Test.sol:10-20",
    bugClass: "stale-checkpoint",
    swc: null,
    description: "Test description",
    attackFlow: "Step 1 -> Step 2",
    proof: "code here",
    fix: "Fix suggestion",
    intentAnalysis: null,
    gates: "Passed all 4 gates",
    agents: ["04-state-consistency"],
    ...overrides,
  };
}

function makeResult(overrides = {}) {
  return {
    validated: [],
    leads: [],
    rejected: [],
    blindSpots: [],
    summary: { totalFromAgents: 0, confirmed: 0, leads: 0, rejected: 0, chains: 0 },
    ...overrides,
  };
}

describe("mergeRuns", () => {
  it("returns empty result for zero runs", () => {
    const result = mergeRuns([]);
    assert.equal(result.validated.length, 0);
    assert.equal(result.leads.length, 0);
    assert.equal(result.summary.confirmed, 0);
  });

  it("returns the single run result unchanged for one run", () => {
    const finding = makeFinding();
    const input = makeResult({ validated: [finding], summary: { totalFromAgents: 5, confirmed: 1, leads: 0, rejected: 0, chains: 0 } });
    const result = mergeRuns([input]);
    assert.equal(result.validated.length, 1);
    assert.equal(result.validated[0].title, "Test finding");
  });

  it("marks consensus when same finding appears in multiple runs", () => {
    const f1 = makeFinding({ confidence: 85 });
    const f2 = makeFinding({ confidence: 90 });
    const r1 = makeResult({ validated: [f1] });
    const r2 = makeResult({ validated: [f2] });

    const result = mergeRuns([r1, r2]);
    assert.equal(result.validated.length, 1);
    assert.equal(result.validated[0].consensus.isConsensus, true);
    assert.equal(result.validated[0].consensus.runsFound, 2);
    assert.equal(result.validated[0].consensus.totalRuns, 2);
  });

  it("applies consensus confidence boost (+5, capped at 100)", () => {
    const f1 = makeFinding({ confidence: 90 });
    const f2 = makeFinding({ confidence: 90 });
    const r1 = makeResult({ validated: [f1] });
    const r2 = makeResult({ validated: [f2] });

    const result = mergeRuns([r1, r2]);
    assert.equal(result.validated[0].confidence, 95);
  });

  it("caps confidence at 100", () => {
    const f1 = makeFinding({ confidence: 98 });
    const f2 = makeFinding({ confidence: 98 });
    const r1 = makeResult({ validated: [f1] });
    const r2 = makeResult({ validated: [f2] });

    const result = mergeRuns([r1, r2]);
    assert.equal(result.validated[0].confidence, 100);
  });

  it("keeps single-run findings without consensus flag", () => {
    const f1 = makeFinding({ confidence: 85 });
    const f2 = makeFinding({ contract: "OtherContract", bugClass: "different-bug", confidence: 75 });
    const r1 = makeResult({ validated: [f1] });
    const r2 = makeResult({ validated: [f2] });

    const result = mergeRuns([r1, r2]);
    assert.equal(result.validated.length, 2);
    const single = result.validated.find((v) => !v.consensus.isConsensus);
    assert.ok(single);
    assert.equal(single.consensus.runsFound, 1);
  });

  it("deduplicates leads across runs", () => {
    const lead = { title: "Lead 1", contract: "C", function: "f", bugClass: "x", codeSmells: "smell", description: "desc" };
    const r1 = makeResult({ leads: [lead] });
    const r2 = makeResult({ leads: [{ ...lead }] });

    const result = mergeRuns([r1, r2]);
    assert.equal(result.leads.length, 1);
  });

  it("unions blind spots from all runs", () => {
    const r1 = makeResult({ blindSpots: ["area-A"] });
    const r2 = makeResult({ blindSpots: ["area-B"] });

    const result = mergeRuns([r1, r2]);
    assert.equal(result.blindSpots.length, 2);
    assert.ok(result.blindSpots.includes("area-A"));
    assert.ok(result.blindSpots.includes("area-B"));
  });

  it("deduplicates blind spots", () => {
    const r1 = makeResult({ blindSpots: ["area-A"] });
    const r2 = makeResult({ blindSpots: ["area-A"] });

    const result = mergeRuns([r1, r2]);
    assert.equal(result.blindSpots.length, 1);
  });

  it("sorts merged findings by severity then confidence", () => {
    const critical = makeFinding({ severity: "Critical", confidence: 80, contract: "A", bugClass: "bug-a" });
    const high = makeFinding({ severity: "High", confidence: 95, contract: "B", bugClass: "bug-b" });
    const medium = makeFinding({ severity: "Medium", confidence: 90, contract: "C", bugClass: "bug-c" });
    const r1 = makeResult({ validated: [medium, critical] });
    const r2 = makeResult({ validated: [high] });

    const result = mergeRuns([r1, r2]);
    assert.equal(result.validated[0].severity, "Critical");
    assert.equal(result.validated[1].severity, "High");
    assert.equal(result.validated[2].severity, "Medium");
  });

  it("respects custom consensus threshold", () => {
    const f = makeFinding();
    const r1 = makeResult({ validated: [f] });
    const r2 = makeResult({ validated: [{ ...f }] });
    const r3 = makeResult({ validated: [] });

    const result = mergeRuns([r1, r2, r3], { consensusThreshold: 3 });
    assert.equal(result.validated[0].consensus.isConsensus, false);
    assert.equal(result.validated[0].consensus.runsFound, 2);
  });

  it("uses the highest-confidence version as the best finding", () => {
    const f1 = makeFinding({ confidence: 70, description: "weak" });
    const f2 = makeFinding({ confidence: 95, description: "strong" });
    const r1 = makeResult({ validated: [f1] });
    const r2 = makeResult({ validated: [f2] });

    const result = mergeRuns([r1, r2]);
    assert.equal(result.validated[0].description, "strong");
  });

  it("summary includes consensusFindings and singleRunFindings counts", () => {
    const shared = makeFinding({ contract: "Shared", bugClass: "shared-bug" });
    const unique = makeFinding({ contract: "Unique", bugClass: "unique-bug" });
    const r1 = makeResult({ validated: [shared, unique] });
    const r2 = makeResult({ validated: [{ ...shared }] });

    const result = mergeRuns([r1, r2]);
    assert.equal(result.summary.consensusFindings, 1);
    assert.equal(result.summary.singleRunFindings, 1);
    assert.equal(result.summary.runsCompleted, 2);
  });
});
