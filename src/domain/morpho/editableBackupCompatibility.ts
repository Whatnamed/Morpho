const RETIRED_DIRECTION_LINEAGE_ALIASES = {
  variant: "derivedFromDirection",
  split: "splitFromDirection",
  merge: "mergedFromDirection",
  revision: "supersedesDirection"
} as const;

export function canonicalizeEditableBackupWorkspaceCompatibility(
  workspaceSnapshot: Record<string, unknown>
): Record<string, unknown> {
  if (workspaceSnapshot.schemaVersion !== 17 || !isRecord(workspaceSnapshot.artifactProposals)) {
    return workspaceSnapshot;
  }

  let proposalsChanged = false;
  const artifactProposals = Object.fromEntries(
    Object.entries(workspaceSnapshot.artifactProposals).map(([proposalId, proposal]) => {
      if (!isRecord(proposal) || proposal.type !== "conceptDirection" || !Array.isArray(proposal.directions)) {
        return [proposalId, proposal];
      }

      let directionsChanged = false;
      const directions = proposal.directions.map((direction) => {
        if (!isRecord(direction)) return direction;
        const canonical = retiredDirectionLineageAlias(direction.lineageKind);
        if (!canonical) return direction;
        directionsChanged = true;
        return { ...direction, lineageKind: canonical };
      });

      if (!directionsChanged) return [proposalId, proposal];
      proposalsChanged = true;
      return [proposalId, { ...proposal, directions }];
    })
  );

  return proposalsChanged ? { ...workspaceSnapshot, artifactProposals } : workspaceSnapshot;
}

function retiredDirectionLineageAlias(
  value: unknown
): (typeof RETIRED_DIRECTION_LINEAGE_ALIASES)[keyof typeof RETIRED_DIRECTION_LINEAGE_ALIASES] | undefined {
  return typeof value === "string" && value in RETIRED_DIRECTION_LINEAGE_ALIASES
    ? RETIRED_DIRECTION_LINEAGE_ALIASES[value as keyof typeof RETIRED_DIRECTION_LINEAGE_ALIASES]
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
