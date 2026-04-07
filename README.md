# Jacques-the-solidity-auditor

A GitHub Action / CLI tool that performs multi-agent AI security audits on Solidity smart contract PRs using Anthropic Claude. Also runs locally for development and ad-hoc auditing of any Solidity project.

## How it works

The audit pipeline runs in six stages:

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌────────────────┐    ┌───────────┐    ┌──────────┐
│ Prepare  │───>│   Classify   │───>│    Agents     │───>│    Validate    │───>│ Summarize │───>│   Post   │
│          │    │ + invariants │    │ (parallel x8) │    │ (8-step gate)  │    │           │    │ (CI only)│
│          │    │ + threat model│    │ + ref context │    │ + triager      │    │           │    │          │
└──────────┘    └──────────────┘    └──────────────┘    │ + PoC prompts  │    └───────────┘    └──────────┘
                                         ↑              └────────────────┘
                                    ┌────┴────┐                ↑
                                    │ --runs N│ (optional)     │
                                    │ repeat  │──> merge ──────┘
                                    └─────────┘
```

### 1. Prepare

Recursively resolves all Solidity file dependencies (imports) to build full context. Works identically for local development (`fs.readFile`) and GitHub Actions (Octokit `repos.getContent`), producing the same markdown context format in both modes.

### 2. Classify

Sends the prepared context to Claude to classify the protocol type (vault, lending, DEX, staking, bank, etc.) and determine which specialized audit agents should run and in what priority order. Also generates:
- **5 protocol-specific investigation questions** that feed into the agent phase
- **State invariants** — conservation laws and coupling relationships that must hold across all operations (e.g., "workingBalance updated iff rewardIntegral checkpointed for ALL tokens")
- **Threat model** — high-value targets, attack surfaces, dangerous state transitions, and known vulnerability patterns for the classified protocol type

### 3. Run Agents

Executes 8 specialized security agents in a **two-phase parallel architecture**:
- **Phase 1**: Agents 01-07 run concurrently (up to 4 in parallel) with independent context
- **Phase 2**: Agent 08 (comprehensive review) runs with all Phase 1 findings aggregated

Each agent receives the classification, invariants, threat model, and protocol-specific reference context (when available):

| Agent | Focus |
|---|---|
| `01-reentrancy` | Cross-function and cross-contract reentrancy |
| `02-access-control` | Permission, ownership, and authorization flaws |
| `03-math-precision` | Integer overflow, rounding, precision loss |
| `04-state-consistency` | Storage corruption, coupled state desync, invariant violations |
| `05-economic-attack` | Flash loans, sandwich attacks, oracle manipulation |
| `06-logic-flow` | Business logic errors, edge cases, DoS vectors |
| `07-external-integration` | Unsafe external calls, token standards, composability |
| `08-comprehensive-review` | First-principles Feynman interrogation, cross-cutting concerns, intent analysis |

All agents share a common set of rules (`prompts/shared-rules.md`) that enforce attacker mindset, structured output, confidence scoring, and false-positive suppression.

### 4. Validate

An 8-step validation pipeline:
1. **Deduplication** — group by contract/function/bug-class, keep best version per group
2. **Four-gate validation** — Refutation, Reachability, Trigger, Impact
3. **Confidence scoring** — start at 100, deduct for partial paths / bounded impact / unlikely conditions
4. **Lead promotion** — promote strong leads with multi-agent convergence
5. **Intent analysis** — flag suspected intentional backdoors (high bar)
6. **Adversarial triager** — adopt the developer's perspective and attempt to refute each confirmed finding
7. **Completeness check** — verify all high-value attack surfaces for the protocol type were covered; flag blind spots
8. **PoC verification prompts** — generate self-contained Foundry test prompts for high-confidence findings

### 5. Summarize & Post

Synthesizes all validated findings into a structured security report with severity ratings, SWC IDs, attack flows, exploitability analysis, code diffs, and actionable recommendations including a PR verdict. In CI mode, posts the report directly as a PR comment.

## GitHub Actions — Use in your repository

The primary use case is adding automatic security audits to any Solidity project's PR workflow. There are two ways to integrate.

### Option A: Reusable action (recommended)

Reference this repo as a GitHub Action directly in your workflow. No code to copy.

**1. Add your Anthropic API key as a repository secret**

Go to your repo's **Settings > Secrets and variables > Actions > New repository secret** and add:
- Name: `ANTHROPIC_API_KEY`
- Value: your `sk-ant-...` key from [console.anthropic.com](https://console.anthropic.com/)

**2. Create the workflow file**

Create `.github/workflows/solidity-audit.yml` in your repository:

```yaml
name: Solidity Security Audit

on:
  pull_request:
    types: [opened, synchronize, reopened]
    paths:
      - '**/*.sol'

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: audit-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  audit:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - name: Checkout repository
        uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - name: Run Solidity Audit
        uses: waldenwolf/solidity-github-action-automated-ai-auditor@main
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

That's it. Every PR that touches `.sol` files will get an automated security audit comment.

**Action inputs:**

| Input | Required | Default | Description |
|---|---|---|---|
| `anthropic-api-key` | Yes | — | Your Anthropic API key |
| `model` | No | `sonnet` | Claude model (`opus`, `sonnet`, `haiku`, or full ID) |
| `verbose` | No | `false` | Enable debug logging in the workflow |

**Example with Opus model:**

```yaml
      - name: Run Solidity Audit
        uses: waldenwolf/solidity-github-action-automated-ai-auditor@main
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          model: opus
```

### Option B: Self-hosted workflow

If you prefer to fork/copy the auditor into your own repo (e.g., for customization or private networks), copy `.github/workflows/solidity-audit.yml` along with the full codebase and add `ANTHROPIC_API_KEY` as a repository secret. The workflow is self-contained:

```yaml
      - name: Run Solidity Audit
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: node scripts/auditor/prepare.js
```

### What the action does

When a PR is opened or updated with Solidity file changes:
1. Detects all changed `.sol` files in the PR
2. Fetches the full source code (including unchanged dependencies) from both base and head commits
3. Runs the full audit pipeline (classify, 8 parallel agents, validate, summarize)
4. Posts the security report as a PR comment

The comment includes findings with severity ratings, confidence scores, attack flows, and a PR verdict (APPROVE / REQUEST CHANGES / REJECT). Subsequent pushes to the same PR cancel the in-progress audit and start a fresh one.

### Customizing the trigger

You can restrict which files trigger an audit by adjusting the `paths` filter:

```yaml
on:
  pull_request:
    paths:
      - 'contracts/**/*.sol'      # Only audit files under contracts/
      - 'src/**/*.sol'            # Or only under src/
      - '!contracts/mocks/**'     # Exclude mock contracts
```

---

## Local CLI usage

### Prerequisites

- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/)

### Setup

```bash
git clone https://github.com/waldenwolf/solidity-github-action-automated-ai-auditor.git
cd solidity-github-action-automated-ai-auditor
npm install
```

Create a `.env` file at the repo root:

```
ANTHROPIC_API_KEY=sk-ant-...
```

### Audit files in this repo

```bash
npm run audit -- contracts/core/Bank.sol

# Multiple files
npm run audit -- contracts/core/Bank.sol contracts/core/BankReceiptToken.sol
```

### Audit an external project

Use `--root` to point at any Solidity project on your machine:

```bash
npm run audit -- --root /path/to/other-project contracts/Token.sol

# Absolute file paths are auto-converted to relative
npm run audit -- --root /path/to/project /path/to/project/src/Vault.sol

# Multiple files from external project
npm run audit -- --root ~/projects/my-defi src/Pool.sol src/Router.sol

# Save report to file
npm run audit -- --root /path/to/project --output report.md contracts/Token.sol
```

### Targeted questions

Pass `--question` (or `-q`) to make the audit investigate and answer specific questions:

```bash
npm run audit -- -q "Are pending amounts properly handled when withdrawing?" contracts/LiquidLocker.sol

# Multiple questions
npm run audit -- \
  -q "Is the oracle manipulable?" \
  -q "Can fees be bypassed?" \
  contracts/Pool.sol
```

### Model selection

Default is `claude-sonnet-4-6`. Use `--model` (or `-m`) for alternatives:

```bash
npm run audit -- -m opus contracts/LiquidLocker.sol    # Deeper analysis
npm run audit -- -m haiku contracts/Token.sol           # Fast triage
```

Available shorthands: `opus` (claude-opus-4-6), `sonnet` (claude-sonnet-4-6), `haiku` (claude-haiku-4-5). Full model IDs also work.

### Resuming a failed run

Each run saves incremental progress to `tmp/runs/<timestamp>/`. If a run fails mid-pipeline, resume from the last completed step:

```bash
npm run audit -- --resume tmp/runs/2026-04-06T22-53-19
npm run audit -- --resume tmp/runs/2026-04-06T22-53-19 -m opus   # switch model
```

### Multi-run consensus

Run N independent audits and merge results. Findings appearing in multiple runs get a confidence boost:

```bash
npm run audit -- --runs 3 contracts/Gauge.sol
npm run audit -- --runs 3 --consensus-threshold 3 contracts/Gauge.sol
```

### CLI reference

```
node scripts/auditor/run/run_audit.js [options] <file1.sol> [file2.sol] ...
node scripts/auditor/run/run_audit.js --resume <run-dir> [options]

Options:
  --root <path>           Repo root directory (default: current working directory)
  --output <path>         Write report to file instead of stdout
  --question, -q <text>   Ask a targeted question the audit must answer (repeatable)
  --model, -m <model>     Anthropic model (default: claude-sonnet-4-6)
                          Shorthands: opus, sonnet, haiku
  --verbose, -v           Enable detailed debug logging to console
  --resume <path>         Resume a previously failed run from its directory
  --runs <N>              Run N independent audits and merge with consensus (default: 1)
  --consensus-threshold <N>
                          Min runs for consensus tag (default: 2)
```

## Testing

```bash
# Unit tests (no API key needed)
npm test

# Integration tests (requires ANTHROPIC_API_KEY in .env)
npm run test:integration

# All tests
npm run test:all
```

Integration tests use a real Anthropic API key and run the full pipeline against sample contracts to verify classification accuracy, agent output quality, validation logic, and report format.

## Project structure

```
scripts/auditor/
  prepare.js              # GitHub Actions entry point
  prepare/prepareFiles.js # File context orchestrator
  perform/classify.js     # Protocol classification + invariants + threat model
  perform/runAgents.js    # Parallel agent execution (Phase 1 + Phase 2)
  perform/validate.js     # 8-step finding validation
  perform/mergeRuns.js    # Cross-run consensus filtering and merge
  perform/summarize.js    # Final report generation
  perform/postComment.js  # PR comment posting
  run/run_audit.js        # Pipeline orchestrator (local + remote + multi-run)

prompts/
  shared-rules.md         # Universal rules for all agents
  classify/               # Classification + invariants + threat model prompts
  agents/
    01-reentrancy/        # through 08-comprehensive-review/
    attack-vectors.md     # Condensed reference of top attack patterns
  validate/               # Validation / judging prompts (8-step)
  summarize/              # Summary generation prompts
  reference/
    staking.md            # Staking/gauge-specific vulnerability patterns

utils/
  anthropic.js            # Model config, retry with exponential backoff, streaming
  runStore.js             # Run directory persistence (save/load/resume)
  loadPrompt.js           # Prompt loading, template filling, reference loading
  prepareSolidityClosure.js
  formatContextMarkdown.js
  files/                  # File I/O utilities (local, remote, path normalization)

test/
  utils/                  # Unit tests for all utilities
  integration/            # Integration tests (real API calls)
  fixtures/
    solidity-tree/        # Simple bank with libraries (reentrancy)
    lending-protocol/     # Lending pool with oracle, interfaces, libraries
    vault-protocol/       # ERC-4626 vault with share inflation, strategy
    proxy-protocol/       # UUPS proxy bridge with initialization bugs
```

## Report format

The final audit report includes:

- **Quick Summary** — what changed and its security impact
- **Security Audit** — detailed findings with severity, confidence score, SWC ID, location, attack flow, exploitability analysis, technical details, business impact, and detection methods
- **Leads** — high-signal trails for manual investigation where the full exploit path could not be completed
- **Recommendations** — primary fix with code diff, defense-in-depth measures, and prioritized process improvements
- **PR Verdict** — APPROVE / APPROVE WITH CONDITIONS / REQUEST CHANGES / REJECT IMMEDIATELY, with intent analysis for suspected backdoors
- **Targeted Questions** _(when `--question` is used)_ — direct answers to each user question with code evidence and line citations
