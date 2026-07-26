"use client";

import {
  Archive,
  ArrowRight,
  BookOpen,
  ChevronDown,
  CircleHelp,
  Download,
  LayoutGrid,
  LogOut,
  Pencil,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
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
import {
  estimateOriginStorage,
  formatStorageSize,
  isOriginStorageUnderPressure,
  requestStorageDurability,
  type OriginStorageUsage,
  type StorageDurabilityStatus
} from "@/infrastructure/persistence/storageDurability";
import { ensureCurrentCaseStudyAssets } from "@/infrastructure/assets/currentCaseStudyAssetInstaller";
import { indexedDbBlobStore } from "@/infrastructure/assets/indexedDbAssetStore";
import { createBrowserSupabaseClient } from "@/infrastructure/supabase/browser";
import type { AccountAccessSnapshot } from "@/server/auth/accountAccess";
import {
  downloadProjectBundleFile,
  exportEditableProjectBackupBundle,
  inspectEditableProjectBackupBundle,
  restoreEditableProjectBackupBundle,
  type InspectedEditableProjectBackupBundle
} from "@/features/archive/projectBundleClient";
import {
  deleteLocalProjectRecords,
  planLocalProjectDeletion,
  renameLocalProject,
  MAX_PROJECT_TITLE_LENGTH,
  type ProjectDeletionPlan
} from "@/infrastructure/persistence/projectLifecycle";
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

/**
 * A rename or a delete the user has started but not yet confirmed. Deleting is
 * irreversible and local-only, so the plan is resolved up front and shown
 * before anything is written.
 */
type ProjectAction =
  | {
      kind: "rename";
      project: LocalProjectSummary;
      title: string;
    }
  | {
      kind: "delete";
      project: LocalProjectSummary;
      plan: ProjectDeletionPlan;
    };

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
  const [storageDurability, setStorageDurability] = useState<StorageDurabilityStatus>("unknown");
  const [originStorageUsage, setOriginStorageUsage] = useState<OriginStorageUsage>({ status: "unknown" });
  const [projectAction, setProjectAction] = useState<ProjectAction | null>(null);
  const [actionBusyLabel, setActionBusyLabel] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<RestoreMessage | null>(null);
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

  // Projects live only in this browser, so the origin being evictable is a real
  // data-loss path rather than a technical detail. Ask for the grant here, on the
  // page the user reaches before any project work exists to lose.
  useEffect(() => {
    let isCancelled = false;
    void (async () => {
      const durability = await requestStorageDurability();
      if (isCancelled) return;
      setStorageDurability(durability);

      const usage = await estimateOriginStorage();
      if (isCancelled) return;
      setOriginStorageUsage(usage);
    })();

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

  const startRename = (project: LocalProjectSummary) => {
    setActionMessage(null);
    setProjectAction({ kind: "rename", project, title: project.title });
  };

  const startDelete = (project: LocalProjectSummary) => {
    setActionMessage(null);
    const planned = planLocalProjectDeletion(window.localStorage, project.id);
    if (planned.status !== "ok") {
      setActionMessage({ tone: "error", text: `无法读取这个项目：${planned.reason}没有删除任何内容。` });
      return;
    }
    setProjectAction({ kind: "delete", project, plan: planned.plan });
  };

  const commitRename = () => {
    if (projectAction?.kind !== "rename") return;

    const result = renameLocalProject(window.localStorage, projectAction.project.id, projectAction.title);
    if (result.status !== "ok") {
      setActionMessage({ tone: "error", text: result.reason });
      return;
    }

    setCatalog(result.catalog);
    setProjectAction(null);
    setActionMessage({ tone: "success", text: `已改名为“${result.workspace.project.title}”。` });
  };

  /**
   * Records first, blobs second. If IndexedDB fails, the user is left with
   * unreferenced image data — reclaimable later — rather than a project that is
   * half deleted and can no longer be opened.
   */
  const commitDelete = async () => {
    if (projectAction?.kind !== "delete") return;
    const { project, plan } = projectAction;

    setActionBusyLabel("正在删除项目…");
    try {
      const result = deleteLocalProjectRecords(window.localStorage, project.id);
      if (result.status !== "ok") {
        setActionMessage({ tone: "error", text: result.reason });
        return;
      }

      setCatalog(result.catalog);
      setProjectAction(null);

      const cleanup = await Promise.allSettled(
        plan.exclusiveStorageKeys.map((storageKey) => indexedDbBlobStore.delete(storageKey))
      );
      const failedCleanup = cleanup.filter((entry) => entry.status === "rejected").length;
      setActionMessage({
        tone: failedCleanup > 0 ? "warning" : "success",
        text:
          failedCleanup > 0
            ? `已删除“${project.title}”。有 ${failedCleanup} 个图片文件未能清理，不影响其他项目。`
            : `已删除“${project.title}”。`
      });
    } catch {
      setActionMessage({ tone: "error", text: "删除项目时出错，请刷新页面后确认当前状态。" });
    } finally {
      setActionBusyLabel(null);
    }
  };

  const exportProjectBackup = async (project: LocalProjectSummary) => {
    setActionBusyLabel("正在导出备份…");
    setActionMessage(null);
    try {
      const loaded = loadProjectWorkspace(window.localStorage, project.id);
      if (loaded.status !== "ok") {
        setActionMessage({ tone: "error", text: `无法读取这个项目：${loaded.reason}` });
        return;
      }

      const result = await exportEditableProjectBackupBundle(loaded.workspace, {
        blobStore: indexedDbBlobStore,
        chat: "full",
        projectContinuity: "current"
      });
      if (result.status !== "ok") {
        setActionMessage({ tone: result.status === "blocked" ? "warning" : "error", text: result.reason });
        return;
      }

      downloadProjectBundleFile(result.file);
      setActionMessage({ tone: "success", text: "备份已导出。" });
    } catch {
      setActionMessage({ tone: "error", text: "导出备份失败，项目内容没有改变。" });
    } finally {
      setActionBusyLabel(null);
    }
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

          {actionBusyLabel ? <p className="phome-restore-status" role="status">{actionBusyLabel}</p> : null}
          {actionMessage ? <p className={`phome-restore-message ${actionMessage.tone}`}>{actionMessage.text}</p> : null}
          {projectAction ? (
            <ProjectActionCard
              action={projectAction}
              busy={Boolean(actionBusyLabel)}
              onTitleChange={(title) =>
                setProjectAction((current) => (current?.kind === "rename" ? { ...current, title } : current))
              }
              onCancel={() => {
                setProjectAction(null);
                setActionMessage(null);
              }}
              onConfirmRename={commitRename}
              onConfirmDelete={() => void commitDelete()}
              onExportBackup={() => void exportProjectBackup(projectAction.project)}
            />
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
                  <ProjectManageActions
                    project={recentProject}
                    onRename={startRename}
                    onDelete={startDelete}
                    disabled={Boolean(actionBusyLabel)}
                  />
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
                      onRename={startRename}
                      onDelete={startDelete}
                      actionsDisabled={Boolean(actionBusyLabel)}
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

          <LocalStorageFooter durability={storageDurability} usage={originStorageUsage} />
        </div>
      </section>
    </main>
  );
}

/**
 * The footer states where the user's work actually lives. It only escalates when
 * the browser has told us something concrete: an evictable origin, or a quota
 * that is nearly full. An unknown grant says nothing extra, because a warning we
 * cannot substantiate is worse than no warning.
 */
export function LocalStorageFooter({
  durability,
  usage
}: {
  durability: StorageDurabilityStatus;
  usage: OriginStorageUsage;
}) {
  const isAtRisk = durability === "bestEffort";
  const isNearlyFull = isOriginStorageUnderPressure(usage);

  return (
    <footer className={`phome-foot${isAtRisk || isNearlyFull ? " is-at-risk" : ""}`}>
      项目与素材保存在当前浏览器中，不会自动云同步；换设备继续工作时，请使用可恢复备份。
      {isAtRisk ? (
        <span className="phome-foot-risk">
          当前浏览器尚未允许长期保存：长时间不打开，或设备空间紧张时，本地项目可能被浏览器清空。请定期导出可恢复备份。
        </span>
      ) : null}
      {isNearlyFull && usage.status === "ok" ? (
        <span className="phome-foot-risk">
          浏览器可用空间已接近上限（已用 {formatStorageSize(usage.usageBytes)}，上限约{" "}
          {formatStorageSize(usage.quotaBytes)}）。建议先导出备份，再删除不再需要的项目。
        </span>
      ) : null}
    </footer>
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
  onOpen,
  onRename,
  onDelete,
  actionsDisabled
}: {
  project: LocalProjectSummary;
  workspace?: MorphoWorkspace;
  assetUrls: Record<string, string>;
  onOpen: () => void;
  onRename: (project: LocalProjectSummary) => void;
  onDelete: (project: LocalProjectSummary) => void;
  actionsDisabled: boolean;
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
      <ProjectManageActions project={project} onRename={onRename} onDelete={onDelete} disabled={actionsDisabled} />
    </article>
  );
}

/**
 * Rename and delete sit outside the card's open button — nesting them would be
 * invalid markup and would make "open" and "delete" the same click target.
 */
function ProjectManageActions({
  project,
  onRename,
  onDelete,
  disabled
}: {
  project: LocalProjectSummary;
  onRename: (project: LocalProjectSummary) => void;
  onDelete: (project: LocalProjectSummary) => void;
  disabled: boolean;
}) {
  return (
    <div className="phome-card-actions">
      <button
        className="phome-card-action"
        type="button"
        disabled={disabled}
        aria-label={`重命名项目：${project.title}`}
        onClick={() => onRename(project)}
      >
        <Pencil size={13} />
        重命名
      </button>
      <button
        className="phome-card-action is-danger"
        type="button"
        disabled={disabled}
        aria-label={`删除项目：${project.title}`}
        onClick={() => onDelete(project)}
      >
        <Trash2 size={13} />
        删除
      </button>
    </div>
  );
}

function ProjectActionCard({
  action,
  busy,
  onTitleChange,
  onCancel,
  onConfirmRename,
  onConfirmDelete,
  onExportBackup
}: {
  action: ProjectAction;
  busy: boolean;
  onTitleChange: (title: string) => void;
  onCancel: () => void;
  onConfirmRename: () => void;
  onConfirmDelete: () => void;
  onExportBackup: () => void;
}) {
  if (action.kind === "rename") {
    return (
      <div className="phome-restore-card">
        <div>
          <strong>重命名项目</strong>
          <label className="phome-rename-field">
            <span className="sr-only">项目名称</span>
            <input
              value={action.title}
              autoFocus
              maxLength={MAX_PROJECT_TITLE_LENGTH}
              onChange={(event) => onTitleChange(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onConfirmRename();
                if (event.key === "Escape") onCancel();
              }}
            />
          </label>
          <p className="phome-restore-note">只改名称，不改变项目内容、画布位置或最近更新时间。</p>
        </div>
        <div className="phome-restore-actions">
          <button className="plain-button" type="button" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button className="brand-button" type="button" disabled={busy} onClick={onConfirmRename}>
            保存名称
          </button>
        </div>
      </div>
    );
  }

  const { plan, project } = action;
  return (
    <div className="phome-restore-card is-danger">
      <div>
        <strong>删除“{project.title}”？</strong>
        <p>项目内容、画布、对话与项目记录将从这台设备移除，无法撤销。</p>
        <ul className="phome-delete-scope">
          <li>
            {plan.exclusiveStorageKeys.length > 0
              ? `同时删除仅本项目使用的 ${plan.exclusiveStorageKeys.length} 个图片或文件。`
              : "本项目没有可一并清理的独占图片或文件。"}
          </li>
          {plan.sharedStorageKeys.length > 0 ? (
            <li>{plan.sharedStorageKeys.length} 个文件仍被其他项目使用，会保留。</li>
          ) : null}
          {plan.unreadableProjectCount > 0 ? (
            <li>
              有 {plan.unreadableProjectCount} 个项目暂时读不出来，无法确认文件归属，本次不会清理任何图片文件。
            </li>
          ) : null}
        </ul>
        <p className="phome-restore-note">建议先导出一份可恢复备份。</p>
      </div>
      <div className="phome-restore-actions">
        <button className="plain-button" type="button" disabled={busy} onClick={onExportBackup}>
          <Download size={14} />
          导出备份
        </button>
        <button className="plain-button" type="button" disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button className="brand-button is-danger" type="button" disabled={busy} onClick={onConfirmDelete}>
          删除项目
        </button>
      </div>
    </div>
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
