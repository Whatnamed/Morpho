import { describe, expect, it } from "vitest";

import { parseProjectIdFromPathname } from "./crashRecoveryTarget";

describe("parseProjectIdFromPathname", () => {
  it("reads the project id a workspace route was rendering", () => {
    expect(parseProjectIdFromPathname("/projects/project-morpho-case-study")).toBe("project-morpho-case-study");
  });

  it("decodes an encoded project id", () => {
    expect(parseProjectIdFromPathname("/projects/project-%E6%A1%88%E4%BE%8B")).toBe("project-案例");
  });

  it("stops at the end of the project segment", () => {
    expect(parseProjectIdFromPathname("/projects/project-a/anything")).toBe("project-a");
    expect(parseProjectIdFromPathname("/projects/project-a?open=1")).toBe("project-a");
    expect(parseProjectIdFromPathname("/projects/project-a#detail")).toBe("project-a");
  });

  it("offers no export target outside a project route", () => {
    expect(parseProjectIdFromPathname("/")).toBeUndefined();
    expect(parseProjectIdFromPathname("/login")).toBeUndefined();
    expect(parseProjectIdFromPathname("/projects")).toBeUndefined();
    expect(parseProjectIdFromPathname("/projects/")).toBeUndefined();
  });

  it("refuses a segment it cannot decode rather than guessing a project", () => {
    expect(parseProjectIdFromPathname("/projects/%E0%A4%A")).toBeUndefined();
  });
});
