The 46px rail, vertically centred on the left edge — a creative-tool accessory, not application navigation.

\`\`\`jsx
<LeftRail>
  <RailButton create icon={<Icon name="plus" />} label="添加到画布" />
  <RailButton active icon={<Icon name="map" />} label="项目地图" />
  <RailButton icon={<Icon name="boxes" />} label="资产" />
  <RailButton icon={<Icon name="eye-off" />} label="已隐藏内容" />
  <RailButton icon={<Icon name="notebook-text" />} label="项目记录" />
  <RailSeparator />
  <RailButton icon={<Icon name="search" />} label="项目内搜索" />
</LeftRail>
\`\`\`

Six controls, in this order. The active entry is the one place in the workspace that still uses the umber wash — drawer rows and filters use blue-gray. No avatar block, no version badge, no step counter.
