export type MiMoFailure =
  | {
      status: number;
    }
  | {
      kind: "network";
    };

export type MiMoFailureKind = "authFailed" | "rateLimited" | "temporaryFailure" | "requestInvalid";

export type MiMoKeyPool = {
  current: () => string;
  nextAfterFailure: (failure: MiMoFailure) => { status: "retry"; apiKey: string } | { status: "stop"; reason: MiMoFailureKind };
};

export function createMiMoKeyPool(apiKeys: readonly string[]): MiMoKeyPool {
  const keys = apiKeys.filter(Boolean);
  let index = 0;
  let didRetry = false;

  return {
    current() {
      return keys[index] ?? "";
    },
    nextAfterFailure(failure) {
      const reason = classifyMiMoFailure(failure);
      if ((reason === "authFailed" || reason === "temporaryFailure") && !didRetry && index + 1 < keys.length) {
        didRetry = true;
        index += 1;
        return { status: "retry", apiKey: keys[index] };
      }

      return { status: "stop", reason };
    }
  };
}

export function classifyMiMoFailure(failure: MiMoFailure): MiMoFailureKind {
  if ("kind" in failure) {
    return "temporaryFailure";
  }

  if (failure.status === 401 || failure.status === 403) {
    return "authFailed";
  }

  if (failure.status === 429) {
    return "rateLimited";
  }

  if (failure.status >= 500) {
    return "temporaryFailure";
  }

  return "requestInvalid";
}
