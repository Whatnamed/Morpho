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
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { CURRENT_CASE_STUDY_ID } from "@/domain/morpho/caseStudy/currentCaseStudy";
import { createBlankWorkspace } from "@/domain/morpho/workspace";
import {
  getProjectWorkspaceStorageKey,
  initializeBrowserProjectCatalog,
  loadLocalProjectCatalogSnapshot,
  loadProjectWorkspace,
  persistProjectSummary,
  writeProjectWorkspace,
  type LocalProjectCatalog,
  type LocalProjectSummary
} from "@/infrastructure/persistence/localProjectStore";
import { acquireProjectWriteLease, withProjectCatalogLock } from "@/infrastructure/persistence/projectWriteLock";
import {
  estimateOriginStorage,
  formatStorageSize,
  isLocalTextStorageUnderPressure,
  isOriginStorageUnderPressure,
  measureLocalTextStorage,
  requestStorageDurability,
  type LocalTextStorageUsage,
  type OriginStorageUsage,
  type StorageDurabilityStatus
} from "@/infrastructure/persistence/storageDurability";
import { ensureCurrentCaseStudyAssetsWithResult } from "@/infrastructure/assets/currentCaseStudyAssetInstaller";
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
  sameProjectDeletionPlan,
  MAX_PROJECT_TITLE_LENGTH,
  type ProjectDeletionPlan
} from "@/infrastructure/persistence/projectLifecycle";
import {
  ProjectCanvasPreview,
  type ProjectPreviewSnapshot,
  type ProjectPreviewStatus
} from "./ProjectCanvasPreview";
import { useProjectHomePreviews } from "./useProjectHomePreviews";

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
      repairSummary?: boolean;
    }
  | {
      kind: "delete";
      project: LocalProjectSummary;
      plan?: ProjectDeletionPlan;
      attempted?: boolean;
      repairSummary?: boolean;
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
  const [isSigningOut, startSignOutTransition] = useTransition();
  const [inspectedBackup, setInspectedBackup] = useState<InspectedEditableProjectBackupBundle | null>(null);
  const [restoreBusyLabel, setRestoreBusyLabel] = useState<string | null>(null);
  const [restoreMessage, setRestoreMessage] = useState<RestoreMessage | null>(null);
  const [storageDurability, setStorageDurability] = useState<StorageDurabilityStatus>("unknown");
  const [originStorageUsage, setOriginStorageUsage] = useState<OriginStorageUsage>({ status: "unknown" });
  const [localTextStorageUsage, setLocalTextStorageUsage] = useState<LocalTextStorageUsage>({ status: "unknown" });
  const [projectAction, setProjectAction] = useState<ProjectAction | null>(null);
  const [actionBusyLabel, setActionBusyLabel] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<RestoreMessage | null>(null);
  const activeActionRef = useRef<AbortController | null>(null);
  const activeRestoreRef = useRef<{ cancelled: boolean } | null>(null);
  const pendingCreateId = useRef<string | null>(null);
  const caseStudyStartup = useRef<Promise<void> | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const mainScrollRef = useRef<HTMLElement | null>(null);
  const invalidatePreviewsRef = useRef<(projectIds?: readonly string[]) => void>(() => {});
  const invalidateAssetStorageKeysRef = useRef<(storageKeys: readonly string[]) => void>(() => {});
  const storageRefreshTimerRef = useRef<number | null>(null);
  const storageIdleCallbackRef = useRef<number | null>(null);
  const storageRefreshSeqRef = useRef(0);
  const isMountedRef = useRef(true);

  const clearScheduledStorageRefresh = useCallback(() => {
    if (typeof window === "undefined") return;
    if (storageRefreshTimerRef.current !== null) {
      window.clearTimeout(storageRefreshTimerRef.current);
      storageRefreshTimerRef.current = null;
    }
    if (storageIdleCallbackRef.current !== null && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(storageIdleCallbackRef.current);
      storageIdleCallbackRef.current = null;
    }
  }, []);

  const refreshStorageUsage = useCallback(() => {
    clearScheduledStorageRefresh();
    const seq = ++storageRefreshSeqRef.current;
    setLocalTextStorageUsage(measureLocalTextStorage());
    void estimateOriginStorage().then((usage) => {
      if (!isMountedRef.current || seq !== storageRefreshSeqRef.current) return;
      setOriginStorageUsage(usage);
    });
  }, [clearScheduledStorageRefresh]);

  const scheduleStorageRefresh = useCallback(
    (delayMs = 80, deferToIdle = false) => {
      if (typeof window === "undefined") return;
      clearScheduledStorageRefresh();
      storageRefreshTimerRef.current = window.setTimeout(() => {
        storageRefreshTimerRef.current = null;
        if (deferToIdle && typeof window.requestIdleCallback === "function") {
          storageIdleCallbackRef.current = window.requestIdleCallback(
            () => {
              storageIdleCallbackRef.current = null;
              refreshStorageUsage();
            },
            { timeout: 500 }
          );
          return;
        }
        refreshStorageUsage();
      }, delayMs);
    },
    [clearScheduledStorageRefresh, refreshStorageUsage]
  );

  const cancelPendingActions = useCallback(() => {
    activeActionRef.current?.abort();
    if (activeRestoreRef.current) activeRestoreRef.current.cancelled = true;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const handlePageHide = () => {
      cancelled = true;
      clearScheduledStorageRefresh();
      cancelPendingActions();
    };
    window.addEventListener("pagehide", handlePageHide);

    queueMicrotask(async () => {
      if (cancelled) return;
      try {
        const storage = window.localStorage;
        const result = await initializeBrowserProjectCatalog(storage, { isCancelled: () => cancelled });
        if (cancelled) return;
        if (result.status === "failed") {
          setCatalogError(result.reason);
          scheduleStorageRefresh(120, true);
          return;
        }
        setCatalog(result.catalog);
        // Defer storage scan until after initial catalog & visible preview rendering.
        scheduleStorageRefresh(120, true);
        if (!result.catalog.projects.some((project) => project.id === CURRENT_CASE_STUDY_ID)) return;

        const install = async () => {
          const lease = await acquireProjectWriteLease(CURRENT_CASE_STUDY_ID);
          try {
            if (cancelled || lease.status === "heldElsewhere") return;
            const latest = loadLocalProjectCatalogSnapshot(storage);
            if (latest.status !== "ok" || !latest.catalog.projects.some((project) => project.id === CURRENT_CASE_STUDY_ID)) return;
            if (storage.getItem(getProjectWorkspaceStorageKey(CURRENT_CASE_STUDY_ID)) === null) return;

            const installed = await ensureCurrentCaseStudyAssetsWithResult();
            if (cancelled) return;
            invalidateAssetStorageKeysRef.current(installed.updatedStorageKeys);
            if (installed.diagnostics.length > 0) {
              setActionMessage({ tone: "warning", text: "内置案例的部分文件未能加载，重新打开案例可重试。" });
            } else if (result.didMigrate) {
              invalidatePreviewsRef.current([CURRENT_CASE_STUDY_ID]);
            }
            if (installed.updatedStorageKeys.length > 0) {
              scheduleStorageRefresh(120, true);
            }
          } finally {
            if (lease.status === "granted") await lease.release();
          }
        };
        caseStudyStartup.current = install().catch(() => {
          if (!cancelled) setActionMessage({ tone: "warning", text: "内置案例的文件未能准备完成，重新打开案例可重试。" });
        });
        await caseStudyStartup.current;
        caseStudyStartup.current = null;
      } catch {
        if (!cancelled) {
          setCatalogError("浏览器无法初始化本地项目列表。");
          scheduleStorageRefresh(120, true);
        }
      }
    });

    return () => {
      handlePageHide();
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [cancelPendingActions, clearScheduledStorageRefresh, scheduleStorageRefresh]);

  // Projects live only in this browser, so the origin being evictable is a real
  // data-loss path rather than a technical detail. Ask for the grant here, on the
  // page the user reaches before any project work exists to lose.
  useEffect(() => {
    isMountedRef.current = true;
    let isCancelled = false;
    void (async () => {
      const durability = await requestStorageDurability();
      if (isCancelled || !isMountedRef.current) return;
      setStorageDurability(durability);
    })();

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea && event.storageArea !== window.localStorage) return;
      scheduleStorageRefresh();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleStorageRefresh();
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) scheduleStorageRefresh();
    };

    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      isCancelled = true;
      isMountedRef.current = false;
      clearScheduledStorageRefresh();
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [clearScheduledStorageRefresh, refreshStorageUsage, scheduleStorageRefresh]);

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
  const gridProjects = useMemo(
    () => (isSearching ? projects : projects.filter((project) => project.id !== recentProject?.id)),
    [isSearching, projects, recentProject?.id]
  );
  const visibleGridProjectIds = useMemo(() => gridProjects.map((project) => project.id), [gridProjects]);
  // Local-first: without required auth the workspace entry stays usable; with
  // required auth the closed-test gate keeps its existing behavior.
  const canUseProjects = !authRequired || account?.accessStatus === "active";
  const localOnly = !authRequired && !account;
  const workspaceName = localOnly ? "本地工作区" : `${getAccountDisplayName(account?.email)} 的工作区`;

  const refreshCatalogFromStorage = useCallback(() => {
    const snapshot = loadLocalProjectCatalogSnapshot(window.localStorage);
    if (snapshot.status === "ok") {
      setCatalog(snapshot.catalog);
      setCatalogError(null);
    } else if (snapshot.status === "missing") {
      setCatalog(null);
      setCatalogError(null);
      activeActionRef.current?.abort();
      setProjectAction(null);
    } else if (snapshot.status === "failed") {
      setCatalogError(snapshot.reason);
    }
  }, []);

  const { getPreviewState, storageKeyUrls, registerCardElement, invalidateProjects, invalidateAssetStorageKeys } =
    useProjectHomePreviews({
      catalog,
      recentProjectId: !isSearching ? recentProject?.id : undefined,
      visibleGridProjectIds,
      scrollRootRef: mainScrollRef,
      enabled: canUseProjects,
      onExternalCatalogChange: refreshCatalogFromStorage
    });
  useEffect(() => {
    invalidatePreviewsRef.current = invalidateProjects;
    invalidateAssetStorageKeysRef.current = invalidateAssetStorageKeys;
  }, [invalidateAssetStorageKeys, invalidateProjects]);

  const heroPreviewState = !isSearching && recentProject ? getPreviewState(recentProject.id) : null;

  const openProject = async (projectId: string) => {
    cancelPendingActions();
    if (projectId === CURRENT_CASE_STUDY_ID) await caseStudyStartup.current;
    router.push(`/projects/${encodeURIComponent(projectId)}`);
  };

  const runProjectAction = async (label: string, operation: (signal: AbortSignal) => Promise<void>) => {
    if (activeActionRef.current) return;
    const action = new AbortController();
    activeActionRef.current = action;
    setActionMessage(null);
    setActionBusyLabel(label);
    try {
      await operation(action.signal);
    } catch {
      if (!action.signal.aborted) setActionMessage({ tone: "error", text: "无法确认操作是否完成，请重试。" });
    } finally {
      activeActionRef.current = null;
      setActionBusyLabel(null);
    }
  };

  const withHomeProjectLease = async (
    projectId: string,
    signal: AbortSignal,
    operation: () => Promise<void>,
    allowUnsupported = false
  ) => {
    if (projectId === CURRENT_CASE_STUDY_ID) await caseStudyStartup.current;
    if (signal.aborted) return;
    const lease = await acquireProjectWriteLease(projectId);
    if (lease.status === "granted") signal.addEventListener("abort", lease.release, { once: true });
    try {
      if (signal.aborted) return;
      if (lease.status === "heldElsewhere") {
        setActionMessage({ tone: "warning", text: "这个项目正在其他标签页编辑。请关闭对应的编辑标签页后重试。" });
      } else if (lease.status === "unsupported" && !allowUnsupported) {
        setActionMessage({ tone: "warning", text: "当前浏览器无法保护跨标签页编辑。请在支持 Web Locks 的浏览器中操作。" });
      } else {
        await operation();
      }
    } finally {
      if (lease.status === "granted") {
        signal.removeEventListener("abort", lease.release);
        await lease.release();
      }
    }
  };

  const createProject = () => {
    if (!canUseProjects) return;
    void runProjectAction("正在新建项目…", async (signal) => {
      const projectId = pendingCreateId.current ?? createProjectId();
      pendingCreateId.current = projectId;
      let shouldOpen = false;
      await withHomeProjectLease(projectId, signal, async () => {
        await withProjectCatalogLock(() => {
          if (signal.aborted) return;
          const storage = window.localStorage;
          const existing = loadProjectWorkspace(storage, projectId, { mode: "readOnly" });
          if (existing.status === "failed") {
            setActionMessage({ tone: "error", text: existing.reason });
            return;
          }

          const workspace = existing.status === "ok" ? existing.workspace : createBlankWorkspace(projectId);
          if (existing.status === "missing") {
            const written = writeProjectWorkspace(storage, workspace);
            if (written.status === "failed") {
              setActionMessage({ tone: "error", text: `未能确认新项目已保存。${written.reason} 可以重试。` });
              return;
            }
          }

          const summary = persistProjectSummary(storage, workspace);
          if (summary.status === "failed") {
            setActionMessage({ tone: "warning", text: "项目内容已写入，项目列表更新失败。再次点击“新建项目”可继续保存同一个项目。" });
            return;
          }

          pendingCreateId.current = null;
          setCatalog(summary.catalog);
          setCatalogError(null);
          invalidateProjects([projectId]);
          refreshStorageUsage();
          shouldOpen = true;
        }, signal);
      }, true);
      if (shouldOpen && !signal.aborted) void openProject(projectId);
    });
  };

  const startRename = (project: LocalProjectSummary) => {
    if (activeActionRef.current) return;
    setActionMessage(null);
    setProjectAction({ kind: "rename", project, title: project.title });
  };

  const startDelete = (project: LocalProjectSummary) => {
    if (activeActionRef.current) return;
    setActionMessage(null);
    const planned = planLocalProjectDeletion(window.localStorage, project.id);
    if (planned.status === "missing") {
      setProjectAction({ kind: "delete", project, repairSummary: true });
    } else if (planned.status === "failed") {
      setActionMessage({ tone: "error", text: `无法读取这个项目：${planned.reason}` });
    } else {
      setProjectAction({ kind: "delete", project: { ...project, title: planned.plan.title }, plan: planned.plan });
    }
  };

  const commitRename = () => {
    if (projectAction?.kind !== "rename") return;
    const action = projectAction;
    void runProjectAction("正在保存名称…", async (signal) => {
      await withHomeProjectLease(action.project.id, signal, async () => {
        await withProjectCatalogLock(() => {
          if (signal.aborted) return;
          const result = renameLocalProject(window.localStorage, action.project.id, action.repairSummary ? undefined : action.title);
          if (result.status === "failed") {
            if (result.titleSaved) setProjectAction({ ...action, repairSummary: true });
            setActionMessage({ tone: result.titleSaved ? "warning" : "error", text: result.reason });
            return;
          }

          setCatalog(result.catalog);
          setCatalogError(null);
          invalidateProjects([action.project.id]);
          setProjectAction(null);
          setActionMessage({
            tone: "success",
            text: action.repairSummary ? "项目列表已更新。" : `已改名为“${result.workspace.project.title}”。`
          });
        }, signal);
      });
    });
  };

  const commitDelete = () => {
    if (projectAction?.kind !== "delete") return;
    const action = projectAction;
    const { project, plan } = action;
    void runProjectAction("正在删除项目…", async (signal) => {
      await withHomeProjectLease(project.id, signal, async () => {
        const deleted = await withProjectCatalogLock(() => {
          if (signal.aborted) return;
          const storage = window.localStorage;
          const latest = planLocalProjectDeletion(storage, project.id);
          const summaryOnly = latest.status === "missing" && (action.attempted || action.repairSummary);
          if (latest.status !== "ok" && !summaryOnly) {
            setActionMessage({ tone: "error", text: `无法重新确认项目内容：${latest.reason}` });
            return;
          }
          if (latest.status === "ok" && (!plan || action.repairSummary || !sameProjectDeletionPlan(plan, latest.plan))) {
            setProjectAction({ kind: "delete", project: { ...project, title: latest.plan.title }, plan: latest.plan });
            setActionMessage({ tone: "warning", text: "项目内容或文件范围已变化，请重新确认删除。" });
            return;
          }

          const result = deleteLocalProjectRecords(storage, project.id);
          if (result.status === "failed") {
            setProjectAction({ ...action, attempted: true, repairSummary: result.workspaceDeleted || action.repairSummary });
            setActionMessage({ tone: result.workspaceDeleted ? "warning" : "error", text: result.reason });
            return;
          }

          setCatalog(result.catalog);
          setCatalogError(null);
          invalidateProjects([project.id]);
          refreshStorageUsage();
          setProjectAction(null);
          return { plan: latest.status === "ok" ? latest.plan : null };
        }, signal);

        if (!deleted) return;
        const cleanup = await Promise.allSettled(
          (deleted.plan?.exclusiveStorageKeys ?? []).map(async (key) => indexedDbBlobStore.delete(key))
        );
        if (signal.aborted) return;
        refreshStorageUsage();
        const failures = cleanup.filter((entry) => entry.status === "rejected").length;
        setActionMessage({
          tone: failures > 0 ? "warning" : "success",
          text: !deleted.plan
            ? "已更新项目列表。原项目的图片和文件已保留。"
            : failures > 0
              ? `已删除“${project.title}”。有 ${failures} 个文件未能清理。`
              : `已删除“${project.title}”。`
        });
      });
    });
  };

  const exportProjectBackup = (project: LocalProjectSummary) =>
    runProjectAction("正在导出备份…", async (signal) => {
      if (project.id === CURRENT_CASE_STUDY_ID) await caseStudyStartup.current;
      if (signal.aborted) return;
      const loaded = loadProjectWorkspace(window.localStorage, project.id, { mode: "readOnly" });
      if (loaded.status !== "ok") {
        setActionMessage({ tone: "error", text: `无法读取这个项目：${loaded.reason}` });
        return;
      }

      const result = await exportEditableProjectBackupBundle(loaded.workspace, {
        blobStore: indexedDbBlobStore,
        chat: "full",
        projectContinuity: "current"
      });
      if (signal.aborted) return;
      if (result.status !== "ok") {
        setActionMessage({ tone: result.status === "blocked" ? "warning" : "error", text: result.reason });
        return;
      }

      downloadProjectBundleFile(result.file);
      setActionMessage({ tone: "success", text: `已导出“${loaded.workspace.project.title}”的最近已保存内容备份。` });
    });

  const inspectBackup = async (file: File) => {
    if (activeRestoreRef.current) return;
    const operation = { cancelled: false };
    activeRestoreRef.current = operation;
    setRestoreBusyLabel("正在读取备份包…");
    setRestoreMessage(null);
    setInspectedBackup(null);
    try {
      const result = await inspectEditableProjectBackupBundle(file);
      if (operation.cancelled) return;
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
      if (!operation.cancelled) setRestoreMessage({ tone: "error", text: "无法读取备份包。文件可能损坏，或不是 Morpho 可编辑备份。" });
    } finally {
      activeRestoreRef.current = null;
      setRestoreBusyLabel(null);
    }
  };

  const confirmRestore = async () => {
    if (!inspectedBackup || activeRestoreRef.current) return;
    const operation = { cancelled: false };
    activeRestoreRef.current = operation;
    setRestoreBusyLabel("正在恢复为新项目副本…");
    setRestoreMessage(null);
    try {
      const result = await restoreEditableProjectBackupBundle(inspectedBackup, {
        blobStore: indexedDbBlobStore,
        storage: window.localStorage,
        isCancelled: () => operation.cancelled
      });
      if (operation.cancelled) return;
      if (result.status !== "ok") {
        setRestoreMessage({ tone: "error", text: result.reason });
        return;
      }
      setInspectedBackup(null);
      invalidateProjects([result.projectId]);
      refreshStorageUsage();
      void openProject(result.projectId);
    } catch {
      if (!operation.cancelled) setRestoreMessage({ tone: "error", text: "恢复备份失败，请重新选择备份包后再试。" });
    } finally {
      activeRestoreRef.current = null;
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

      <section className="phome-main" ref={mainScrollRef}>
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
              <button className="brand-button phome-create" type="button" onClick={createProject} disabled={Boolean(actionBusyLabel) || !canUseProjects}>
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
              <p>{catalogError}</p>
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
          {actionMessage ? <p className={`phome-restore-message ${actionMessage.tone}`} role="status">{actionMessage.text}</p> : null}
          {projectAction ? (
            <ProjectActionCard
              action={projectAction}
              busy={Boolean(actionBusyLabel)}
              onTitleChange={(title) =>
                setProjectAction((current) => (current?.kind === "rename" ? { ...current, title } : current))
              }
              onCancel={() => {
                activeActionRef.current?.abort();
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
                        preview={heroPreviewState?.preview}
                        previewStatus={heroPreviewState?.status ?? "pending"}
                        subtitleText={displayProjectSubtitle(recentProject, "从一句想法、一张图或一个文件开始这个项目。")}
                      />
                      <span className="phome-hero-enter">
                        进入工作台
                        <ArrowRight size={15} />
                      </span>
                    </div>
                    <ProjectCanvasPreview
                      preview={heroPreviewState?.preview}
                      previewStatus={heroPreviewState?.status ?? "pending"}
                      storageKeyUrls={storageKeyUrls}
                      className="phome-hero-cover"
                    />
                  </button>
                  <ProjectManageActions
                    project={recentProject}
                    onExportBackup={exportProjectBackup}
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
                  {gridProjects.map((project) => {
                    const previewState = getPreviewState(project.id);
                    return (
                      <ProjectCard
                        project={project}
                        preview={previewState.preview}
                        previewStatus={previewState.status}
                        storageKeyUrls={storageKeyUrls}
                        onRegisterElement={registerCardElement}
                        key={project.id}
                        onOpen={() => openProject(project.id)}
                        onExportBackup={exportProjectBackup}
                        onRename={startRename}
                        onDelete={startDelete}
                        actionsDisabled={Boolean(actionBusyLabel)}
                      />
                    );
                  })}
                  {!isSearching ? <CreateProjectCard onCreate={createProject} disabled={Boolean(actionBusyLabel) || !canUseProjects} /> : null}
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

          <LocalStorageFooter
            durability={storageDurability}
            originUsage={originStorageUsage}
            localTextUsage={localTextStorageUsage}
          />
        </div>
      </section>
    </main>
  );
}

/**
 * The footer states where the user's work actually lives. It only escalates when
 * the browser has told us something concrete: an evictable origin, local text
 * records crossing the conservative warning line, or an origin binary quota
 * that is nearly full. An unknown reading says nothing extra, because a warning
 * we cannot substantiate is worse than no warning.
 */
export function LocalStorageFooter({
  durability,
  originUsage,
  localTextUsage
}: {
  durability: StorageDurabilityStatus;
  originUsage: OriginStorageUsage;
  localTextUsage: LocalTextStorageUsage;
}) {
  const isAtRisk = durability === "bestEffort";
  const isOriginNearlyFull = isOriginStorageUnderPressure(originUsage);
  const isLocalTextHigh = isLocalTextStorageUnderPressure(localTextUsage);

  return (
    <footer className={`phome-foot${isAtRisk || isOriginNearlyFull || isLocalTextHigh ? " is-at-risk" : ""}`}>
      项目与素材保存在当前浏览器中，不会自动云同步；换设备继续工作时，请使用可恢复备份。
      {isAtRisk ? (
        <span className="phome-foot-risk">
          当前浏览器尚未允许长期保存：长时间不打开，或设备空间紧张时，本地项目可能被浏览器清空。请定期导出可恢复备份。
        </span>
      ) : null}
      {isLocalTextHigh ? (
        <span className="phome-foot-risk">
          本机项目记录较多，建议导出备份；图片存储可用空间不代表项目记录仍可继续保存。
        </span>
      ) : null}
      {isOriginNearlyFull && originUsage.status === "ok" ? (
        <span className="phome-foot-risk">
          本地图片与文件存储空间已接近上限（已用 {formatStorageSize(originUsage.usageBytes)}，上限约{" "}
          {formatStorageSize(originUsage.quotaBytes)}）。建议先导出备份，再删除不再需要的项目。
        </span>
      ) : null}
    </footer>
  );
}

function HeroSignals({
  project,
  preview,
  previewStatus,
  subtitleText
}: {
  project: LocalProjectSummary;
  preview?: ProjectPreviewSnapshot;
  previewStatus: ProjectPreviewStatus;
  subtitleText: string;
}) {
  const hasConfirmedCounts = previewStatus === "ready" && preview !== undefined;
  const objectCountDisplay = hasConfirmedCounts ? String(preview.activeObjectCount) : "—";
  const imageCountDisplay = hasConfirmedCounts ? String(preview.activeImageCount) : "—";
  const note = project.continuityNote && project.continuityNote !== subtitleText ? project.continuityNote : null;

  return (
    <div className="phome-hero-signals">
      <span className="phome-hero-figure">
        <strong>{objectCountDisplay}</strong>
        <small>画布对象</small>
      </span>
      <span className="phome-hero-figure">
        <strong>{imageCountDisplay}</strong>
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
  preview,
  previewStatus,
  storageKeyUrls,
  onRegisterElement,
  onOpen,
  onExportBackup,
  onRename,
  onDelete,
  actionsDisabled
}: {
  project: LocalProjectSummary;
  preview?: ProjectPreviewSnapshot;
  previewStatus: ProjectPreviewStatus;
  storageKeyUrls: Record<string, string>;
  onRegisterElement: (projectId: string, element: HTMLElement | null) => void;
  onOpen: () => void;
  onExportBackup: (project: LocalProjectSummary) => void;
  onRename: (project: LocalProjectSummary) => void;
  onDelete: (project: LocalProjectSummary) => void;
  actionsDisabled: boolean;
}) {
  const cardRef = useCallback(
    (element: HTMLElement | null) => {
      onRegisterElement(project.id, element);
    },
    [onRegisterElement, project.id]
  );

  return (
    <article className="phome-card" ref={cardRef} data-project-id={project.id}>
      <button className="phome-card-open" type="button" onClick={onOpen} aria-label={`进入项目：${project.title}`}>
        <ProjectCanvasPreview
          preview={preview}
          previewStatus={previewStatus}
          storageKeyUrls={storageKeyUrls}
          className="phome-card-cover"
        />
        <div className="phome-card-body">
          <h3>{project.title}</h3>
          <p>{displayProjectSubtitle(project, "尚未添加内容的空白项目。")}</p>
          <div className="phome-card-meta">
            <span>{focusLabel(project.currentFocus?.area)}</span>
            <span>{formatDate(project.lastOpenedAt)}</span>
          </div>
        </div>
      </button>
      <ProjectManageActions
        project={project}
        onExportBackup={onExportBackup}
        onRename={onRename}
        onDelete={onDelete}
        disabled={actionsDisabled}
      />
    </article>
  );
}

/**
 * Backup export, rename, and delete sit outside the card's open button —
 * nesting them would be invalid markup and would make "open" and "delete" the
 * same click target.
 */
function ProjectManageActions({
  project,
  onExportBackup,
  onRename,
  onDelete,
  disabled
}: {
  project: LocalProjectSummary;
  onExportBackup: (project: LocalProjectSummary) => void;
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
        aria-label={`导出项目备份：${project.title}`}
        title="导出最近已保存内容"
        onClick={() => onExportBackup(project)}
      >
        <Download size={13} />
        导出备份
      </button>
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
              disabled={busy || action.repairSummary}
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
            {action.repairSummary ? "重试更新列表" : "保存名称"}
          </button>
        </div>
      </div>
    );
  }

  const { plan, project } = action;
  return (
    <div className="phome-restore-card is-danger">
      <div>
        <strong>{action.repairSummary ? `更新“${project.title}”的列表记录？` : `删除“${project.title}”？`}</strong>
        {action.repairSummary || !plan ? (
          <p>项目内容已删除。重试会移除残留的列表记录，图片和文件将保留。</p>
        ) : (
          <>
            <p>项目内容、画布、对话与项目记录将从这台设备移除，无法撤销。</p>
            <ul className="phome-delete-scope">
              <li>
                {plan.exclusiveStorageKeys.length > 0
                  ? `同时删除仅本项目使用的 ${plan.exclusiveStorageKeys.length} 个图片或文件。`
                  : "本项目没有可一并清理的独占图片或文件。"}
              </li>
              {plan.unreadableProjectCount > 0 ? (
                <li>有 {plan.unreadableProjectCount} 个项目暂时读不出来，无法确认文件归属，本次不会清理任何图片文件。</li>
              ) : plan.sharedStorageKeys.length > 0 ? (
                <li>{plan.sharedStorageKeys.length} 个文件仍被其他项目使用，会保留。</li>
              ) : null}
            </ul>
            <p className="phome-restore-note">建议先导出一份可恢复备份。</p>
          </>
        )}
      </div>
      <div className="phome-restore-actions">
        <button className="plain-button" type="button" disabled={busy || action.repairSummary} onClick={onExportBackup}>
          <Download size={14} />
          导出备份
        </button>
        <button className="plain-button" type="button" disabled={busy} onClick={onCancel}>
          取消
        </button>
        <button className="brand-button is-danger" type="button" disabled={busy} onClick={onConfirmDelete}>
          {action.repairSummary ? "重试更新列表" : "删除项目"}
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
