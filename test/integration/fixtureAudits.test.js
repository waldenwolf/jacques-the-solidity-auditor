import assert from "node:assert/strict";
import path from "node:path";
import { describe, it, before } from "node:test";
import { fileURLToPath } from "node:url";
import { Anthropic } from "@anthropic-ai/sdk";

import { prepareFiles, createLocalReadFile } from "../../scripts/auditor/prepare/prepareFiles.js";
import { classify } from "../../scripts/auditor/perform/classify.js";
import { runAgents } from "../../scripts/auditor/perform/runAgents.js";
import { validate } from "../../scripts/auditor/perform/validate.js";
import { summarize } from "../../scripts/auditor/perform/summarize.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(__dirname, "..", "fixtures");

const SKIP = !process.env.ANTHROPIC_API_KEY;

describe("lending-protocol audit (integration)", { skip: SKIP && "ANTHROPIC_API_KEY not set" }, () => {
  const root = path.join(fixturesDir, "lending-protocol");
  let agent, contextMarkdown, classification;

  before(async () => {
    agent = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const readFile = createLocalReadFile(root);
    const result = await prepareFiles({
      entryPaths: ["core/LendingPool.sol", "core/PriceOracle.sol"],
      readFile,
    });
    contextMarkdown = result.contextMarkdown;
  });

  it("classifies as lending protocol", { timeout: 60_000 }, async () => {
    classification = await classify(agent, contextMarkdown);
    const validTypes = ["lending", "general"];
    assert.ok(
      validTypes.includes(classification.protocolType),
      `Expected lending or general, got ${classification.protocolType}`,
    );
    assert.ok(classification.features.length > 0, "should detect features");
    assert.ok(classification.investigationQuestions.length >= 3, "should generate questions");
  });

  it("agents detect oracle and liquidation vulnerabilities", { timeout: 180_000 }, async () => {
    if (!classification) {
      classification = await classify(agent, contextMarkdown);
    }

    const { allFindings } = await runAgents(agent, contextMarkdown, classification, {
      agentSubset: ["02-access-control", "05-economic-attack"],
    });

    assert.ok(allFindings.length > 100, "should produce findings");
    assert.match(
      allFindings,
      /[Oo]racle|[Pp]rice|manipulat/i,
      "should identify oracle manipulation risk",
    );
    assert.match(
      allFindings,
      /[Aa]ccess|[Uu]nprotected|setPrice|[Pp]ermission/i,
      "should identify missing access control on oracle",
    );
  });

  it("full mini-pipeline produces actionable report", { timeout: 300_000 }, async () => {
    if (!classification) {
      classification = await classify(agent, contextMarkdown);
    }

    const { allFindings } = await runAgents(agent, contextMarkdown, classification, {
      agentSubset: ["01-reentrancy", "02-access-control"],
    });

    const validationResult = await validate(agent, allFindings, contextMarkdown, classification);
    const report = await summarize(agent, allFindings, classification, { validationResult });

    assert.ok(typeof report === "string");
    assert.ok(report.length > 200, "report should be substantial");
    assert.match(report, /[Ss]ecurity|[Aa]udit|[Ss]ummary/);
    assert.match(report, /APPROVE|REJECT|REQUEST CHANGES|Verdict/i, "should include PR verdict");
  });
});

describe("vault-protocol audit (integration)", { skip: SKIP && "ANTHROPIC_API_KEY not set" }, () => {
  const root = path.join(fixturesDir, "vault-protocol");
  let agent, contextMarkdown, classification;

  before(async () => {
    agent = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const readFile = createLocalReadFile(root);
    const result = await prepareFiles({
      entryPaths: ["core/YieldVault.sol"],
      readFile,
    });
    contextMarkdown = result.contextMarkdown;
  });

  it("classifies as vault protocol", { timeout: 60_000 }, async () => {
    classification = await classify(agent, contextMarkdown);
    const validTypes = ["vault", "general"];
    assert.ok(
      validTypes.includes(classification.protocolType),
      `Expected vault or general, got ${classification.protocolType}`,
    );
  });

  it("agents detect share inflation and rounding issues", { timeout: 180_000 }, async () => {
    if (!classification) {
      classification = await classify(agent, contextMarkdown);
    }

    const { allFindings } = await runAgents(agent, contextMarkdown, classification, {
      agentSubset: ["03-math-precision", "05-economic-attack"],
    });

    assert.ok(allFindings.length > 100, "should produce findings");
    assert.match(
      allFindings,
      /[Ss]hare|inflat|first.?deposit|donat|round/i,
      "should identify share inflation or rounding vulnerability",
    );
  });
});

describe("proxy-protocol audit (integration)", { skip: SKIP && "ANTHROPIC_API_KEY not set" }, () => {
  const root = path.join(fixturesDir, "proxy-protocol");
  let agent, contextMarkdown, classification;

  before(async () => {
    agent = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const readFile = createLocalReadFile(root);
    const result = await prepareFiles({
      entryPaths: ["proxy/ERC1967Proxy.sol", "core/TokenBridge.sol"],
      readFile,
    });
    contextMarkdown = result.contextMarkdown;
  });

  it("classifies as bridge or general", { timeout: 60_000 }, async () => {
    classification = await classify(agent, contextMarkdown);
    const validTypes = ["bridge", "general"];
    assert.ok(
      validTypes.includes(classification.protocolType),
      `Expected bridge or general, got ${classification.protocolType}`,
    );
  });

  it("agents detect initialization and upgrade vulnerabilities", { timeout: 180_000 }, async () => {
    if (!classification) {
      classification = await classify(agent, contextMarkdown);
    }

    const { allFindings } = await runAgents(agent, contextMarkdown, classification, {
      agentSubset: ["02-access-control", "06-logic-flow"],
    });

    assert.ok(allFindings.length > 100, "should produce findings");
    assert.match(
      allFindings,
      /[Ii]nitializ|[Uu]pgrade|[Rr]einitializ/i,
      "should identify initialization or upgrade vulnerability",
    );
  });
});
