The full-viewport canvas ground — use it for any Morpho workspace view.

\`\`\`jsx
<CanvasSurface camera={{ x: -820, y: -120, scale: 0.8 }} onBackgroundClick={clearSelection}>
  <StageRegion left={120} top={120} width={620} height={520} colorKey="warmSand" title="资料与研究" />
  <MorphoObject left={180} top={220}>…</MorphoObject>
</CanvasSurface>
\`\`\`

Warm dots, never lines — Morpho reads as refined paper, not a blueprint. The canvas fills the viewport under all floating layers and is never resized by a panel.
