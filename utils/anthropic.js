export const DEFAULT_MODEL = "claude-sonnet-4-6";

export const KNOWN_MODELS = {
  "opus":       "claude-opus-4-6",
  "sonnet":     "claude-sonnet-4-6",
  "haiku":      "claude-haiku-4-5",
  // Full IDs also accepted directly
  "claude-opus-4-6":          "claude-opus-4-6",
  "claude-sonnet-4-6":        "claude-sonnet-4-6",
  "claude-haiku-4-5":         "claude-haiku-4-5",
  // Legacy aliases
  "claude-sonnet-4-5":        "claude-sonnet-4-5",
  "claude-sonnet-4-20250514": "claude-sonnet-4-20250514",
  "claude-opus-4-5":          "claude-opus-4-5",
};

/**
 * Resolves a model shorthand or full ID to a valid Anthropic model identifier.
 * @param {string} input
 * @returns {string}
 */
export function resolveModel(input) {
  const key = input.toLowerCase().trim();
  if (KNOWN_MODELS[key]) return KNOWN_MODELS[key];
  // If it looks like a full model ID (contains "claude-"), pass through
  if (key.startsWith("claude-")) return input;
  const available = Object.keys(KNOWN_MODELS).filter(k => !k.startsWith("claude-")).join(", ");
  throw new Error(`Unknown model "${input}". Available shorthands: ${available}. Or pass a full Anthropic model ID.`);
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 529]);
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Wraps an Anthropic messages.create call with retry + exponential backoff.
 * Automatically uses streaming for large requests (high max_tokens + Opus)
 * to avoid the SDK's 10-minute non-streaming timeout.
 *
 * @param {import('@anthropic-ai/sdk').Anthropic} agent
 * @param {import('@anthropic-ai/sdk').MessageCreateParams} params
 * @param {{ maxRetries?: number, onRetry?: (attempt: number, status: number|undefined, message: string) => void }} [options]
 * @returns {Promise<import('@anthropic-ai/sdk').Message>}
 */
export async function createMessageWithRetry(agent, params, options = {}) {
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const onRetry = options.onRetry;
  const needsStreaming = params.max_tokens >= 8192 && params.model?.includes("opus");

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (needsStreaming) {
        return await streamToMessage(agent, params);
      }
      return await agent.messages.create(params);
    } catch (err) {
      const status = err.status ?? err.statusCode;
      const isRetryable = RETRYABLE_STATUS.has(status);
      const isStreamingRequired = err.message?.includes("Streaming is required");
      const isLast = attempt === maxRetries;

      if (isStreamingRequired && !needsStreaming) {
        return await streamToMessage(agent, params);
      }

      if (!isRetryable || isLast) throw err;

      onRetry?.(attempt + 1, status, err.message ?? "unknown error");
      const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Uses streaming to collect the full response, returning a Message-compatible object.
 * @param {import('@anthropic-ai/sdk').Anthropic} agent
 * @param {import('@anthropic-ai/sdk').MessageCreateParams} params
 * @returns {Promise<import('@anthropic-ai/sdk').Message>}
 */
async function streamToMessage(agent, params) {
  const stream = agent.messages.stream({ ...params, stream: true });
  const response = await stream.finalMessage();
  return response;
}
