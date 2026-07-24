import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const componentSource = readFileSync(new URL("./AiConversationPanel.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../../../app/globals.css", import.meta.url), "utf8");

describe("Morpho AI toggle mark", () => {
  it("uses a stateful SVG mark instead of the M monogram", () => {
    expect(componentSource).toContain(
      'className={`toggle-icon morpho-toggle-mark${isOpen ? " is-open" : ""}`}'
    );
    expect(componentSource).toContain('aria-label="Morpho AI"');
    expect(componentSource).toContain('className="morpho-toggle-wing is-left"');
    expect(componentSource).toContain('className="morpho-toggle-wing is-right"');
    expect(componentSource).not.toMatch(
      /<div className="toggle-icon morpho-toggle-mark" aria-hidden="true">\s*M\s*<\/div>/
    );
  });

  it("keeps the mark static for reduced-motion users", () => {
    expect(cssSource).toContain("@media (prefers-reduced-motion: reduce)");
    expect(cssSource).toContain(".morpho-toggle-wing");
  });
});
