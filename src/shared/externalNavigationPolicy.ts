export type SafeExternalNavigationUrl = Readonly<{
  url: string;
  hostname: string;
}>;

/** Pure client-safe navigation policy. It performs no DNS or network access. */
export function normalizeSafeExternalNavigationUrl(value: string): SafeExternalNavigationUrl | undefined {
  if (!value || value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return undefined;
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) {
    return undefined;
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname || isLocalHostname(hostname) || isNonPublicIpAddress(hostname)) return undefined;

  return { url: parsed.toString(), hostname };
}

function normalizeHostname(value: string): string {
  const unbracketed = value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value;
  return unbracketed.toLowerCase().replace(/\.+$/, "");
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname.endsWith(".localhost");
}

function isNonPublicIpAddress(hostname: string): boolean {
  const ipv4 = parseIpv4(hostname);
  if (ipv4) return isNonPublicIpv4(ipv4);

  const ipv6 = parseIpv6(hostname);
  if (!ipv6) return false;
  const first = ipv6[0]!;
  if (ipv6.every((part) => part === 0) || ipv6.slice(0, 7).every((part) => part === 0) && ipv6[7] === 1) {
    return true;
  }
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80) return true;

  const isIpv4Mapped = ipv6.slice(0, 5).every((part) => part === 0) && ipv6[5] === 0xffff;
  const isIpv4Compatible = ipv6.slice(0, 6).every((part) => part === 0);
  if (isIpv4Mapped || isIpv4Compatible) {
    return isNonPublicIpv4([
      ipv6[6]! >> 8,
      ipv6[6]! & 0xff,
      ipv6[7]! >> 8,
      ipv6[7]! & 0xff
    ]);
  }
  return false;
}

function parseIpv4(hostname: string): [number, number, number, number] | undefined {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return undefined;
  const values = parts.map(Number);
  if (values.some((part) => part > 255)) return undefined;
  return values as [number, number, number, number];
}

function isNonPublicIpv4([a, b]: [number, number, number, number]): boolean {
  return (
    a === 0 && b === 0 ||
    a === 10 ||
    a === 127 ||
    a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 ||
    a === 192 && b === 168
  );
}

function parseIpv6(hostname: string): number[] | undefined {
  if (!hostname.includes(":")) return undefined;
  const compression = hostname.indexOf("::");
  if (compression !== -1 && compression !== hostname.lastIndexOf("::")) return undefined;
  const [leftText, rightText = ""] = compression === -1 ? [hostname, ""] : hostname.split("::");
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return undefined;
  const missing = 8 - left.length - right.length;
  if (compression === -1 ? missing !== 0 : missing < 1) return undefined;
  return [...left.map(hex), ...new Array(missing).fill(0), ...right.map(hex)];
}

function hex(value: string): number {
  return Number.parseInt(value, 16);
}
