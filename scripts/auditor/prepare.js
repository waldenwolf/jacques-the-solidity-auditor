import { setFailed, info } from "@actions/core";
import { getOctokit, context } from "@actions/github";

import { runRemote } from "./run/run_audit.js";

/**
 * GitHub Action entry point. Detects PR context, lists changed .sol files,
 * and delegates to the full audit pipeline.
 */
export async function prepare() {
  try {
    const payload = context.payload;
    if (!payload.pull_request) {
      info("Not a pull request event - skipping.");
      return;
    }

    const prNumber = payload.pull_request.number;
    const owner = context.repo.owner;
    const repo = context.repo.repo;
    const baseSha = payload.pull_request.base.sha;
    const headSha = payload.pull_request.head.sha;

    const octokit = getOctokit(process.env.GITHUB_TOKEN);

    const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });

    const solidityFiles = files.filter((file) => file.filename.endsWith(".sol"));
    if (solidityFiles.length === 0) {
      info("No .sol files changed - skipping audit.");
      return;
    }

    const verbose = process.env.AUDIT_VERBOSE === "true" || process.env.AUDIT_VERBOSE === "1";

    info(`Found ${solidityFiles.length} changed .sol file(s). Starting audit pipeline...`);
    if (verbose) info("Verbose logging enabled (AUDIT_VERBOSE)");

    const options = { verbose };
    if (process.env.AUDIT_MODEL) {
      const { resolveModel } = await import("../../utils/anthropic.js");
      try {
        options.model = resolveModel(process.env.AUDIT_MODEL);
        info(`Model override: ${options.model}`);
      } catch (err) {
        info(`Invalid AUDIT_MODEL "${process.env.AUDIT_MODEL}", using default: ${err.message}`);
      }
    }

    await runRemote({
      octokit,
      owner,
      repo,
      prNumber,
      baseSha,
      headSha,
      solidityFiles,
    }, options);

    info("Audit pipeline completed successfully.");
  } catch (error) {
    setFailed(`Audit failed: ${error.message}`);
  }
}

if (process.env.GITHUB_ACTIONS) {
  await prepare();
}
