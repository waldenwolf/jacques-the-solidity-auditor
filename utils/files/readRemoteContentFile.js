export async function readRemoteContentFile(octokit, owner, repo, path, ref) {
  let code;

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });
    if (Array.isArray(data)) {
      throw new Error(`Path is a directory, not a file: ${path}`);
    }
    if (data.type !== "file" || typeof data.content !== "string") {
      throw new Error(
        `Expected a file with base64 content at ${path}, got type=${data.type ?? "unknown"}`,
      );
    }
    code = Buffer.from(data.content, "base64").toString("utf-8");
  } catch (err) {
    throw new Error(
      `Unable to fetch remote content file ${path} from ${owner}/${repo} at ref ${ref}: ${err.message}`,
    );
  }
  return code;
}
