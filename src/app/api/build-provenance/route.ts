import { NextResponse } from "next/server";

export const runtime = "nodejs";

export function GET() {
  if (process.env.MORPHO_E2E_BUILD_PROVENANCE !== "true") {
    return new NextResponse(null, { status: 404 });
  }
  return NextResponse.json(
    {
      sourceSha: process.env.MORPHO_BUILD_SOURCE_SHA ?? null,
      buildId: process.env.MORPHO_BUILD_ID ?? null,
      artifactSha256: process.env.MORPHO_BUILD_ARTIFACT_SHA256 ?? null,
      isDirty: process.env.MORPHO_BUILD_IS_DIRTY === "true"
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
