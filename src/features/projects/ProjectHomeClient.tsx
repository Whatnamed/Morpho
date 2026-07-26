"use client";

import {
  Archive,
  ArrowRight,
  BookOpen,
  ChevronDown,
  CircleHelp,
  LayoutGrid,
  LogOut,
  Plus,
  Search,
  Settings,
  Sparkles,
  Upload
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import type { MorphoWorkspace } from "@/domain/morpho/types";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import {
  initializeLocalProjectCatalog,
  loadProjectWorkspace,
  saveProjectWorkspace,
  upsertProjectSummary,
  type LocalProjectCatalog,
  type LocalProjectSummary
} from "@/infrastructure/persistence/localProjectStore";
import { ensureCurrentCaseStudyAssets } from "@/infrastructure/assets/currentCaseStudyAssetInstaller";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import { createBrowserSupabaseClient } from "@/infrastructure/supabase/browser";
import type { AccountAccessSnapshot } from "@/server/auth/accountAccess";
import {
  inspectEditableProjectBackupBundle,
  restoreEditableProjectBackupBundle,
  type InspectedEditableProjectBackupBundle
} from "@/features/archive/projectBundleClient";
import { useWorkspaceAssetUrls } from "@/features/workspace/useWorkspaceAssetUrls";
import { getProjectPreviewAssets, ProjectCanvasPreview } from "./ProjectCanvasPreview";

type ProjectHomeClientProps = {
  account: AccountAccessSnapshot | null;
  accessError?: string;
  authRequired: boolean;
};

type RestoreMessage = {
  tone: "neutral" | "success" | "warning" | "error";
  text: string;
};

type ProjectSortKey = "opened" | "updated" | "title";

/** Display-only fallback: the blank-workspace default subtitle reads poorly when repeated on every card. */
const BLANK_PROJECT_SUBTITLE = "从一句话、图片、文件或链接开始。";

export function ProjectHomeClient({ account, accessError, authRequired }: ProjectHomeClientProps) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<LocalProjectCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<ProjectSortKey>("opened");
  const [accountOpen, setAccountOpen] = useState(false);
  const [projectWorkspaces, setProjectWorkspaces] = useState<Record<string, MorphoWorkspace>>({});
  const [isSigningOut, startSignOutTransition] = useTransition();
  const [inspectedBackup, setInspectedBackup] = useState<InspectedEditableProjectBackupBundle | null>(null);
  const [restoreBusyLabel, setRestoreBusyLabel] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<RestoreMessage | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let isCancelled = false;
    queueMicrotask(async () => {
      if (isCancelled) return;

      const result = initializeLocalProjectCatalog(window.localStorage);
      if (result.status === "failed") {
        setCatalogError(result.reason);
        return;
      }

      if (isCancelled) return;
      setCatalog(result.catalog);
      void ensureCurrentCaseStudyAssets();
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!catalog) {
      return;
    }

    let isCancelled = false;
    queueMicrotask(() => {
      const next: Record<string, MorphoWorkspace> = {};
      for (const project of catalog.projects) {
        const loaded = loadProjectWorkspace(window.localStorage, project.id);
        if (loaded.status === "ok") {
          next[project.id] = loaded.workspace;
        }
      }
      if (!isCancelled) {
        setProjectWorkspaces(next);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [catalog]);

  const projects = useMemo(() => {
    const source = catalog?.projects ?? [];
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = normalizedQuery
      ? source.filter((project) => [project.title, project.subtitle].join(" ").toLowerCase().includes(normalizedQuery))
      : source;
    return sortProjects(filtered, sortKey);
  }, [catalog?.projects, query, sortKey]);

  const isSearching = query.trim().length > 0;
  const recentProject = catalog?.projects.find((project) => project.id === catalog.recentProjectId) ?? catalog?.projects[0];
  const gridProjects = isSearching ? projects : projects.filter((project) => project.id !== recentProject?.id);
  const previewAssets = useMemo(() => getProjectPreviewAssets(projectWorkspaces), [projectWorkspaces]);
  const previewAssetUrls = useWorkspaceAssetUrls(previewAssets);
  // Local-first: without required auth the workspace entry stays usable; with
  // required auth the closed-test gate keeps its existing behavior.
  const canUseProjects = !authRequired || account?.accessStatus === "active";
  const localOnly = !authRequired && !account;
  const workspaceName = localOnly ? "本地工作区" : `${getAccountDisplayName(account?.email)} 的工作区`;

  const openProject = (projectId: string) => {
    router.push(`/projects/${encodeURIComponent(projectId)}`);
  };

  const createProject = () => {
    if (!canUseProjects) return;

    const projectId = createProjectId();
    const workspace = createBlankWorkspace(projectId);
    saveProjectWorkspace(window.localStorage, workspace);
    const nextCatalog = upsertProjectSummary(window.localStorage, workspace);
    setCatalog(nextCatalog);
    openProject(projectId);
  };

  const inspectBackup = async (file: File) => {
    setRestoreBusyLabel("正在读取备份包…");
    setRestoreMessage(null);
    setInspectedBackup(null);
    try {
      const result = await inspectEditableProjectBackupBundle(file);
      if (result.status !== "ok") {
        setRestoreMessage({ tone: "error", text: result.reason });
        return;
      }
      setInspectedBackup(result.backup);
      setRestoreMessage(
        result.preview.warningCount > 0
          ? { tone: "warning", text: `备份已读取，有 ${result.preview.warningCount} 条 warning。确认后将恢复为新项目副本。` }
          : null
      );
    } catch {
      setRestoreMessage({ tone: "error", text: "无法读取备份包。文件可能损坏，或不是 Morpho 可编辑备份。" });
    } finally {
      setRestoreBusyLabel(null);
    }
  };

  const confirmRestore = async () => {
    if (!inspectedBackup) return;

    setRestoreBusyLabel("正在恢复为新项目副本…");
    setRestoreMessage(null);
    try {
      const result = await restoreEditableProjectBackupBundle(inspectedBackup, {
        blobStore: indexedDbBlobStore,
        storage: window.localStorage
      });
      if (result.status !== "ok") {
        setRestoreMessage({ tone: "error", text: result.reason });
        return;
      }
      setInspectedBackup(null);
      openProject(result.projectId);
    } catch {
      setRestoreMessage({ tone: "error", text: "恢复备份失败，请重新选择备份包后再试。" });
    } finally {
      setRestoreBusyLabel(null);
    }
  };

  const signOut = () => {
    startSignOutTransition(async () => {
      try {
        const supabase = createBrowserSupabaseClient();
        await supabase.auth.signOut();
      } finally {
        router.push("/login");
        router.refresh();
      }
    });
  };

  return (
    <main className="phome">
      <aside className="phome-side" aria-label="工作区导航">
        <div className="phome-side-brand">
          <span className="phome-brand-mark">M</span>
          <span className="phome-brand-copy">
            <strong>Morpho</strong>
            <small>{workspaceName}</small>
          </span>
        </div>

        <nav className="phome-side-nav" aria-label="工作区功能">
          <span className="phome-side-label">工作区</span>
          <button className="phome-side-item is-active" type="button" aria-current="page">
            <LayoutGrid size={15} />
            全部项目
          </button>
          <button className="phome-side-item is-planned" type="button" disabled>
            <BookOpen size={15} />
            灵感资料
            <small className="phome-side-tag">规划中</small>
          </button>
          <button className="phome-side-item is-planned" type="button" disabled>
            <Sparkles size={15} />
            个人草稿
            <small className="phome-side-tag">规划中</small>
          </button>
          <button className="phome-side-item is-planned" type="button" disabled>
            <Archive size={15} />
            已归档项目
            <small className="phome-side-tag">规划中</small>
          </button>
        </nav>

        <div className="phome-side-foot">
          <nav className="phome-side-support" aria-label="通用功能">
            <button className="phome-side-item is-planned" type="button" disabled>
              <Settings size={15} />
              设置
              <small className="phome-side-tag">规划中</small>
            </button>
            <button className="phome-side-item is-planned" type="button" disabled>
              <CircleHelp size={15} />
              帮助
              <small className="phome-side-tag">规划中</small>
            </button>
          </nav>
          <input
            ref={restoreInputRef}
            className="sr-only"
            type="file"
            accept=".zip,application/zip"
            tabIndex={-1}
            onChange={(event) => {
              const selected = event.currentTarget.files?.[0];
              if (selected) {
                void inspectBackup(selected);
              }
              event.currentTarget.value = "";
            }}
          />
          <button
            className="phome-side-item phome-side-restore"
            type="button"
            disabled={Boolean(restoreBusyLabel) || !canUseProjects}
            onClick={() => restoreInputRef.current?.click()}
          >
            <Upload size={15} />
            恢复项目备份
          </button>

          {localOnly ? (
            <span className="phome-local-chip" title={accessError}>
              本地模式 · 未连接账户
            </span>
          ) : (
            <div className="account-menu-wrap phome-side-account">
              <button
                className="phome-account-entry"
                type="button"
                aria-label="账户菜单"
                aria-expanded={accountOpen}
                onClick={() => setAccountOpen((current) => !current)}
              >
                <span className="phome-account-avatar">{getAccountInitial(account?.email)}</span>
                <span className="phome-account-copy">
                  <strong>{getAccountDisplayName(account?.email)}</strong>
                  <small>{account?.email ?? "账户信息"}</small>
                </span>
                <ChevronDown size={14} />
              </button>
              {accountOpen ? (
                <AccountMenu account={account} accessError={accessError} isSigningOut={isSigningOut} onSignOut={signOut} />
              ) : null}
            </div>
          )}
        </div>
      </aside>

      <section className="phome-main">
        <div className="phome-main-column">
          <header className="phome-topbar">
            <div className="phome-topbar-title">
              <span className="phome-kicker">项目工作区</span>
              <h1>项目</h1>
            </div>
            <div className="phome-controls">
              <label className="phome-search" aria-label="搜索项目">
                <Search size={15} />
                <input
                  value={query}
                  placeholder="搜索项目名称或课题"
                  onChange={(event) => setQuery(event.currentTarget.value)}
                  disabled={!canUseProjects}
                />
              </label>
              <label className="phome-sort" aria-label="排序方式">
                <select
                  value={sortKey}
                  onChange={(event) => setSortKey(event.currentTarget.value as ProjectSortKey)}
                  disabled={!canUseProjects}
                >
                  <option value="opened">按最近打开</option>
                  <option value="updated">按最近更新</option>
                  <option value="title">按名称</option>
                </select>
              </label>
              <button className="brand-button phome-create" type="button" onClick={createProject} disabled={!canUseProjects}>
                <Plus size={15} />
                新建项目
              </button>
            </div>
          </header>

          {authRequired && accessError ? (
            <AccessNotice tone="error" title="账户状态暂不可用" body={accessError} />
          ) : null}
          {!accessError && account?.accessStatus === "pending" ? (
            <AccessNotice tone="neutral" title="等待测试资格开启" body="当前账户已登录，但尚未获得 Morpho 测试资格。" />
          ) : null}
          {!accessError && account?.accessStatus === "blocked" ? (
            <AccessNotice tone="error" title="当前测试资格不可用" body="如需继续使用，请联系项目管理员。" />
          ) : null}
          {catalogError ? (
            <section className="home-warning">
              <strong>本地项目目录暂不可用</strong>
              <p>{catalogError} 原始数据没有被覆盖。</p>
            </section>
          ) : null}

          {restoreBusyLabel ? <p className="phome-restore-status" role="status">{restoreBusyLabel}</p> : null}
          {restoreMessage ? <p className={`phome-restore-message ${restoreMessage.tone}`}>{restoreMessage.text}</p> : null}
          {inspectedBackup ? (
            <div className="phome-restore-card">
              <div>
                <strong>{inspectedBackup.preview.sourceProjectTitle}</strong>
                <p>
                  导出于 {inspectedBackup.preview.createdAt} ·{" "}
                  {inspectedBackup.preview.chat === "full" ? "含完整聊天" : "不含聊天"} · 资产{" "}
                  {inspectedBackup.preview.assets.embedded}/{inspectedBackup.preview.assets.total}
                  {inspectedBackup.preview.assets.missing > 0 ? ` · 缺失 ${inspectedBackup.preview.assets.missing}` : ""}
                </p>
                <p className="phome-restore-note">将恢复为新的独立项目副本，不会覆盖现有项目。</p>
              </div>
              <div className="phome-restore-actions">
                <button
                  className="plain-button"
                  type="button"
                  disabled={Boolean(restoreBusyLabel)}
                  onClick={() => {
                    setInspectedBackup(null);
                    setRestoreMessage(null);
                  }}
                >
                  取消
                </button>
                <button className="brand-button" type="button" disabled={Boolean(restoreBusyLabel)} onClick={confirmRestore}>
                  恢复为新项目
                </button>
              </div>
            </div>
          ) : null}

          {canUseProjects ? (
            <>
              {!isSearching && recentProject ? (
                <section className="phome-hero" aria-label="继续最近项目">
                  <div className="phome-section-head">
                    <span className="phome-section-label">继续最近项目</span>
                    <i className="phome-rule" aria-hidden="true" />
                  </div>
                  <button className="phome-hero-card" type="button" onClick={() => openProject(recentProject.id)}>
                    <div className="phome-hero-copy">
                      <h2>{recentProject.title}</h2>
                      <p>{displayProjectSubtitle(recentProject, "从一句想法、一张图或一个文件开始这个项目。")}</p>
                      <div className="phome-hero-meta">
                        <span>{focusLabel(recentProject.currentFocus?.area)}</span>
                        <span>上次打开 · {formatDate(recentProject.lastOpenedAt)}</span>
                      </div>
                      <HeroSignals
                        project={recentProject}
                        workspace={projectWorkspaces[recentProject.id]}
                        subtitleText={displayProjectSubtitle(recentProject, "从一句想法、一张图或一个文件开始这个项目。")}
                      />
                      <span className="phome-hero-enter">
                        进入工作台
                        <ArrowRight size={15} />
                      </span>
                    </div>
                    <ProjectCanvasPreview
                      workspace={projectWorkspaces[recentProject.id]}
                      assetUrls={previewAssetUrls}
                      className="phome-hero-cover"
                    />
                  </button>
                </section>
              ) : null}

              <section className="phome-shelf" aria-label={isSearching ? "搜索结果" : "全部项目"}>
                <div className="phome-section-head">
                  <span className="phome-section-label">
                    {isSearching ? `与“${query.trim()}”相关的项目` : "全部项目"}
                  </span>
                  <i className="phome-rule" aria-hidden="true" />
                  <span className="phome-shelf-count">
                    {isSearching ? `${projects.length} 个结果` : `共 ${projects.length} 个项目`}
                  </span>
                </div>
                <div className="phome-grid">
                  {gridProjects.map((project) => (
                    <ProjectCard
                      project={project}
                      workspace={projectWorkspaces[project.id]}
                      assetUrls={previewAssetUrls}
                      key={project.id}
                      onOpen={() => openProject(project.id)}
                    />
                  ))}
                  {!isSearching ? <CreateProjectCard onCreate={createProject} disabled={!canUseProjects} /> : null}
                  {isSearching && projects.length === 0 ? (
                    <div className="phome-blank">
                      <strong>没有匹配的项目</strong>
                      <p>换一个关键词，或直接新建项目。</p>
                    </div>
                  ) : null}
                  {!isSearching && projects.length === 0 ? (
                    <div className="phome-blank">
                      <strong>这里还没有项目</strong>
                      <p>新建一个项目，然后把想法、参考图或课程文件直接放进画布。</p>
                    </div>
                  ) : null}
                </div>
              </section>
            </>
          ) : null}

          <footer className="phome-foot">
            项目与素材保存在当前浏览器中，不会自动云同步；换设备继续工作时，请使用可恢复备份。
          </footer>
        </div>
      </section>
    </main>
  );
}

function HeroSignals({
  project,
  workspace,
  subtitleText
}: {
  project: LocalProjectSummary;
  workspace?: MorphoWorkspace;
  subtitleText: string;
}) {
  const activeObjects = workspace
    ? Object.values(workspace.objects).filter((object) => object.visibility === "active")
    : [];
  const imageCount = activeObjects.filter((object) => object.type === "image").length;
  const note = project.continuityNote && project.continuityNote !== subtitleText ? project.continuityNote : null;

  return (
    <div className="phome-hero-signals">
      <span className="phome-hero-figure">
        <strong>{activeObjects.length}</strong>
        <small>画布对象</small>
      </span>
      <span className="phome-hero-figure">
        <strong>{imageCount}</strong>
        <small>视觉素材</small>
      </span>
      {note ? <span className="phome-hero-note">{note}</span> : null}
    </div>
  );
}

function AccountMenu({
  account,
  accessError,
  isSigningOut,
  onSignOut
}: {
  account: AccountAccessSnapshot | null;
  accessError?: string;
  isSigningOut: boolean;
  onSignOut: () => void;
}) {
  return (
    <div className="account-popover" role="menu">
      <div>
        <span className="account-label">当前邮箱</span>
        <strong>{account?.email ?? "无法读取"}</strong>
      </div>
      <div className="account-status-grid">
        <span>测试状态</span>
        <strong>{accessError ? "暂不可用" : statusLabel(account?.accessStatus)}</strong>
        <span>今日文本 AI</span>
        <strong>{account ? `${account.textRequestCount}/${account.dailyTextLimit}` : "—"}</strong>
        <span>今日生图</span>
        <strong>{account ? `${account.imageRequestCount}/${account.dailyImageLimit}` : "—"}</strong>
      </div>
      <button className="plain-button account-signout" type="button" onClick={onSignOut} disabled={isSigningOut}>
        <LogOut size={14} />
        退出登录
      </button>
    </div>
  );
}

function AccessNotice({ tone, title, body }: { tone: "neutral" | "error"; title: string; body: string }) {
  return (
    <section className={`access-notice ${tone}`}>
      <strong>{title}</strong>
      <p>{body}</p>
    </section>
  );
}

function ProjectCard({
  project,
  workspace,
  assetUrls,
  onOpen
}: {
  project: LocalProjectSummary;
  workspace?: MorphoWorkspace;
  assetUrls: Record<string, string>;
  onOpen: () => void;
}) {
  return (
    <article className="phome-card">
      <button className="phome-card-open" type="button" onClick={onOpen} aria-label={`进入项目：${project.title}`}>
        <ProjectCanvasPreview workspace={workspace} assetUrls={assetUrls} className="phome-card-cover" />
        <div className="phome-card-body">
          <h3>{project.title}</h3>
          <p>{displayProjectSubtitle(project, "尚未添加内容的空白项目。")}</p>
          <div className="phome-card-meta">
            <span>{focusLabel(project.currentFocus?.area)}</span>
            <span>{formatDate(project.lastOpenedAt)}</span>
          </div>
        </div>
      </button>
    </article>
  );
}

function CreateProjectCard({ onCreate, disabled }: { onCreate: () => void; disabled: boolean }) {
  return (
    <button className="phome-create-card" type="button" onClick={onCreate} disabled={disabled}>
      <span className="phome-create-mark">
        <Plus size={17} />
      </span>
      <strong>新建项目</strong>
      <span>从一句话、图片、文件或链接开始。</span>
    </button>
  );
}

function sortProjects(projects: LocalProjectSummary[], sortKey: ProjectSortKey): LocalProjectSummary[] {
  const sorted = projects.slice();
  switch (sortKey) {
    case "opened":
      return sorted.sort((a, b) => Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt));
    case "updated":
      return sorted.sort(
        (a, b) =>
          Date.parse(b.continuityUpdatedAt ?? b.updatedAt) - Date.parse(a.continuityUpdatedAt ?? a.updatedAt)
      );
    case "title":
      return sorted.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  }
}

function displayProjectSubtitle(project: LocalProjectSummary, blankFallback: string): string {
  if (project.subtitle && project.subtitle !== BLANK_PROJECT_SUBTITLE) {
    return project.subtitle;
  }
  return project.continuityNote ?? blankFallback;
}

function getAccountInitial(email: string | undefined): string {
  return email?.trim().slice(0, 1).toUpperCase() || "M";
}

function getAccountDisplayName(email: string | undefined): string {
  return email?.split("@")[0]?.trim() || "Morpho 用户";
}

function statusLabel(status: AccountAccessSnapshot["accessStatus"] | undefined): string {
  switch (status) {
    case "active":
      return "已开启测试资格";
    case "pending":
      return "等待测试资格开启";
    case "blocked":
      return "测试资格不可用";
    default:
      return "未知";
  }
}

function createProjectId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `project-${crypto.randomUUID()}`;
  }

  return `project-${Date.now().toString(36)}`;
}

function focusLabel(focus: NonNullable<LocalProjectSummary["currentFocus"]>["area"] | undefined): string {
  switch (focus) {
    case "startAndInput":
      return "开始与输入";
    case "exploration":
      return "探索";
    case "research":
      return "调研";
    case "designDefinition":
      return "设计定义";
    case "deliveryPreparation":
      return "交付准备";
    case "directionAndVisual":
      return "方向与视觉发展";
    default:
      return "尚未明确工作重点";
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
