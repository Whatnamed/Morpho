# 内置案例更新

部署内置案例来自真实 Morpho 可编辑备份，而不是手写 `seed.ts` 数据。当前稳定案例项目 ID 是 `project-morpho-case-study`，案例版本由生成的诊断文件记录。

## 导入

1. 在 Morpho 工作台打开目标项目，点击 `归档`。
2. 在 `可编辑项目备份` 中勾选 `附带完整聊天记录`，再点击 `导出备份`。
3. 将导出的 ZIP 放入仓库 `temp/`，例如 `temp/current-case-backup.zip`。
4. 运行：

```bash
npm.cmd run case-study:import -- temp/current-case-backup.zip
```

脚本只接受带 `bundle.json` 和 `morpho-editable-project-backup` manifest 的可编辑备份。它复用备份结构校验、workspace 解析和资产完整性检查；缺失二进制、大小不符、无效关系、临时 reference-only URL 或凭据样式内容会阻止生成。

## 生成结果

```text
src/domain/morpho/caseStudy/currentCaseWorkspace.generated.json
src/domain/morpho/caseStudy/currentCaseAssets.generated.json
src/domain/morpho/caseStudy/currentCaseDiagnostics.generated.json
public/case-study/current/assets/
```

这些文件由脚本生成，不手工编辑。资源以内容 hash 命名并去重；workspace 只保存运行时 storage key，不包含 Base64 二进制或本机路径。

## 敏感信息

导入拒绝 API key、Bearer credential、JWT、Authorization/Cookie 类字段和不安全 reference-only URL。它会清理本地路径、`blob:`、`localhost`、临时签名 URL 和邮箱。生成的诊断只记录清理类别和数量，不记录原始敏感值。

## 浏览器安装与迁移

全新浏览器首次打开时只创建当前案例项目。页面首次加载会从 `public/case-study/current/assets/` 读取资源、校验大小和 hash，并写入现有 IndexedDB BlobStore；已正确安装的资源会跳过，缺失或损坏资源会补写。

已有项目（包括早期 Nightrail 和已安装的同名案例）按用户项目保留。更新仓库模板只影响新安装。目录漏记已写入的项目时，重新进入首页会补回卡片。

若图片或文件缺失，先检查浏览器控制台是否有 `Morpho current case study assets could not be installed.`，再确认 `public/case-study/current/assets/` 与 `currentCaseAssets.generated.json` 都来自同一次导入。
