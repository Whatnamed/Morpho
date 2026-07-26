The two frosted clusters that replace a top navigation bar.

\`\`\`jsx
<FloatingCluster side="left">
  <Wordmark />
  <ProjectName name="夜航 / Nightrail" caret={<Icon name="chevron-down" size={13} />} onClick={openMenu} />
</FloatingCluster>
<FloatingCluster side="right">
  <ToolbarGroup label="视图">
    <Button variant="icon" icon={<Icon name="search" />} title="搜索" />
    <Button variant="icon" icon={<Icon name="square-dashed-mouse-pointer" />} title="回到项目概览" />
  </ToolbarGroup>
  <ClusterDivider />
  <ToolbarGroup label="资料与交付">
    <Button icon={<Icon name="import" size={14} />}>导入</Button>
    <Button icon={<Icon name="package-open" size={14} />}>交付准备</Button>
    <Button icon={<Icon name="archive" size={14} />}>归档</Button>
  </ToolbarGroup>
  <ClusterDivider />
  <Button variant="brand" icon={<Icon name="download" size={14} />}>输出</Button>
</FloatingCluster>
\`\`\`

Both clusters use the shared glass recipe. Never widen them into a bar, and never show task counts, stage completion, model names or team presence. The wordmark is set type — Morpho has no logotype asset.
