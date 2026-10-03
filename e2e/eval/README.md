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
