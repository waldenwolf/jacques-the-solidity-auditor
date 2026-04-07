import { loadPrompt, loadSharedRules, loadReference, fillTemplate } from "../../../utils/loadPrompt.js";
import { DEFAULT_MODEL, createMessageWithRetry } from "../../../utils/anthropic.js";
import { DEFAULT_AGENT_ORDER } from "./classify.js";
import { nullLogger, formatResponseMeta } from "../../../utils/logger.js";

const FINAL_REVIEWER = "08-comprehensive-review";
const DEFAULT_CONCURRENCY = 4;

/**
 * @typedef {object} AgentResult
 * @property {string} agentName
 * @property {string} findings - raw text output from the agent
 */

/**
 * Runs audit agents in two phases:
 *   Phase 1 — All domain-specific agents (01-07) run in parallel.
 *   Phase 2 — The final reviewer (08-comprehensive-review) runs sequentially
 *             with all Phase 1 findings as context.
 *
 * @param {import('@anthropic-ai/sdk').Anthropic} agent
 * @param {string} contextMarkdown
 * @param {{ protocolType: string, features: string[], agentPriority: string[], reasoning: string, investigationQuestions?: string[] }} classification
 * @param {object} [options]
 * @param {string} [options.model]
 * @param {string[]} [options.agentSubset] - run only these agents (for testing)
 * @param {string[]} [options.userQuestions] - user-provided questions to investigate
 * @param {Map<string, string>} [options.priorResults] - already-completed agents to skip (agentName -> findings)
 * @param {number} [options.concurrency] - max parallel API calls in Phase 1 (default 4)
 * @param {(agentName: string, index: number, total: number) => void} [options.onAgentStart]
 * @param {(agentName: string, findings: string) => void} [options.onAgentComplete]
 * @param {import('../../../utils/logger.js').Logger} [options.logger]
 * @returns {Promise<{ agentResults: AgentResult[], allFindings: string }>}
 */
export async function runAgents(agent, contextMarkdown, classification, options = {}) {
  const model = options.model ?? DEFAULT_MODEL;
  const logger = options.logger ?? nullLogger;
  const agentOrder = options.agentSubset ?? ensureComplete(classification.agentPriority);
  const classificationResult = JSON.stringify(classification, null, 2);
  const sharedRules = loadSharedRules();
  const priorResults = options.priorResults ?? new Map();
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;

  const userQuestionContext = options.userQuestions?.length
    ? "\n\n## User Investigation Request (MUST address these specifically)\n" +
      options.userQuestions.map((q, i) => `UQ${i + 1}: ${q}`).join("\n")
    : "";

  const investigationContext = classification.investigationQuestions?.length
    ? "\n\n## Investigation Agenda\n" +
      classification.investigationQuestions.map((q, i) => `Q${i + 1}: ${q}`).join("\n")
    : "";

  const invariantsText = classification.invariants?.length
    ? classification.invariants.join("\n")
    : "No invariants extracted.";

  const threatModelText = classification.threatModel
    ? JSON.stringify(classification.threatModel, null, 2)
    : "No threat model generated.";

  const referenceContext = loadReference(classification.protocolType);

  function callAgent(agentName, priorFindings) {
    if (priorResults.has(agentName)) {
      const findings = priorResults.get(agentName);
      const idx = agentOrder.indexOf(agentName);
      logger.info("agents", `[${idx + 1}/${agentOrder.length}] ${agentName} (loaded from prior run)`);
      return Promise.resolve({ agentName, findings, fromPrior: true });
    }

    return (async () => {
      const idx = agentOrder.indexOf(agentName);
      options.onAgentStart?.(agentName, idx, agentOrder.length);

      const agentSystemPrompt = loadPrompt(`agents/${agentName}`, "system");
      const systemPrompt = sharedRules
        ? sharedRules + "\n\n---\n\n" + agentSystemPrompt
        : agentSystemPrompt;

      const userPrompt = fillTemplate(loadPrompt(`agents/${agentName}`, "user"), {
        contextText: contextMarkdown,
        classificationResult: classificationResult + userQuestionContext + investigationContext,
        priorFindings: priorFindings || "No prior findings yet.",
        invariants: invariantsText,
        threatModel: threatModelText,
        referenceContext,
      });

      const isOpus = model.includes("opus");
      const response = await createMessageWithRetry(agent, {
        model,
        max_tokens: isOpus ? 32768 : 8192,
        temperature: 0.3,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }, {
        onRetry: (retryNum, status, msg) => {
          logger.warn("agents", `[${agentName}] API retry ${retryNum} (HTTP ${status}): ${msg}`);
        },
      });

      const findings = response.content[0].text;
      const meta = formatResponseMeta(response);
      logger.debug("agents", `[${agentName}] ${meta}, length=${findings.length}`);

      if (response.stop_reason === "max_tokens") {
        logger.warn("agents", `[${agentName}] Response TRUNCATED (stop_reason=max_tokens) — findings may be incomplete`);
      }

      options.onAgentComplete?.(agentName, findings);
      return { agentName, findings, fromPrior: false };
    })();
  }

  // Phase 1: domain-specific agents run in parallel
  const parallelAgents = agentOrder.filter((a) => a !== FINAL_REVIEWER);
  const hasFinalReviewer = agentOrder.includes(FINAL_REVIEWER);

  const phase1Results = await pMap(
    parallelAgents,
    (agentName) => callAgent(agentName, "No prior findings yet."),
    concurrency,
  );

  // Build accumulated findings from Phase 1 in agent order
  const resultMap = new Map();
  for (const r of phase1Results) resultMap.set(r.agentName, r);

  let accumulatedFindings = "";
  for (const name of agentOrder) {
    if (resultMap.has(name)) {
      accumulatedFindings += `\n\n--- Agent: ${name} ---\n${resultMap.get(name).findings}`;
    }
  }

  // Phase 2: final reviewer runs with all Phase 1 findings
  if (hasFinalReviewer) {
    const reviewerResult = await callAgent(FINAL_REVIEWER, accumulatedFindings);
    resultMap.set(FINAL_REVIEWER, reviewerResult);
    accumulatedFindings += `\n\n--- Agent: ${FINAL_REVIEWER} ---\n${reviewerResult.findings}`;
  }

  // Assemble results in original agent order
  const agentResults = agentOrder
    .filter((name) => resultMap.has(name))
    .map((name) => ({ agentName: name, findings: resultMap.get(name).findings }));

  return { agentResults, allFindings: accumulatedFindings.trim() };
}

/**
 * Runs async tasks with bounded concurrency (no external dependencies).
 * @template T, R
 * @param {T[]} items
 * @param {(item: T, index: number) => Promise<R>} fn
 * @param {number} concurrency
 * @returns {Promise<R[]>}
 */
async function pMap(items, fn, concurrency) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  return results;
}

/**
 * Ensures all 8 agents are present in the priority list.
 * Appends any missing agents in default order.
 */
function ensureComplete(agentPriority) {
  const seen = new Set(agentPriority);
  const complete = [...agentPriority];
  for (const a of DEFAULT_AGENT_ORDER) {
    if (!seen.has(a)) complete.push(a);
  }
  return complete;
}
