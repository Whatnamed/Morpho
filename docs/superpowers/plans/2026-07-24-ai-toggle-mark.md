# Morpho AI Toggle Mark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bottom-right AI toggle's literal `M` with a restrained, stateful Morpho wing mark.

**Architecture:** Keep the behavior local to `AiConversationPanel`: render a dependency-free inline SVG and expose the existing `isOpen` state through a modifier class. Keep all visual behavior in the existing global design-token stylesheet. Add one focused source-level regression test so the monogram cannot silently return.

**Tech Stack:** React 19, TypeScript, inline SVG, CSS, Vitest.

## Global Constraints

- Do not add a dependency or external asset.
- Preserve the existing button size, click behavior, accessible label, and focus behavior.
- Motion must explain hover/open state and must stop under `prefers-reduced-motion`.
- Do not change the queue pill, AI panel layout, status behavior, or unrelated icon styles.

---

### Task 1: Lock the toggle-mark contract

**Files:**
- Create: `src/features/workspace/components/AiConversationPanel.toggle.test.ts`

**Interfaces:**
- Consumes: source files `AiConversationPanel.tsx` and `src/app/globals.css`
- Produces: regression assertions for SVG structure, open-state class, removed monogram, and reduced-motion support

- [ ] **Step 1: Write the failing test**

Create a Vitest test that reads the component and stylesheet source and asserts:

```ts
expect(componentSource).toContain('className={`toggle-icon morpho-toggle-mark${isOpen ? " is-open" : ""}`}');
expect(componentSource).toContain('aria-label="Morpho AI"');
expect(componentSource).not.toMatch(/>\s*M\s*</);
expect(cssSource).toContain("@media (prefers-reduced-motion: reduce)");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/features/workspace/components/AiConversationPanel.toggle.test.ts`
Expected: FAIL because the component still renders the literal `M` and has no SVG/open-state contract.

### Task 2: Implement the Morpho mark

**Files:**
- Modify: `src/features/workspace/components/AiConversationPanel.tsx`
- Modify: `src/app/globals.css`
- Test: `src/features/workspace/components/AiConversationPanel.toggle.test.ts`

**Interfaces:**
- Consumes: existing `isOpen` prop and `.ai-toggle` interaction state
- Produces: inline SVG with `morpho-toggle-wing` paths and an `.is-open` modifier

- [ ] **Step 1: Replace the monogram with minimal SVG markup**

Render a 20×20 viewBox containing two mirrored curved paths and a center seam. Add `aria-label="Morpho AI"` to the decorative mark container while keeping the button's existing accessible label.

- [ ] **Step 2: Add restrained state motion**

Use transforms on left/right wing groups for hover and `.is-open`; keep transitions under 220 ms and use existing color tokens.

- [ ] **Step 3: Add reduced-motion handling**

Disable transforms and transitions for the mark under `@media (prefers-reduced-motion: reduce)`.

- [ ] **Step 4: Run focused test**

Run: `npm test -- src/features/workspace/components/AiConversationPanel.toggle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/workspace/components/AiConversationPanel.tsx src/app/globals.css src/features/workspace/components/AiConversationPanel.toggle.test.ts
git commit -m "feat(ui): replace AI toggle monogram with Morpho mark"
```

### Task 3: Verify through repository CI

**Files:**
- No source changes unless CI identifies a defect.

- [ ] **Step 1: Push branch and open a Draft PR**

Base: `main`
Head: `test/chat-web-ai-toggle`

- [ ] **Step 2: Read Quality CI results**

Expected jobs: lint, typecheck, test, build.

- [ ] **Step 3: Inspect the final diff**

Confirm only the design/plan docs, focused test, component markup, and focused CSS changed.
