type ExternalRequestIdentity = Readonly<{
  serverTurnId: string;
  requestId: string;
  stepSequence: number;
}>;

const activeExternalRequests = new Map<string, AbortController>();

export function registerAgentTurnExternalRequest(
  identity: ExternalRequestIdentity,
  controller: AbortController
): () => void {
  const key = externalRequestKey(identity);
  activeExternalRequests.set(key, controller);
  return () => {
    if (activeExternalRequests.get(key) === controller) {
      activeExternalRequests.delete(key);
    }
  };
}

export function requestAgentTurnExternalCancellation(
  identity: ExternalRequestIdentity
): boolean {
  const controller = activeExternalRequests.get(externalRequestKey(identity));
  if (!controller || controller.signal.aborted) return false;
  controller.abort(new DOMException("A+ external cancellation requested.", "AbortError"));
  return true;
}

function externalRequestKey(identity: ExternalRequestIdentity): string {
  return `${identity.serverTurnId}:${identity.requestId}:${identity.stepSequence}`;
}
