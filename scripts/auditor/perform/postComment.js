/**
 * @param {*} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {number} prNumber
 * @param {string} report
 */
export async function postComment(octokit, owner, repo, prNumber, report) {
  await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: report,
  });
}
