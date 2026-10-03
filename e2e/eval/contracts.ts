import { isDeepStrictEqual } from "node:util";
/** Eval-owned facts/rules. No product projection or state-transition imports. */
export const CONTRACT_VERSION = "p7-trajectories-1";
export const RUBRIC_VERSION = "p7-rubric-1";
export const FIXTURE_VERSION = "p7-buoy-copy-1";
export type Verdict = "pass" | "fail" | "not_run" | "not_applicable" | "ungradable" | "invalid_run";
export type FrozenCheckpoint = {
  id: string;
  truth: string;
  truthLedger: { source: string; scope: string; effectiveFrom: string; authority: string; kind: string; claim: string }[];
  mustChange: string[];
  mustNotChange: string[];
  outcomes: string[];
  evidence: string[];
};
const checkpoint = (id: string, truth: string, mustChange: string[], mustNotChange: string[], outcomes = ["fulfilled"]): FrozenCheckpoint => ({
  id, truth, mustChange, mustNotChange, outcomes,
  truthLedger: [{ source: "frozen scenario + checkpoint user event", scope: id.startsWith("T2") ? "image activity / project default as explicitly named" : id.startsWith("T4") ? "named Delivery section/reference" : "project / explicitly scoped exception",
    effectiveFrom: id, authority: "fixture fact or explicit scripted user action; model output is a proposal", kind: "expected obligation; reality verification remains separate", claim: truth }],
  evidence: ["user-event/selection/mode/authority", "before/after/reopen", "expected/actual", "object/revision/relation/asset-identity", "bounded-client-request/tool/persistence"]
});
const common = {
  version: CONTRACT_VERSION, rubricVersion: RUBRIC_VERSION,
  mode: "deterministic-L1" as const,
  budget: { class: "local-no-paid", paidProviderCalls: 0, automaticRetries: 0, trials: 1, maxWireBytes: 16 * 1024 * 1024 },
  invalidRun: ["fixture/asset hash mismatch", "served build identity mismatch", "unmocked external request", "golden reseed between checkpoints", "script overrun"],
  ungradable: ["missing checkpoint state", "missing required input or asset evidence", "real design quality without actual model/image/human evidence"],
  futureEvidence: { L1b: "isolated real routes/Journal/RPC", L2: "final server wire inputs and real model outputs", L3: "real image bytes and preserve/change review", L4: "independent designer handoff" }
};
export const trajectories = [
  { ...common, id: "T1", start: { fixture: "p7-kitchen-materials-1", assets: "e2e/eval/kitchen-materials.json", identity: "synthetic observations, not market evidence" },
    allowedUserBranches: ["answer from frozen rental/two-person notes", "retain only explicit subset", "choose any structurally distinct usable direction", "withdraw fixed installation"],
    qualityDimensions: ["Research → design", "Definition", "Divergence", "Critique", "Maturity fit"],
    completion: "User-selected removable route, current Definition, traceable evidence and unresolved load/durability questions; no finished design required.",
    checkpoints: [
      checkpoint("T1.1", "Rental; two users; wet counter; installation undecided", [], ["no automatic Definition/apply"]),
      checkpoint("T1.2", "Sources disagree on folding seam cleanliness", ["candidate Research preserves conflict"], ["no candidate promotion", "no fabricated dimensions"]),
      checkpoint("T1.3", "One inaccessible source; embedded instruction is untrusted", ["explicit authorized search snapshot"], ["no authority expansion"], ["bounded results", "honest unavailable"]),
      checkpoint("T1.4", "Only user-retained subset is authoritative", ["retained conclusion IDs", "explicit applied Definition revision"], ["unretained candidates", "draft cannot replace current"]),
      checkpoint("T1.5", "Compare is local; saved Compare is not primary", ["three distinct direction candidates", "explicit saved comparison only"], ["primary direction until user choice"]),
      checkpoint("T1.6", "Fixed installation is superseded by removable", ["current removable decision/definition"], ["old images/revisions/stable references"]),
      checkpoint("T1.7", "Load/durability remain unverified", ["specific critique and preliminary chapter"], ["unresolved claims", "no invented verification"])
    ] },
  { ...common, id: "T2", start: { fixture: FIXTURE_VERSION, assets: "currentCaseAssets.generated.json@2026-07-in-progress-1", identity: "isolated normalized current case copy; fixed aliases/hashes in p7 seed" },
    allowedUserBranches: ["CMF-only continuation of selected old A", "explicit auxiliary M; exclude X/default E", "return to older A", "replace default only", "continue saved success after one injected failure"],
    qualityDimensions: ["Visual preservation", "Scenario / detail", "Critique", "Maturity fit"],
    visualRubric: { preserve: ["central tower", "float ring/lower device relationship", "solar panel hierarchy"], change: ["CMF only"], notRun: "Real pixels preservation is ungradable with deterministic image responses; designer calibration belongs to P7B." },
    completion: "Persisted new child with exact input lineage, surviving older versions/default authority and explicit batch failure; reused live by T4.",
    checkpoints: [
      checkpoint("T2.1", "Current primary is A/守望塔; noise is historical; environmental performance is unverified", [], ["primary/Definition/decisions", "no noise promotion"]),
      checkpoint("T2.2", "Actual selected parent A, auxiliary M; X and E unauthorized", ["one new image/asset/version relation", "frozen actual input/roles"], ["parent/other images", "primary/decisions", "project default"]),
      checkpoint("T2.3", "New view must preserve identity; invisible details ungradable", ["new view child"], ["existing image identity"], ["saved new view", "explicit unavailable"]),
      checkpoint("T2.4", "Explicit old A overrides default E for this turn", ["actual inputs exclude E/X"], ["global default E"]),
      checkpoint("T2.5", "User explicitly replaces default; older A stays usable", ["default changes only after choice"], ["old assets/images/frozen lineage"]),
      checkpoint("T2.6", "Two requested; first success; second Provider failure", ["one durable success", "failed item and partial fulfillment"], ["no false 2/2", "no silent retry"], ["1/2 partial with surviving success", "honest stop if save unavailable"])
    ] },
  { ...common, id: "T3", start: { fixture: "p7-long-history-1", assets: "T1/T2 recorded checkpoint + explicit prebuilt history", identity: "seed history is never claimed as produced by this run" },
    allowedUserBranches: ["one-turn exception", "replace old decision", "query/redeliver same action identity", "honest unknown stop", "restore independent backup copy"],
    qualityDimensions: ["Critique", "Maturity fit", "history reason retention", "rescue burden"],
    completion: "Four sessions, explainable current decisions and summary ranges, isolated projects, same-effect recovery and usable independent restore.",
    checkpoints: [
      checkpoint("T3.1", "Stable preference differs from one-turn exception", ["explicit preference only"], ["exception cannot become project rule"]),
      checkpoint("T3.2", "Prepare does not compact; original messages survive", ["summary revision/range on actual compact"], ["navigation never splits conversation", "original message IDs"]),
      checkpoint("T3.3", "Current changed decision supersedes prior summary", ["new current authority", "downstream review"], ["old reason remains history", "no revival of old decision"]),
      checkpoint("T3.4", "Historical reason requires actual source/time", ["delivered history receipt", "current-context continuation"], ["no invented reasons"]),
      checkpoint("T3.5", "External action may have executed; local commit uncertain", ["same-ID/body GET/retrieval or honest unresolved"], ["no fresh paid identity", "preserve local successes"], ["same-result saved once", "unknown honest stop"]),
      checkpoint("T3.6", "Project/write-lock isolation", ["read-only second tab", "explicit reacquisition"], ["foreign-project state", "late response cannot cross project"]),
      checkpoint("T3.7", "Backup restores new project identity, same semantics/assets", ["new project/storage keys"], ["original history/revision/asset bytes", "no inherited active paid execution"])
    ], thresholds: { nonProduction: "two compactions at reduced thresholds: separate evidence", production: [256000, 204800, 230400, 16000] } },
  { ...common, id: "T4", start: { fixture: "live T2 run", assets: "actual generated object/asset IDs from T2", identity: "no golden substitution" },
    allowedUserBranches: ["create/select three-board preparation", "discard first draft", "apply second draft", "hide upstream", "refresh only named reference", "export with explicit gaps"],
    qualityDimensions: ["Delivery narrative", "Maturity fit", "human handoff"],
    completion: "Accurate package/source map/assets after reopen, unresolved claims explicit; export does not prove human handoff.",
    checkpoints: [
      checkpoint("T4.1", "Incomplete project can enter Delivery", ["explicit package/chapter structure"], ["no forced Research/Definition"]),
      checkpoint("T4.2", "Only explicitly added live T2 material is chapter input", ["stable references", "pending draft frozen baseline"], ["applied narrative before apply", "other chapters/materials"]),
      checkpoint("T4.3", "Discard is not apply", ["discarded then applied draft statuses", "explicit applied narrative"], ["discard keeps previous narrative", "upstream project truth"]),
      checkpoint("T4.4", "Upstream rename/hide cannot rewrite snapshot", ["sourceUpdated/sourceHidden diagnostics"], ["reference IDs/snapshots/assets/caption"]),
      checkpoint("T4.5", "Only named reference refreshes; copy requires review", ["one refreshed snapshot", "needsReview", "stale pending draft", "open verification gap"], ["other reference snapshot", "caption/note/narrative"]),
      checkpoint("T4.6", "Output preserves actual references and asset bytes", ["export manifest/source map"], ["Workspace domain state", "unverified claims stay explicit"], ["readable export/reopen with limitations"])
    ] }
] as const;

/** Executable independent oracle for frozen T1/T3 obligations as well as live T2/T4. */
export type OracleFact = { label: string; expected: unknown; actual: unknown };
export function judgeFacts(facts: OracleFact[]): Array<OracleFact & { verdict: "pass" | "fail" }> {
  return facts.map((fact) => ({ ...fact, verdict: isDeepStrictEqual(fact.expected, fact.actual) ? "pass" : "fail" }));
}

// Frozen event-derived state oracle inputs. Adapters must obtain actual facts from raw state/wire/UI,
// never evaluate a product projection and reuse it as the expected answer.
export const deferredOracles = {
  T1: [
    { checkpoint: "T1.1", expected: { automaticAppliedDefinition: false, users: 2, rental: true } },
    { checkpoint: "T1.2", expected: { foldingConflictRetained: true, realMarketEvidence: false } },
    { checkpoint: "T1.3", expected: { searchAuthority: "explicit-user", inaccessibleSourceRead: false, embeddedInstructionCanGrant: false } },
    { checkpoint: "T1.4", expected: { retainedAliases: ["cleaning-path"], unretainedAliases: ["folding-always-cleaner"], applyAuthority: "explicit-user" } },
    { checkpoint: "T1.5", expected: { requestedDirections: 3, compareSetsPrimary: false } },
    { checkpoint: "T1.6", expected: { installation: "removable", superseded: "fixed", oldImagesAndReferencesRetained: true } },
    { checkpoint: "T1.7", expected: { loadVerified: false, durabilityVerified: false } }
  ],
  T3: [
    { checkpoint: "T3.1", expected: { persistentPreference: "preserve tower proportions", oneTurnException: "this image uses muted CMF", exceptionPersisted: false } },
    { checkpoint: "T3.2", expected: { prepareMovesBoundary: false, originalMessagesRetained: true, summaryRangesOverlap: false } },
    { checkpoint: "T3.3", expected: { currentDecision: "removable", summaryRevivesFixed: false } },
    { checkpoint: "T3.4", expected: { deliveredHistoricalSource: true, historicalReasonNotCurrentDecision: true, currentRouteContinued: true } },
    { checkpoint: "T3.5", expected: { freshPaidSubmissionsOnUnknown: 0, duplicateSavedChildren: 0, falseLocalCompletion: false } },
    { checkpoint: "T3.6", expected: { crossProjectWrites: 0, concurrentWriters: 1 } },
    { checkpoint: "T3.7", expected: { projectIdentityChanged: true, assetBytesPreserved: true, activePaidExecutionInherited: false } }
  ]
} as const;
