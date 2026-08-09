const REDIRECT_BASE = "https://morpho.invalid";
const MAX_REDIRECT_LENGTH = 4_096;
const MAX_DECODE_PASSES = 8;
const UNSAFE_PATH_CHARACTER = /[\\\u0000-\u001f\u007f-\u009f]/u;

export function sanitizeNextPath(value: string | undefined): string {
  if (!value || value.length > MAX_REDIRECT_LENGTH) return "/";

  let inspected = value;
  let fullyDecoded = false;
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    if (!isSafeLocalUrlCandidate(inspected)) return "/";

    let decoded: string;
    try {
      decoded = decodeURIComponent(inspected);
    } catch {
      return "/";
    }
    if (decoded === inspected) {
      fullyDecoded = true;
      break;
    }
    inspected = decoded;
  }
  if (!fullyDecoded) return "/";

  let parsed: URL;
  try {
    parsed = new URL(value, REDIRECT_BASE);
  } catch {
    return "/";
  }
  if (parsed.origin !== REDIRECT_BASE || parsed.pathname === "/login" || parsed.pathname === "/login/") {
    return "/";
  }

  const safePath = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  return isLocalPathShape(safePath) ? safePath : "/";
}

function isLocalPathShape(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !UNSAFE_PATH_CHARACTER.test(value);
}

function isSafeLocalUrlCandidate(value: string): boolean {
  if (!isLocalPathShape(value)) return false;
  try {
    const parsed = new URL(value, REDIRECT_BASE);
    return parsed.origin === REDIRECT_BASE && isLocalPathShape(`${parsed.pathname}${parsed.search}${parsed.hash}`);
  } catch {
    return false;
  }
}
