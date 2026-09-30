// Created only at an object creation boundary. Never derive this from an ID,
// timestamp, content, or current state while normalizing historical data.
export function createObjectIncarnationId(): string {
  return crypto.randomUUID();
}
