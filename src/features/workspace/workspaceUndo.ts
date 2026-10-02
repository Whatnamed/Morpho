// Normal manual history owns one operation's delta. Snapshot history is retained
// only as an isolated legacy safety helper; no product controller restores it.
export * from "./workspaceManualHistory";
