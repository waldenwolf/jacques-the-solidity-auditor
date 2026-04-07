import assert from "node:assert/strict";
import path from "node:path";
import { describe, it, before } from "node:test";
import { fileURLToPath } from "node:url";
import { Anthropic } from "@anthropic-ai/sdk";

import { prepareFiles, createLocalReadFile } from "../../scripts/auditor/prepare/prepareFiles.js";
import { classify } from "../../scripts/auditor/perform/classify.js";
import { runAgents } from "../../scripts/auditor/perform/runAgents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const SKIP = !process.env.ANTHROPIC_API_KEY;

describe("runAgents (integration)", { skip: SKIP && "ANTHROPIC_API_KEY not set" }, () => {
  let agent;
  let contextMarkdown;
  let classification;

  before(async () => {
    agent = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const readFile = createLocalReadFile(repoRoot);
    const result = await prepareFiles({
      entryPaths: ["contracts/core/Bank.sol"],
      readFile,
    });
    contextMarkdown = result.contextMarkdown;
    classification = await classify(agent, contextMarkdown);
  });

  it("runs a subset of agents and returns structured results", { timeout: 120_000 }, async () => {
    const { agentResults, allFindings } = await runAgents(
      agent,
      contextMarkdown,
      classification,
      { agentSubset: ["01-reentrancy", "02-access-control"] },
    );

    assert.equal(agentResults.length, 2);
    assert.equal(agentResults[0].agentName, "01-reentrancy");
    assert.equal(agentResults[1].agentName, "02-access-control");
    assert.ok(typeof agentResults[0].findings === "string");
    assert.ok(agentResults[0].findings.length > 0);
    assert.ok(typeof allFindings === "string");
    assert.ok(allFindings.includes("01-reentrancy"));
  });
});
