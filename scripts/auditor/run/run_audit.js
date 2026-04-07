import { Anthropic } from "@anthropic-ai/sdk";

import {
  prepareFiles,
  formatContextMarkdown,
  createLocalReadFile,
  createRemoteReadFile,
  toRepoRelativePosix,
  buildLocalFileIndex,
  buildRemoteFileIndex,
} from "../prepare/prepareFiles.js";
import { resolveModel, DEFAULT_MODEL } from "../../../utils/anthropic.js";
import { createRunStore, openRunStore } from "../../../utils/runStore.js";
import { createLogger } from "../../../utils/logger.js";
import { classify } from "../perform/classify.js";
import { runAgents } from "../perform/runAgents.js";
import { validate } from "../perform/validate.js";
import { mergeRuns } from "../perform/mergeRuns.js";
import { summarize } from "../perform/summarize.js";
import { postComment } from "../perform/postComment.js";

/**
 * @typedef {object} AuditOptions
 * @property {string} [model]
 * @property {string[]} [agentSubset] - run only specific agents (for testing)
 * @property {string[]} [userQuestions] - user-provided questions the audit must answer
 * @property {boolean} [quiet]
 * @property {boolean} [verbose] - enable debug-level logging to console and always to run log file
 * @property {string} [projectRoot] - project root for run store (defaults to cwd of auditor)
 * @property {number} [runs] - number of independent audit runs (default: 1)
 * @property {number} [consensusThreshold] - min runs for consensus tag (default: 2)
 */

/**
 * Runs the full audit pipeline in local mode.
 *
 * @param {string[]} entryPaths - repo-relative .sol paths
 * @param {string} repoRoot - absolute path to repo root
 * @param {AuditOptions} [options]
 * @returns {Promise<string>} final markdown report
 */
export async function runLocal(entryPaths, repoRoot, options = {}) {
  const agent = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const readFile = createLocalReadFile(repoRoot);
  const modelId = options.model ?? DEFAULT_MODEL;

  const projectRoot = options.projectRoot ?? process.cwd();
  const store = createRunStore(projectRoot);

  const logger = createLogger({
    verbose: options.verbose ?? false,
    quiet: options.quiet ?? false,
    runDir: store.runDir,
  });

  logger.info("config", `Model: ${modelId}`);
  logger.info("config", `Run dir: ${store.runDir}`);
  if (options.verbose) logger.info("config", "Verbose logging enabled");
  store.save("00-config", {
    model: modelId,
    repoRoot,
    entryPaths,
    userQuestions: options.userQuestions ?? [],
    verbose: options.verbose ?? false,
    timestamp: new Date().toISOString(),
  });

  if (options.userQuestions?.length) {
    logger.info("questions", `${options.userQuestions.length} user question(s) to answer`);
  }

  const pipelineOpts = { ...options, logger };

  logger.info("prepare", "Building file index...");
  const fileIndex = await buildLocalFileIndex(repoRoot);
  logger.info("prepare", `indexed ${fileIndex.size} .sol files`);

  logger.info("prepare", "Building file context...");
  const { contextMarkdown, externalImports, preparedFiles } = await prepareFiles({ entryPaths, readFile, fileIndex });
  if (externalImports.length > 0) {
    logger.info("prepare", `external deps: ${externalImports.length} (${externalImports.slice(0, 3).join(", ")}${externalImports.length > 3 ? "..." : ""})`);
  }
  store.save("01-context", contextMarkdown);
  store.save("01-files", { files: preparedFiles.map((f) => ({ path: f.path, role: f.role })), externalImports });

  logger.info("classify", "Classifying protocol...");
  const classification = await classify(agent, contextMarkdown, {
    ...pipelineOpts,
    onStepComplete: (step, data) => store.save(`02-${step}`, data),
  });
  logger.info("classify", `type: ${classification.protocolType}, features: ${classification.features.join(", ")}`);
  if (classification.investigationQuestions?.length) {
    logger.info("classify", `questions: ${classification.investigationQuestions.length} generated`);
  }
  store.save("02-classify", classification);

  const numRuns = options.runs ?? 1;
  const consensusThreshold = options.consensusThreshold ?? 2;

  const runValidations = [];
  const allFindingsPerRun = [];

  for (let run = 1; run <= numRuns; run++) {
    const runPrefix = numRuns > 1 ? `run${run}-` : "";
    if (numRuns > 1) logger.info("agents", `=== Run ${run}/${numRuns} ===`);

    logger.info("agents", "Running audit agents...");
    const { agentResults, allFindings } = await runAgents(agent, contextMarkdown, classification, {
      ...pipelineOpts,
      onAgentStart: (name, i, total) => logger.info("agents", `[${i + 1}/${total}] ${name}`),
      onAgentComplete: (name, findings) => store.save(`03-${runPrefix}agent-${name}`, findings),
    });
    store.save(`03-${runPrefix}agents-all`, allFindings);
    allFindingsPerRun.push(allFindings);

    logger.info("validate", "Validating and deduplicating findings...");
    const validationResult = await validate(agent, allFindings, contextMarkdown, classification, {
      ...pipelineOpts,
      onStepComplete: (step, data) => store.save(`04-${runPrefix}${step}`, data),
    });
    logger.info("validate", `confirmed: ${validationResult.summary.confirmed}, leads: ${validationResult.summary.leads}, rejected: ${validationResult.summary.rejected}`);
    store.save(`04-${runPrefix}validate`, validationResult);
    runValidations.push(validationResult);
  }

  let finalValidation;
  let allFindings;
  if (numRuns > 1) {
    logger.info("merge", `Merging ${numRuns} runs with consensus threshold ${consensusThreshold}...`);
    finalValidation = mergeRuns(runValidations, { consensusThreshold });
    store.save("04-merged", finalValidation);
    logger.info("merge", `Merged: ${finalValidation.summary.confirmed} confirmed (${finalValidation.summary.consensusFindings} consensus, ${finalValidation.summary.singleRunFindings} single-run), ${finalValidation.summary.leads} leads`);
    allFindings = allFindingsPerRun.join("\n\n===== NEXT RUN =====\n\n");
    store.save("03-agents-all", allFindings);
  } else {
    finalValidation = runValidations[0];
    allFindings = allFindingsPerRun[0];
  }

  logger.info("summarize", "Generating final report...");
  const report = await summarize(agent, allFindings, classification, {
    ...pipelineOpts,
    validationResult: finalValidation,
    contextMarkdown,
  });
  store.save("05-report", report);

  logger.info("done", `All steps saved to: ${store.runDir}`);
  return report;
}

/**
 * Runs the full audit pipeline in GitHub Actions mode.
 *
 * @param {object} params
 * @param {*} params.octokit
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.prNumber
 * @param {string} params.baseSha
 * @param {string} params.headSha
 * @param {Array<{ filename: string, status: string, patch?: string }>} params.solidityFiles
 * @param {AuditOptions} [options]
 * @returns {Promise<string>} final markdown report
 */
export async function runRemote(params, options = {}) {
  const { octokit, owner, repo, prNumber, baseSha, headSha, solidityFiles } = params;
  const agent = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const projectRoot = options.projectRoot ?? process.cwd();
  const store = createRunStore(projectRoot);

  const logger = createLogger({
    verbose: options.verbose ?? false,
    quiet: options.quiet ?? false,
    runDir: store.runDir,
  });

  logger.info("config", `Run dir: ${store.runDir}`);
  if (options.verbose) logger.info("config", "Verbose logging enabled");

  const readBase = createRemoteReadFile(octokit, owner, repo, baseSha);
  const readHead = createRemoteReadFile(octokit, owner, repo, headSha);

  const nonAdded = solidityFiles.filter((f) => f.status !== "added").map((f) => f.filename);
  const added = solidityFiles.filter((f) => f.status === "added").map((f) => f.filename);
  const mergedMap = new Map();

  const pipelineOpts = { ...options, logger };

  logger.info("prepare", "Building remote file index...");
  const fileIndex = await buildRemoteFileIndex(octokit, owner, repo, headSha);
  logger.info("prepare", `indexed ${fileIndex.size} .sol files`);

  logger.info("prepare", "Building file context...");
  if (nonAdded.length > 0) {
    const { preparedFiles } = await prepareFiles({ entryPaths: nonAdded, readFile: readBase, fileIndex });
    for (const f of preparedFiles) mergedMap.set(f.path, f);
  }
  if (added.length > 0) {
    const { preparedFiles } = await prepareFiles({ entryPaths: added, readFile: readHead, fileIndex });
    for (const f of preparedFiles) {
      if (!mergedMap.has(f.path)) mergedMap.set(f.path, f);
    }
  }

  const perFile = {};
  for (const f of solidityFiles) {
    perFile[toRepoRelativePosix(f.filename)] = { status: f.status, patch: f.patch ?? null };
  }

  const contextMarkdown = formatContextMarkdown([...mergedMap.values()], {
    perFile,
    changedPathsInOrder: solidityFiles.map((f) => f.filename),
  });

  store.save("01-context", contextMarkdown);

  logger.info("classify", "Classifying protocol...");
  const classification = await classify(agent, contextMarkdown, {
    ...pipelineOpts,
    onStepComplete: (step, data) => store.save(`02-${step}`, data),
  });
  store.save("02-classify", classification);

  logger.info("agents", "Running audit agents...");
  const { agentResults, allFindings } = await runAgents(agent, contextMarkdown, classification, {
    ...pipelineOpts,
    onAgentStart: (name, i, total) => logger.info("agents", `[${i + 1}/${total}] ${name}`),
    onAgentComplete: (name, findings) => store.save(`03-agent-${name}`, findings),
  });
  store.save("03-agents-all", allFindings);

  logger.info("validate", "Validating and deduplicating findings...");
  const validationResult = await validate(agent, allFindings, contextMarkdown, classification, {
    ...pipelineOpts,
    onStepComplete: (step, data) => store.save(`04-${step}`, data),
  });
  logger.info("validate", `confirmed: ${validationResult.summary.confirmed}, leads: ${validationResult.summary.leads}, rejected: ${validationResult.summary.rejected}`);
  store.save("04-validate", validationResult);

  logger.info("summarize", "Generating final report...");
  const report = await summarize(agent, allFindings, classification, {
    ...pipelineOpts,
    validationResult,
    contextMarkdown,
  });
  store.save("05-report", report);

  logger.info("post", "Posting comment on PR...");
  await postComment(octokit, owner, repo, prNumber, report);

  logger.info("done", `All steps saved to: ${store.runDir}`);
  return report;
}

/**
 * Resumes a previously failed local audit run from the last completed step.
 *
 * @param {string} resumeDir - absolute path to the existing run directory
 * @param {AuditOptions} [overrides] - optional overrides (e.g. model)
 * @returns {Promise<string>} final markdown report
 */
export async function resumeLocal(resumeDir, overrides = {}) {
  const agent = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const store = openRunStore(resumeDir);

  const config = store.load("00-config");
  const modelId = overrides.model ?? config.model ?? DEFAULT_MODEL;
  const verbose = overrides.verbose ?? config.verbose ?? false;

  const logger = createLogger({
    verbose,
    quiet: overrides.quiet ?? false,
    runDir: store.runDir,
  });

  logger.info("resume", `Resuming run: ${store.runDir}`);
  logger.info("resume", `Model: ${modelId}`);

  // --- Load context ---
  if (!store.has("01-context")) {
    throw new Error("Cannot resume: 01-context.md is missing from run directory");
  }
  const contextMarkdown = store.load("01-context");
  logger.info("resume", "Loaded context from prior run");

  // --- Load or re-run classification ---
  let classification;
  if (store.has("02-classify")) {
    classification = store.load("02-classify");
    logger.info("resume", `Loaded classification: type=${classification.protocolType}`);
  } else {
    logger.info("classify", "Classifying protocol...");
    const pipelineOpts = { ...overrides, model: modelId, logger };
    classification = await classify(agent, contextMarkdown, {
      ...pipelineOpts,
      onStepComplete: (step, data) => store.save(`02-${step}`, data),
    });
    store.save("02-classify", classification);
    logger.info("classify", `type: ${classification.protocolType}, features: ${classification.features.join(", ")}`);
  }

  // --- Load completed agents ---
  const priorResults = new Map();
  const agentSteps = store.list("03-agent-");
  for (const step of agentSteps) {
    if (step === "03-agents-all") continue;
    const agentName = step.replace("03-agent-", "");
    priorResults.set(agentName, store.load(step));
  }
  if (priorResults.size > 0) {
    logger.info("resume", `Loaded ${priorResults.size} agent(s) from prior run`);
  }

  const pipelineOpts = { ...overrides, model: modelId, logger };
  const userQuestions = overrides.userQuestions ?? config.userQuestions ?? [];

  // --- Run agents (skips prior results) ---
  logger.info("agents", "Running audit agents...");
  const { agentResults, allFindings } = await runAgents(agent, contextMarkdown, classification, {
    ...pipelineOpts,
    userQuestions,
    priorResults,
    onAgentStart: (name, i, total) => logger.info("agents", `[${i + 1}/${total}] ${name}`),
    onAgentComplete: (name, findings) => store.save(`03-agent-${name}`, findings),
  });
  store.save("03-agents-all", allFindings);

  // --- Validate ---
  logger.info("validate", "Validating and deduplicating findings...");
  const validationResult = await validate(agent, allFindings, contextMarkdown, classification, {
    ...pipelineOpts,
    onStepComplete: (step, data) => store.save(`04-${step}`, data),
  });
  logger.info("validate", `confirmed: ${validationResult.summary.confirmed}, leads: ${validationResult.summary.leads}, rejected: ${validationResult.summary.rejected}`);
  store.save("04-validate", validationResult);

  // --- Summarize (always re-run) ---
  logger.info("summarize", "Generating final report...");
  const report = await summarize(agent, allFindings, classification, {
    ...pipelineOpts,
    validationResult,
    contextMarkdown,
    userQuestions,
  });
  store.save("05-report", report);

  logger.info("done", `All steps saved to: ${store.runDir}`);
  return report;
}

// CLI entry point for local mode
import { resolve, relative, isAbsolute } from "node:path";

const isMainModule = process.argv[1] &&
  (process.argv[1].endsWith("run_audit.js") || process.argv[1].endsWith("run/run_audit.js"));

if (isMainModule && !process.env.GITHUB_ACTIONS) {
  const rawArgs = process.argv.slice(2);

  let repoRoot = process.cwd();
  let modelOverride = null;
  let verbose = false;
  let resumePath = null;
  let numRuns = 1;
  let consensusThreshold = 2;
  const files = [];
  const questions = [];

  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === "--root" && rawArgs[i + 1]) {
      repoRoot = resolve(rawArgs[++i]);
    } else if (rawArgs[i] === "--output" && rawArgs[i + 1]) {
      process.env._AUDIT_OUTPUT = resolve(rawArgs[++i]);
    } else if ((rawArgs[i] === "--question" || rawArgs[i] === "-q") && rawArgs[i + 1]) {
      questions.push(rawArgs[++i]);
    } else if ((rawArgs[i] === "--model" || rawArgs[i] === "-m") && rawArgs[i + 1]) {
      modelOverride = rawArgs[++i];
    } else if (rawArgs[i] === "--verbose" || rawArgs[i] === "-v") {
      verbose = true;
    } else if (rawArgs[i] === "--resume" && rawArgs[i + 1]) {
      resumePath = resolve(rawArgs[++i]);
    } else if (rawArgs[i] === "--runs" && rawArgs[i + 1]) {
      numRuns = parseInt(rawArgs[++i], 10);
      if (isNaN(numRuns) || numRuns < 1) { console.error("--runs must be a positive integer"); process.exit(1); }
    } else if (rawArgs[i] === "--consensus-threshold" && rawArgs[i + 1]) {
      consensusThreshold = parseInt(rawArgs[++i], 10);
      if (isNaN(consensusThreshold) || consensusThreshold < 1) { console.error("--consensus-threshold must be a positive integer"); process.exit(1); }
    } else if (!rawArgs[i].startsWith("--")) {
      files.push(rawArgs[i]);
    }
  }

  if (!resumePath && files.length === 0) {
    console.error("Usage: node scripts/auditor/run/run_audit.js [options] <file1.sol> [file2.sol] ...");
    console.error("       node scripts/auditor/run/run_audit.js --resume <run-dir> [options]");
    console.error("");
    console.error("Options:");
    console.error("  --root <path>         Repo root directory (default: cwd)");
    console.error("  --output <path>       Write report to file instead of stdout");
    console.error("  --question, -q <text> Ask a specific question the audit must answer (repeatable)");
    console.error("  --model, -m <model>   Anthropic model to use (default: claude-sonnet-4-6)");
    console.error("                        Shorthands: opus, sonnet, haiku");
    console.error("                        Full IDs: claude-opus-4-6, claude-sonnet-4-6, etc.");
    console.error("  --verbose, -v         Enable detailed debug logging to console");
    console.error("                        (debug logs always written to run dir)");
    console.error("  --resume <path>       Resume a previously failed run from its directory");
    console.error("  --runs <N>            Run N independent audits and merge with consensus (default: 1)");
    console.error("  --consensus-threshold <N>");
    console.error("                        Min runs a finding must appear in for consensus tag (default: 2)");
    console.error("");
    console.error("Examples:");
    console.error("  # Audit files in current repo");
    console.error("  npm run audit -- contracts/Bank.sol");
    console.error("");
    console.error("  # Audit files from an external project");
    console.error("  npm run audit -- --root /path/to/other-project contracts/Token.sol");
    console.error("");
    console.error("  # Audit with a targeted question");
    console.error('  npm run audit -- -q "Are pending amounts handled on withdrawal?" contracts/Vault.sol');
    console.error("");
    console.error("  # Use Opus for deeper analysis");
    console.error("  npm run audit -- -m opus contracts/LiquidLocker.sol");
    console.error("");
    console.error("  # Enable verbose logging for debugging");
    console.error("  npm run audit -- -v -m opus contracts/Token.sol");
    console.error("");
    console.error("  # Resume a failed run");
    console.error("  npm run audit -- --resume tmp/runs/2026-04-06T22-53-19");
    console.error("");
    console.error("  # Run 3 independent audits with consensus filtering");
    console.error("  npm run audit -- --runs 3 contracts/Gauge.sol");
    console.error("");
    console.error("  # Run 3 audits, require 3/3 consensus for high confidence");
    console.error("  npm run audit -- --runs 3 --consensus-threshold 3 contracts/Gauge.sol");
    console.error("");
    console.error("  # Full example: external project, opus model, output to file, with question");
    console.error('  npm run audit -- --root /path/to/project -m opus --output report.md \\');
    console.error('    -q "Are pending amounts properly handled when withdrawing?" \\');
    console.error("    contracts/LiquidLocker.sol");
    process.exit(1);
  }

  const auditOptions = { verbose, runs: numRuns, consensusThreshold };
  if (questions.length > 0) auditOptions.userQuestions = questions;
  if (modelOverride) {
    try {
      auditOptions.model = resolveModel(modelOverride);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  const runPromise = resumePath
    ? resumeLocal(resumePath, auditOptions)
    : (() => {
        const entryPaths = files.map((f) => {
          if (isAbsolute(f)) return relative(repoRoot, f);
          return f;
        });
        return runLocal(entryPaths, repoRoot, auditOptions);
      })();

  runPromise
    .then(async (report) => {
      console.log("\n" + "=".repeat(80));
      console.log(report);

      if (process.env._AUDIT_OUTPUT) {
        const { writeFileSync } = await import("node:fs");
        writeFileSync(process.env._AUDIT_OUTPUT, report, "utf8");
        console.log(`\nReport saved to ${process.env._AUDIT_OUTPUT}`);
      }
    })
    .catch((err) => {
      console.error("Audit failed:", err);
      process.exit(1);
    });
}
