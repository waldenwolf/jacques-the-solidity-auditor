import { loadPrompt, fillTemplate } from "../../../utils/loadPrompt.js";
import { DEFAULT_MODEL, createMessageWithRetry } from "../../../utils/anthropic.js";
import { nullLogger, formatResponseMeta } from "../../../utils/logger.js";

/**
 * @typedef {object} ValidatedFinding
 * @property {string} id
 * @property {string} title
 * @property {string} severity
 * @property {number} confidence
 * @property {string} contract
 * @property {string} function
 * @property {string} location
 * @property {string} bugClass
 * @property {string|null} swc
 * @property {string} description
 * @property {string} attackFlow
 * @property {string} proof
 * @property {string|null} fix
 * @property {string|null} intentAnalysis
 * @property {string} gates
 * @property {string[]} agents
 */

/**
 * @typedef {object} ValidationResult
 * @property {ValidatedFinding[]} validated
 * @property {Array<{title: string, contract: string, function: string, codeSmells: string, description: string}>} leads
 * @property {Array<{title: string, reason: string}>} rejected
 * @property {{totalFromAgents: number, confirmed: number, leads: number, rejected: number, chains: number}} summary
 */

/**
 * Attempts to extract JSON from an AI response that may contain markdown fences,
 * commentary before/after JSON, or truncated output.
 * @param {string} text
 * @returns {object}
 */
export function extractJSON(text) {
  // 1. Try specifically ```json ... ``` fence (not other languages)
  const jsonFence = text.match(/```json\s*\n?([\s\S]*?)```/);
  if (jsonFence) {
    return JSON.parse(jsonFence[1].trim());
  }

  // 2. Strip all fenced code blocks so brace matching won't hit
  //    { } inside ```solidity, ```typescript, etc.
  const stripped = text.replace(/```[a-zA-Z]*\s*\n[\s\S]*?```/g, "");

  // 3. String-aware brace matching on the cleaned text
  const start = stripped.indexOf("{");
  if (start === -1) throw new Error("No JSON object found in response");

  let depth = 0;
  let end = -1;
  let inString = false;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (inString) {
      if (ch === "\\" && i + 1 < stripped.length) { i++; continue; }
      if (ch === '"') inString = false;
    } else {
      if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
  }

  if (end === -1) {
    // Truncated JSON — try to repair by closing open brackets/braces
    let repaired = stripped.slice(start);
    const openBraces = (repaired.match(/{/g) || []).length - (repaired.match(/}/g) || []).length;
    const openBrackets = (repaired.match(/\[/g) || []).length - (repaired.match(/]/g) || []).length;
    for (let i = 0; i < openBrackets; i++) repaired += "]";
    for (let i = 0; i < openBraces; i++) repaired += "}";
    return JSON.parse(repaired);
  }

  return JSON.parse(stripped.slice(start, end + 1));
}

/**
 * Validates, deduplicates, and gates all agent findings before summarization.
 *
 * @param {import('@anthropic-ai/sdk').Anthropic} agent
 * @param {string} allFindings
 * @param {string} contextMarkdown
 * @param {object} classification
 * @param {object} [options]
 * @param {string} [options.model]
 * @param {(step: string, data: any) => void} [options.onStepComplete]
 * @param {import('../../../utils/logger.js').Logger} [options.logger]
 * @returns {Promise<ValidationResult>}
 */
export async function validate(agent, allFindings, contextMarkdown, classification, options = {}) {
  const model = options.model ?? DEFAULT_MODEL;
  const logger = options.logger ?? nullLogger;
  const invariantsText = classification.invariants?.length
    ? classification.invariants.join("\n")
    : "No invariants extracted.";
  const threatModelText = classification.threatModel
    ? JSON.stringify(classification.threatModel, null, 2)
    : "No threat model generated.";

  const systemPrompt = loadPrompt("validate", "system");
  const userPrompt = fillTemplate(loadPrompt("validate", "user"), {
    classificationResult: JSON.stringify(classification, null, 2),
    invariants: invariantsText,
    threatModel: threatModelText,
    allFindings,
    contextText: contextMarkdown,
  });

  const messages = [{ role: "user", content: userPrompt }];
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const response = await createMessageWithRetry(agent, {
      model,
      max_tokens: 32768,
      temperature: 0.2,
      system: systemPrompt,
      messages,
    }, {
      onRetry: (retryNum, status, msg) => {
        logger.warn("validate", `API retry ${retryNum} (HTTP ${status}): ${msg}`);
      },
    });

    const text = response.content[0].text.trim();
    const meta = formatResponseMeta(response);
    logger.debug("validate", `Attempt ${attempt}/${maxAttempts} response: ${meta}, length=${text.length}`);

    if (response.stop_reason === "max_tokens") {
      logger.warn("validate", `Response TRUNCATED (stop_reason=max_tokens) on attempt ${attempt}/${maxAttempts} — output likely incomplete JSON (${response.usage?.output_tokens} tokens used of ${32768} max)`);
    }

    // Always save the raw response for diagnostics
    options.onStepComplete?.(`validate_raw_attempt_${attempt}`, text);

    try {
      const parsed = extractJSON(text);

      logger.debug("validate", `Attempt ${attempt}: parsed successfully — ${(parsed.validated || []).length} validated, ${(parsed.leads || []).length} leads, ${(parsed.rejected || []).length} rejected`);

      return {
        validated: Array.isArray(parsed.validated) ? parsed.validated : [],
        leads: Array.isArray(parsed.leads) ? parsed.leads : [],
        rejected: Array.isArray(parsed.rejected) ? parsed.rejected : [],
        summary: parsed.summary ?? {
          totalFromAgents: 0,
          confirmed: (parsed.validated || []).length,
          leads: (parsed.leads || []).length,
          rejected: (parsed.rejected || []).length,
          chains: 0,
        },
      };
    } catch (err) {
      const preview = text.slice(0, 300).replace(/\n/g, "\\n");

      if (attempt < maxAttempts) {
        logger.warn("validate", `JSON parse failed (attempt ${attempt}/${maxAttempts}), retrying: ${err.message}`);
        logger.debug("validate", `Response preview: ${preview}`);
        messages.push(
          { role: "assistant", content: text },
          { role: "user", content: "Your response was not valid JSON. Please output ONLY a JSON object with keys: validated, leads, rejected, summary. No commentary before or after. Start with { and end with }." },
        );
        continue;
      }

      logger.error("validate", `JSON parse failed after ${maxAttempts} attempts: ${err.message}`);
      logger.error("validate", `Response preview: ${preview}`);
      return {
        validated: [],
        leads: [],
        rejected: [],
        summary: { totalFromAgents: 0, confirmed: 0, leads: 0, rejected: 0, chains: 0 },
        _rawResponse: text,
        _rawFindings: allFindings,
      };
    }
  }
}
