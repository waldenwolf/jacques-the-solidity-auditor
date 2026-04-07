import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_ROOT = join(__dirname, "..", "prompts");

let _sharedRulesCache = null;

/**
 * @param {string} category - e.g. "classify", "summarize", "agents/01-reentrancy"
 * @param {"system" | "user"} role
 * @returns {string}
 */
export function loadPrompt(category, role) {
  const filePath = join(PROMPTS_ROOT, category, `${role}.md`);
  return readFileSync(filePath, "utf8");
}

/**
 * Loads prompts/shared-rules.md (cached after first read).
 * @returns {string}
 */
export function loadSharedRules() {
  if (_sharedRulesCache === null) {
    const filePath = join(PROMPTS_ROOT, "shared-rules.md");
    _sharedRulesCache = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
  }
  return _sharedRulesCache;
}

const REFERENCE_TYPE_MAP = {
  staking: "staking",
  vault: "staking",
  gauge: "staking",
};

/**
 * Loads a protocol-type-specific reference file if one exists.
 * Falls back to empty string if no reference matches.
 * @param {string} protocolType - e.g. "staking", "lending", "vault"
 * @returns {string}
 */
export function loadReference(protocolType) {
  const refType = REFERENCE_TYPE_MAP[protocolType?.toLowerCase()] ?? protocolType?.toLowerCase();
  if (!refType) return "No protocol-specific reference available.";
  const filePath = join(PROMPTS_ROOT, "reference", `${refType}.md`);
  return existsSync(filePath)
    ? readFileSync(filePath, "utf8")
    : "No protocol-specific reference available.";
}

/**
 * @param {string} template
 * @param {Record<string, string>} vars
 * @returns {string}
 */
export function fillTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replaceAll(`{{${key}}}`, value ?? "");
  }
  return result;
}
