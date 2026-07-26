Renders a Lucide glyph — Morpho uses \`lucide-react\` throughout, so this is the only sanctioned way to draw an icon.

\`\`\`jsx
<Icon name="search" size={16} />
<Icon name="chevron-down" size={13} />
\`\`\`

Requires the Lucide UMD script on the page. \`MORPHO_ICONS\` lists the exact glyphs each surface imports — prefer one of those before reaching for a new glyph, and never hand-draw an SVG or substitute emoji.
