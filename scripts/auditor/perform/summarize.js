import { loadPrompt, fillTemplate } from "../../../utils/loadPrompt.js";
import { DEFAULT_MODEL, createMessageWithRetry } from "../../../utils/anthropic.js";
import { nullLogger, formatResponseMeta } from "../../../utils/logger.js";

/**
 * @param {import('@anthropic-ai/sdk').Anthropic} agent
 * @param {string} allFindings - accumulated raw findings from all agents
 * @param {object} classification
 * @param {object} [options]
 * @param {string} [options.model]
 * @param {import('./validate.js').ValidationResult} [options.validationResult]
 * @param {string} [options.contextMarkdown]
 * @param {string[]} [options.userQuestions]
 * @param {import('../../../utils/logger.js').Logger} [options.logger]
 * @returns {Promise<string>} final markdown report
 */
export async function summarize(agent, allFindings, classification, options = {}) {
  const model = options.model ?? DEFAULT_MODEL;
  const logger = options.logger ?? nullLogger;
  const validationResult = options.validationResult;

  const validatedFindings = validationResult?.validated?.length
    ? JSON.stringify(validationResult, null, 2)
    : "No validated findings available — use raw agent findings below.";

  const userQuestionsBlock = options.userQuestions?.length
    ? "## User Questions (MUST be answered explicitly in section 7)\n" +
      options.userQuestions.map((q, i) => `Q${i + 1}: ${q}`).join("\n")
    : "";

  const systemPrompt = loadPrompt("summarize", "system");
  const userPrompt = fillTemplate(loadPrompt("summarize", "user"), {
    classificationResult: JSON.stringify(classification, null, 2),
    validatedFindings,
    auditResults: allFindings,
    contextText: options.contextMarkdown ?? "",
    userQuestions: userQuestionsBlock,
  });

  const isOpus = model.includes("opus");
  const response = await createMessageWithRetry(agent, {
    model,
    max_tokens: isOpus ? 32768 : 16384,
    temperature: 0.3,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  }, {
    onRetry: (retryNum, status, msg) => {
      logger.warn("summarize", `API retry ${retryNum} (HTTP ${status}): ${msg}`);
    },
  });

  const text = response.content[0].text;
  const meta = formatResponseMeta(response);
  logger.debug("summarize", `Response: ${meta}, length=${text.length}`);

  if (response.stop_reason === "max_tokens") {
    logger.warn("summarize", `Response TRUNCATED (stop_reason=max_tokens) — report may be incomplete`);
  }

  return text;
}
