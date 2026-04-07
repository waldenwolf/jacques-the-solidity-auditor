import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { runLocal } from "../../scripts/auditor/run/run_audit.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const SKIP = !process.env.ANTHROPIC_API_KEY;

describe("pipeline (integration)", { skip: SKIP && "ANTHROPIC_API_KEY not set" }, () => {
  it("runs full local pipeline on Bank.sol with 2-agent subset", { timeout: 300_000 }, async () => {
    const report = await runLocal(
      ["contracts/core/Bank.sol"],
      repoRoot,
      { agentSubset: ["01-reentrancy", "03-math-precision"], quiet: true },
    );

    assert.ok(typeof report === "string");
    assert.ok(report.length > 200, "should produce a substantial report");

    assert.match(report, /[Ss]ecurity|[Aa]udit|[Ss]ummary/, "report should contain audit summary");
    assert.match(report, /[Rr]eentrancy|CEI/, "report should identify reentrancy");
    assert.match(report, /[Cc]ritical/, "reentrancy in Bank.sol should be rated Critical");
    assert.match(report, /[Rr]ecommendation|[Ff]ix/, "report should include recommendations");
    assert.match(
      report,
      /APPROVE|REJECT|REQUEST CHANGES|Verdict/i,
      "report should include a PR verdict",
    );

    console.log(report);
  });
});
