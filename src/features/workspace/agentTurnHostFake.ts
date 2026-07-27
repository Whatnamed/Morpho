import type { Dispatch, SetStateAction } from "react";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import {
  commitWorkspaceStateNow,
  type WorkspaceCommitTransform
} from "./workspaceCommitBoundary";

export type MutableSlot<T> = {
  get: () => T;
  set: (value: T) => void;
};

export type AgentTurnHostFakeEvent = {
  sequence: number;
  kind: "workspaceCommit" | "ui";
  name: string;
  value?: unknown;
};

export type AgentFetchRoute = (request: Request) => Response | Promise<Response>;

export type AgentTurnHostFake = {
  commitWorkspace: <T>(transform: WorkspaceCommitTransform<T>) => T;
  readWorkspace: () => MorphoWorkspace;
  fetch: typeof fetch;
  setFetchRoute: (path: string, route: AgentFetchRoute) => void;
  recordUiCall: (name: string, value?: unknown) => void;
  createUiRecorder: <Args extends unknown[]>(name: string) => (...args: Args) => void;
  abortSlot: MutableSlot<AbortController | null>;
  streamFlushSlot: MutableSlot<(() => void) | null>;
  now: () => number;
  randomSuffix: () => string;
  getWorkspace: () => MorphoWorkspace;
  getEvents: () => AgentTurnHostFakeEvent[];
};

export function createAgentTurnHostFake(options: {
  workspace: MorphoWorkspace;
  routes?: Record<string, AgentFetchRoute>;
  now?: number;
  randomSuffix?: string;
}): AgentTurnHostFake {
  let workspace = options.workspace;
  let sequence = 0;
  let abortController: AbortController | null = null;
  let streamFlush: (() => void) | null = null;
  const events: AgentTurnHostFakeEvent[] = [];
  const routes = new Map(Object.entries(options.routes ?? {}));

  const record = (event: Omit<AgentTurnHostFakeEvent, "sequence">) => {
    events.push({ ...event, sequence: ++sequence });
  };
  const setWorkspace: Dispatch<SetStateAction<MorphoWorkspace>> = (action) => {
    workspace = typeof action === "function" ? action(workspace) : action;
  };
  const commitWorkspace = <T,>(transform: WorkspaceCommitTransform<T>): T =>
    commitWorkspaceStateNow(
      setWorkspace,
      (current) => {
        const result = transform(current);
        record({ kind: "workspaceCommit", name: "commit" });
        return result;
      },
      (callback) => callback()
    );

  const fakeFetch: typeof fetch = async (input, init) => {
    const request = createRequest(input, init);
    const route = routes.get(new URL(request.url).pathname);
    return route ? route(request) : new Response("Not found", { status: 404 });
  };

  return {
    commitWorkspace,
    readWorkspace: () =>
      commitWorkspace((current) => ({
        workspace: current,
        value: current
      })),
    fetch: fakeFetch,
    setFetchRoute: (path, route) => routes.set(path, route),
    recordUiCall: (name, value) => record({ kind: "ui", name, value }),
    createUiRecorder:
      <Args extends unknown[]>(name: string) =>
      (...args: Args) =>
        record({ kind: "ui", name, value: args }),
    abortSlot: createMutableSlot(
      () => abortController,
      (value) => {
        abortController = value;
      }
    ),
    streamFlushSlot: createMutableSlot(
      () => streamFlush,
      (value) => {
        streamFlush = value;
      }
    ),
    now: () => options.now ?? 1_700_000_000_000,
    randomSuffix: () => options.randomSuffix ?? "aaaaaa",
    getWorkspace: () => workspace,
    getEvents: () => [...events]
  };
}

function createMutableSlot<T>(get: () => T, set: (value: T) => void): MutableSlot<T> {
  return { get, set };
}

function createRequest(input: Parameters<typeof fetch>[0], init?: RequestInit): Request {
  if (typeof input === "string") {
    return new Request(new URL(input, "http://morpho.test"), init);
  }
  return new Request(input, init);
}
