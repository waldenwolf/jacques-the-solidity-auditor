/**
 * Cross-run consensus filtering and merge.
 *
 * Given validation results from N independent runs, produces a merged result
 * where findings that appear in multiple runs gain a consensus boost and
 * findings from only one run are flagged as single-run.
 */

/**
 * Generates a normalized key for deduplication.
 * Uses contract + function + bugClass, lowercased and trimmed.
 * @param {object} finding
 * @returns {string}
 */
function findingKey(finding) {
  const c = (finding.contract || "").toLowerCase().trim();
  const f = (finding.function || finding.func || "").toLowerCase().trim();
  const b = (finding.bugClass || "").toLowerCase().trim();
  return `${c}|${f}|${b}`;
}

/**
 * Merges validation results from multiple runs into a single consensus result.
 *
 * @param {Array<import('./validate.js').ValidationResult>} runResults - validation results from each run
 * @param {object} [options]
 * @param {number} [options.consensusThreshold] - minimum runs for "consensus" tag (default: 2)
 * @returns {import('./validate.js').ValidationResult}
 */
export function mergeRuns(runResults, options = {}) {
  const threshold = options.consensusThreshold ?? 2;
  const totalRuns = runResults.length;

  if (totalRuns === 0) {
    return { validated: [], leads: [], rejected: [], blindSpots: [], summary: { totalFromAgents: 0, confirmed: 0, leads: 0, rejected: 0, chains: 0 } };
  }
  if (totalRuns === 1) {
    return runResults[0];
  }

  // --- Merge confirmed findings ---
  const confirmedMap = new Map();
  for (let runIdx = 0; runIdx < totalRuns; runIdx++) {
    for (const finding of runResults[runIdx].validated || []) {
      const key = findingKey(finding);
      if (!confirmedMap.has(key)) {
        confirmedMap.set(key, { best: finding, runIndices: new Set(), confidences: [] });
      }
      const entry = confirmedMap.get(key);
      entry.runIndices.add(runIdx);
      entry.confidences.push(finding.confidence ?? 0);
      if ((finding.confidence ?? 0) > (entry.best.confidence ?? 0)) {
        entry.best = finding;
      }
    }
  }

  const validated = [];
  for (const [, entry] of confirmedMap) {
    const runsFound = entry.runIndices.size;
    const isConsensus = runsFound >= threshold;
    const avgConfidence = Math.round(entry.confidences.reduce((a, b) => a + b, 0) / entry.confidences.length);
    const consensusBoost = isConsensus ? 5 : 0;

    validated.push({
      ...entry.best,
      confidence: Math.min(100, avgConfidence + consensusBoost),
      consensus: {
        runsFound,
        totalRuns,
        isConsensus,
        confidences: entry.confidences,
      },
    });
  }

  validated.sort((a, b) => {
    const sevOrder = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    const sa = sevOrder[a.severity] ?? 4;
    const sb = sevOrder[b.severity] ?? 4;
    if (sa !== sb) return sa - sb;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  // --- Merge leads (union, deduplicated) ---
  const leadMap = new Map();
  for (const result of runResults) {
    for (const lead of result.leads || []) {
      const key = findingKey(lead);
      if (!leadMap.has(key)) {
        leadMap.set(key, lead);
      }
    }
  }
  const leads = [...leadMap.values()];

  // --- Merge rejected (union) ---
  const rejectedMap = new Map();
  for (const result of runResults) {
    for (const rej of result.rejected || []) {
      const key = (rej.title || "").toLowerCase().trim();
      if (!rejectedMap.has(key)) {
        rejectedMap.set(key, rej);
      }
    }
  }
  const rejected = [...rejectedMap.values()];

  // --- Merge blind spots (union) ---
  const blindSpotSet = new Set();
  for (const result of runResults) {
    for (const bs of result.blindSpots || []) {
      blindSpotSet.add(bs);
    }
  }
  const blindSpots = [...blindSpotSet];

  // --- Promote leads that were confirmed in other runs ---
  const confirmedKeys = new Set(confirmedMap.keys());
  const promotedFromLeads = [];
  const remainingLeads = [];
  for (const lead of leads) {
    const key = findingKey(lead);
    if (confirmedKeys.has(key)) {
      continue;
    }
    const confirmedInOtherRun = runResults.some((r) =>
      (r.validated || []).some((v) => findingKey(v) === key),
    );
    if (confirmedInOtherRun) {
      continue;
    }
    remainingLeads.push(lead);
  }

  const summary = {
    totalFromAgents: runResults.reduce((sum, r) => sum + (r.summary?.totalFromAgents ?? 0), 0),
    confirmed: validated.length,
    leads: remainingLeads.length,
    rejected: rejected.length,
    chains: runResults.reduce((sum, r) => sum + (r.summary?.chains ?? 0), 0),
    consensusFindings: validated.filter((v) => v.consensus?.isConsensus).length,
    singleRunFindings: validated.filter((v) => !v.consensus?.isConsensus).length,
    runsCompleted: totalRuns,
  };

  return { validated, leads: remainingLeads, rejected, blindSpots, summary };
}
