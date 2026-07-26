The 340px drawer that opens beside the rail, bottom-aligned with the AI panel.

\`\`\`jsx
<SideDrawer open={drawer === 'map'} title="项目地图" meta={<Button variant="icon" icon={<Icon name="x" />} title="关闭" />}>
  <MapItem active>方向与视觉</MapItem>
  <MapItem>交付整理</MapItem>
  <DrawerGroupTitle>资产</DrawerGroupTitle>
  <AssetRow mark="图" title="柔光轨道 v2" status={<Chip kind="status">已用于交付</Chip>} meta={['主视觉', '视觉迭代 2']} />
</SideDrawer>
\`\`\`

Closes on: the active rail entry, a click on empty canvas, Esc, or picking an item. Clicking the canvas must never close the AI panel. Drawer navigation only moves the canvas — it does not switch pages or threads.
