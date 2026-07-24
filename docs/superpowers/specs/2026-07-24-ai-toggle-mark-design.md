# Morpho AI Toggle Mark Design

## Goal

Replace the bottom-right AI panel toggle's literal `M` monogram with a restrained, product-specific Morpho mark that communicates opening and unfolding without competing with the canvas.

## Visual direction

Use a small inline SVG composed of two mirrored curved wings around a quiet center seam. At rest the wings sit nearly closed. Hover lifts and opens them slightly; when the AI panel is open they separate a little further. Motion must explain the panel state rather than loop decoratively.

## Interaction and accessibility

- Preserve the existing 42 px circular button, accessible label, focus behavior, and click target.
- Keep the mark monochrome and token-driven so it remains consistent with the warm light design system.
- Respect `prefers-reduced-motion` by disabling transforms and transition-driven movement.
- Do not add a dependency, asset file, status indicator, or continuous animation.

## Scope

Modify only the AI toggle markup, its focused CSS, and the existing server-rendered component test. Do not change the queue pill, panel layout, status behavior, or unrelated icon treatments.

## Acceptance

- Rendered markup contains a named Morpho SVG mark and no literal `M` monogram.
- Closed, hover, and open states have restrained state-specific transforms.
- Reduced-motion users receive a static mark.
- Existing Quality CI remains the verification authority for lint, typecheck, tests, and build.
