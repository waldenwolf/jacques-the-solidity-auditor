import { loadPrompt, fillTemplate } from "../../../utils/loadPrompt.js";
import { DEFAULT_MODEL, createMessageWithRetry } from "../../../utils/anthropic.js";
import { nullLogger, formatResponseMeta } from "../../../utils/logger.js";

const DEFAULT_AGENT_ORDER = [
  "01-reentrancy",
  "02-access-control",
  "03-math-precision",
  "04-state-consistency",
  "05-economic-attack",
  "06-logic-flow",
  "07-external-integration",
  "08-comprehensive-review",
];

/**
 * @param {import('@anthropic-ai/sdk').Anthropic} agent
 * @param {string} contextMarkdown
 * @param {object} [options]
 * @param {string} [options.model]
 * @param {(step: string, data: any) => void} [options.onStepComplete]
 * @param {import('../../../utils/logger.js').Logger} [options.logger]
 * @returns {Promise<{ protocolType: string, features: string[], agentPriority: string[], reasoning: string, investigationQuestions: string[] }>}
 */
export async function classify(agent, contextMarkdown, options = {}) {
  const model = options.model ?? DEFAULT_MODEL;
  const logger = options.logger ?? nullLogger;
  const systemPrompt = loadPrompt("classify", "system");
  const userPrompt = fillTemplate(loadPrompt("classify", "user"), {
    contextText: contextMarkdown,
  });

  const response = await createMessageWithRetry(agent, {
    model,
    max_tokens: 4096,
    temperature: 0.2,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  }, {
    onRetry: (retryNum, status, msg) => {
      logger.warn("classify", `API retry ${retryNum} (HTTP ${status}): ${msg}`);
    },
  });

  const text = response.content[0].text.trim();
  const meta = formatResponseMeta(response);
  logger.debug("classify", `Response: ${meta}, length=${text.length}`);

  if (response.stop_reason === "max_tokens") {
    logger.warn("classify", `Response TRUNCATED (stop_reason=max_tokens) — output likely incomplete`);
  }

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON object found in response");
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      protocolType: parsed.protocolType ?? "general",
      features: Array.isArray(parsed.features) ? parsed.features : [],
      agentPriority: Array.isArray(parsed.agentPriority)
        ? parsed.agentPriority.filter((a) => DEFAULT_AGENT_ORDER.includes(a))
        : DEFAULT_AGENT_ORDER,
      reasoning: parsed.reasoning ?? "",
      investigationQuestions: Array.isArray(parsed.investigationQuestions)
        ? parsed.investigationQuestions
        : [],
      invariants: Array.isArray(parsed.invariants) ? parsed.invariants : [],
      threatModel: parsed.threatModel ?? null,
    };
  } catch (err) {
    const preview = text.slice(0, 300).replace(/\n/g, "\\n");
    logger.warn("classify", `JSON parse failed, using defaults: ${err.message}`);
    logger.debug("classify", `Response preview: ${preview}`);
    options.onStepComplete?.("classify_raw", text);
    return {
      protocolType: "general",
      features: [],
      agentPriority: DEFAULT_AGENT_ORDER,
      reasoning: `Parse failed: ${text.slice(0, 200)}`,
      investigationQuestions: [],
      invariants: [],
      threatModel: null,
    };
  }
}

export { DEFAULT_AGENT_ORDER };
