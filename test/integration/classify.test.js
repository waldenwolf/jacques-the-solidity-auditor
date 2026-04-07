import assert from "node:assert/strict";
import path from "node:path";
import { describe, it, before } from "node:test";
import { fileURLToPath } from "node:url";
import { Anthropic } from "@anthropic-ai/sdk";

import { prepareFiles, createLocalReadFile } from "../../scripts/auditor/prepare/prepareFiles.js";
import { classify } from "../../scripts/auditor/perform/classify.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const SKIP = !process.env.ANTHROPIC_API_KEY;

describe("classify (integration)", { skip: SKIP && "ANTHROPIC_API_KEY not set" }, () => {
  let agent;
  let contextMarkdown;

  before(async () => {
    agent = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const readFile = createLocalReadFile(repoRoot);
    const result = await prepareFiles({
      entryPaths: ["contracts/core/Bank.sol"],
      readFile,
    });
    contextMarkdown = result.contextMarkdown;
  });

  it("returns a valid classification with expected keys including investigation questions", { timeout: 60_000 }, async () => {
    const result = await classify(agent, contextMarkdown);

    assert.ok(typeof result.protocolType === "string");
    assert.ok(result.protocolType.length > 0);
    assert.ok(Array.isArray(result.features));
    assert.ok(Array.isArray(result.agentPriority));
    assert.ok(result.agentPriority.length > 0, "should have at least some agent priorities");
    assert.ok(typeof result.reasoning === "string");
    assert.ok(Array.isArray(result.investigationQuestions), "should have investigationQuestions");
    assert.ok(
      result.investigationQuestions.length >= 3 && result.investigationQuestions.length <= 5,
      `should have 3-5 questions, got ${result.investigationQuestions.length}`,
    );
  });

  it("classifies Bank.sol correctly (not AMM/bridge/governance)", { timeout: 60_000 }, async () => {
    const result = await classify(agent, contextMarkdown);
    const validTypes = ["general", "vault", "lending", "staking", "bank"];
    assert.ok(
      validTypes.includes(result.protocolType),
      `Expected one of ${validTypes.join(", ")}, got ${result.protocolType}`,
    );
  });
});
