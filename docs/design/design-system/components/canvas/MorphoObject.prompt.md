Wraps every object placed on \`CanvasSurface\` and carries its position and state.

\`\`\`jsx
<MorphoObject left={1400} top={300} width={320} selected defaultReference ariaLabel="柔光轨道 v2">
  <ImageObject role="主图" title="柔光轨道 v2" variant="rail" width={320} height={214} />
</MorphoObject>
\`\`\`

Selection is a ring plus a halo with no lift. Eliminated material is quieted, never removed. Only one object at a time may carry \`defaultReference\`.
