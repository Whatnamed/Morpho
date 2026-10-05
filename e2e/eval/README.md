# P7A deterministic baseline

`contracts.ts` freezes `p7-trajectories-1` / `p7-rubric-1`. The T1 synthetic source material,
T1/T3 independent expected fact packs, T2 case-copy setup and original case JSON/asset manifest
are SHA-256 locked in `contract-lock.json`. Intentional pre-run contract changes use
`node scripts/freeze-p7-contracts.mjs --freeze`; never regenerate the lock to rescue a failing run.

The independent oracle imports no product domain/projection functions. Its expected facts come
from fixture identities and explicit user events; actual facts come from raw persisted state,
serialized client requests, local tool continuations, DOM and exported bytes. T1/T3 execution is
`not_run`, even though their contracts and oracle packs are frozen.

```powershell
npm.cmd run build
npm.cmd run test:p7
```

The separate `p7` Playwright project has one serial trial, zero retries and zero paid calls.
Normal Chromium collection explicitly excludes this trajectory; the existing Quality workflow
is unchanged. Mock failures never authorize real traffic. Missing case assets/hash mismatches,
unhandled AI endpoints, mock script overrun or changed contract locks invalidate the run.

The original baseline exposed false `summary_revision_conflict` before the first Delivery draft.
The D1 fix separates raw current identity from usable Summary content; the latest unchanged-contract
T2→T4 run passes all 17 checkpoints, including export/reopen. One driver-only correction scopes the
T4.4 confirmation action to its live card instead of the retained historical Compare card.
`node scripts/diagnose-p7-compaction.mjs` now checks that identity/content separation without any
Provider call. The original failure and interrupted driver run remain evidence. P7A-D2 now durably
saves exact Provider request intent before POST. Text reload and writer-tab stability pass ten
serial and ten default-parallel repetitions each; the full normal Chromium gate passes 76/76.
See the D2 report and baseline report for current evidence and retained historical failures.
Do not switch to an ASCII/golden/short-history fixture to hide a failure. P7 remains validating.

`T2→T4` is a continuous deterministic **slice**: it reads current route, selects real A/M/X,
generates two images with one permanent injected failure, verifies exact pixels/input roles and
lineage, reloads, returns to old A and explicitly replaces the default, creates a board preparation
package/section using the actual child, discards/applies drafts, marks the upstream descendant for
review via an explicit default replacement, hides it, refreshes only its reference and exports/reopens.
No golden Workspace is loaded after initial setup. New-angle continuation and real pixel fidelity
are `not_run`; deterministic output is a known 1×1 PNG, not a visual-quality benchmark.

All 28 real case binaries are loaded into the normal IndexedDB store and hash-verified. Canvas
positions/names and an explicit branch/default overlay are fixture setup only; case semantic records,
revisions and historical noise remain. Source `pendingReview` mutation is the current supported UI
path used to exercise upstream freshness/copy review; hiding separately exercises visibility.
Chapter selection is explicit on every reopen. Storage notices use their normal dismiss action.
Fixed automatic-compaction responses are capped at three and recorded separately; this incidental
production-threshold path does not represent full T3 execution. Drafts read the remainder of a long
chapter through the production 8000-character read boundary before requesting a write.

Each attempt writes a separate directory under `output/playwright/p7/`: manifest, checkpoint
before/after/reopen state slices, assertions, fixed responses, bounded client wire captures (16 MiB
aggregate cap), screenshots, asset hashes/bytes, output zip/manifest/source map and first divergence.
No raw chain-of-thought or product log is added. `run-manifest` links all artifact hashes. Failed
assertions preserve expected/actual; an interrupted UI step is ungradable until fixture versus product
attribution is confirmed. Setup failure is reported by Playwright and is never a product pass.

P7B adapters must provide isolated real server routes/Journal/RPC evidence (L1b), final **server** wire
inputs and real model outputs (L2), real image outputs plus preserve/change grading (L3), and
independent designer handoff (L4). This run captures client serialization only; mock Agent prose
does not prove model understanding. No production Journal/real Provider/human acceptance is implied.

P7B-3 controlled L3 runner: `node scripts/verify-p7b-l3.mjs --preflight` captures the final production
image wire with zero paid egress. The command without that flag performs real paid submissions;
do not rerun the blocked baseline without new execution authorization. Frozen plans/config/budget
are in `p7b-l3-manifest.json` and `p7b-l3-fixture-lock.json`; guard checks run via
`node --test scripts/p7b-l3-wire-guard.test.mjs`. Raw artifacts remain ignored under
`output/playwright/p7b-l3/`. Current partial/blocked results and limits:
[P7B-3 report](../../docs/operations/p7b-3-l3.md).
