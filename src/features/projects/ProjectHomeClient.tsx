"use client";

import { Archive, ArrowRight, BookOpen, ChevronDown, CircleHelp, FolderKanban, Grid2X2, LogOut, Plus, Search, Settings, SlidersHorizontal, Sparkles, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

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
import { createBrowserSupabaseClient } from "@/infrastructure/supabase/browser";
import type { AccountAccessSnapshot } from "@/server/auth/accountAccess";
import { useWorkspaceAssetUrls } from "@/features/workspace/useWorkspaceAssetUrls";
import { getProjectPreviewAssets, ProjectCanvasPreview } from "./ProjectCanvasPreview";

type ProjectHomeClientProps = {
  account: AccountAccessSnapshot | null;
  accessError?: string;
};

export function ProjectHomeClient({ account, accessError }: ProjectHomeClientProps) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<LocalProjectCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [accountOpenAt, setAccountOpenAt] = useState<"header" | "sidebar" | null>(null);
  const [projectWorkspaces, setProjectWorkspaces] = useState<Record<string, MorphoWorkspace>>({});
  const [isSigningOut, startSignOutTransition] = useTransition();

  useEffect(() => {
    let isCancelled = false;
    queueMicrotask(async () => {
      if (isCancelled) return;

      const result = initializeLocalProjectCatalog(window.localStorage);
      if (result.status === "failed") {
        setCatalogError(result.reason);
        return;
      }

      await ensureCurrentCaseStudyAssets();
      if (isCancelled) return;
      setCatalog(result.catalog);
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
    if (!normalizedQuery) return source;

    return source.filter((project) => [project.title, project.subtitle].join(" ").toLowerCase().includes(normalizedQuery));
  }, [catalog?.projects, query]);

  const recentProject = catalog?.projects.find((project) => project.id === catalog.recentProjectId) ?? catalog?.projects[0];
  const recentProjects = (catalog?.projects ?? []).slice(0, 4);
  const recentProjectGrid = projects.filter((project) => project.id !== recentProject?.id).slice(0, 3);
  const previewAssets = useMemo(() => getProjectPreviewAssets(projectWorkspaces), [projectWorkspaces]);
  const previewAssetUrls = useWorkspaceAssetUrls(previewAssets);
  const isActive = account?.accessStatus === "active";
  const workspaceName = getWorkspaceName(account?.email);

  const openProject = (projectId: string) => {
    router.push(`/projects/${encodeURIComponent(projectId)}`);
  };

  const createProject = () => {
    if (!isActive) return;

    const projectId = createProjectId();
    const workspace = createBlankWorkspace(projectId);
    saveProjectWorkspace(window.localStorage, workspace);
    const nextCatalog = upsertProjectSummary(window.localStorage, workspace);
    setCatalog(nextCatalog);
    openProject(projectId);
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
    <main className="project-home">
      <aside className="project-home-sidebar" aria-label="工作区导航">
        <div className="project-home-sidebar-head">
          <div className="home-logo-mark">M</div>
          <div>
            <div className="wordmark home-wordmark">Morpho</div>
            <strong>{workspaceName}</strong>
          </div>
        </div>

        <nav className="project-home-nav" aria-label="主要入口">
          <button className="is-active" type="button" aria-current="page">
            <FolderKanban size={16} />
            项目
          </button>
          <button type="button" disabled title="暂未开放">
            <BookOpen size={16} />
            灵感资料
            <small>暂未开放</small>
          </button>
          <button type="button" disabled title="暂未开放">
            <Archive size={16} />
            已归档项目
            <small>暂未开放</small>
          </button>
        </nav>

        <section className="project-home-recent-nav" aria-label="最近项目">
          <span>最近项目</span>
          {recentProjects.length > 0 ? (
            recentProjects.map((project) => (
              <button type="button" key={project.id} onClick={() => openProject(project.id)} title={project.title}>
                {project.title}
              </button>
            ))
          ) : (
            <p className="project-home-empty-hint">还没有项目</p>
          )}
        </section>

        <section className="project-home-workspace-nav" aria-label="工作区视图">
          <span>工作区</span>
          <button className="is-current" type="button"><Grid2X2 size={15} /> 全部项目</button>
          <button type="button" disabled title="暂未开放"><Sparkles size={15} /> 个人草稿 <small>暂未开放</small></button>
        </section>

        <div className="project-home-sidebar-footer">
          <div className="account-menu-wrap project-home-sidebar-account">
            <button
              className="project-home-user-entry"
              type="button"
              onClick={() => setAccountOpenAt((current) => (current === "sidebar" ? null : "sidebar"))}
            >
              <span className="project-home-avatar">{getAccountInitial(account?.email)}</span>
              <span>
                <strong>{getAccountDisplayName(account?.email)}</strong>
                <small>{account?.email ?? "账户信息"}</small>
              </span>
              <ChevronDown size={14} />
            </button>
            {accountOpenAt === "sidebar" ? (
              <AccountMenu account={account} accessError={accessError} isSigningOut={isSigningOut} onSignOut={signOut} />
            ) : null}
          </div>
          <button className="project-home-side-link" type="button" disabled title="暂未开放">
            <Settings size={15} />
            设置
            <small>暂未开放</small>
          </button>
          <button className="project-home-side-link" type="button" disabled title="暂未开放">
            <CircleHelp size={15} />
            帮助
          </button>
        </div>
      </aside>

      <div className="project-home-main">
        <header className="product-home-topbar">
          <div>
            <span className="home-kicker">项目工作区</span>
            <h1>项目</h1>
          </div>
          <div className="product-home-controls">
            <label className="home-search compact" aria-label="搜索项目">
              <Search size={16} />
              <input value={query} placeholder="搜索项目" onChange={(event) => setQuery(event.currentTarget.value)} disabled={!isActive} />
            </label>
            <button className="brand-button" type="button" onClick={createProject} disabled={!isActive}>
              <Plus size={15} />
              新建项目
            </button>
            <button className="project-home-filter" type="button" disabled title="暂未开放">
              <SlidersHorizontal size={15} />
              筛选
            </button>
            <div className="account-menu-wrap project-home-header-account">
              <button
                className="account-button"
                type="button"
                aria-label="账户菜单"
                onClick={() => setAccountOpenAt((current) => (current === "header" ? null : "header"))}
              >
                <span>{getAccountInitial(account?.email)}</span>
                <ChevronDown size={14} />
              </button>
              {accountOpenAt === "header" ? (
                <AccountMenu account={account} accessError={accessError} isSigningOut={isSigningOut} onSignOut={signOut} />
              ) : null}
            </div>
          </div>
        </header>

        {accessError ? <AccessNotice tone="error" title="账户状态暂不可用" body={accessError} /> : null}
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

        {isActive ? (
          <>
            {recentProject ? (
              <ContinueProject
                project={recentProject}
                workspace={projectWorkspaces[recentProject.id]}
                assetUrls={previewAssetUrls}
                onOpen={() => openProject(recentProject.id)}
              />
            ) : null}

            {recentProjectGrid.length > 0 && !query.trim() ? (
              <section className="project-list-section project-recent-section" aria-label="最近项目">
                <div className="section-heading">
                  <div>
                    <span>最近项目</span>
                    <h2>继续展开中的工作</h2>
                  </div>
                  <span>{recentProjectGrid.length} 个项目</span>
                </div>
                <div className="project-grid project-recent-grid">
                  {recentProjectGrid.map((project) => (
                    <ProjectCard
                      project={project}
                      workspace={projectWorkspaces[project.id]}
                      assetUrls={previewAssetUrls}
                      key={project.id}
                      onOpen={() => openProject(project.id)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            <section className="project-list-section" aria-label="全部项目">
              <div className="section-heading">
                <div>
                  <span>{query.trim() ? "搜索结果" : "全部项目"}</span>
                  <h2>{query.trim() ? `与“${query.trim()}”相关的项目` : "在这个浏览器中继续创作"}</h2>
                </div>
                <div className="project-list-tools">
                  <span>{projects.length} 个项目</span>
                  <button type="button" disabled title="暂未开放">最近打开</button>
                </div>
              </div>
              <div className="project-grid">
                {projects.map((project) => (
                  <ProjectCard
                    project={project}
                    workspace={projectWorkspaces[project.id]}
                    assetUrls={previewAssetUrls}
                    key={project.id}
                    onOpen={() => openProject(project.id)}
                  />
                ))}
                <CreateProjectCard onCreate={createProject} disabled={!isActive} />
                {projects.length === 0 ? (
                  <div className="home-empty">
                    <strong>{query.trim() ? "没有匹配项目" : "还没有本地项目"}</strong>
                    <p>{query.trim() ? "换一个关键词试试。" : "新建项目后，可以从一句话、图片、文件或链接开始。"}</p>
                  </div>
                ) : null}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
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
      <div className="account-menu-links">
        <span><UserRound size={14} /> 账户信息</span>
        <span aria-disabled="true"><Settings size={14} /> 设置暂未开放</span>
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

function ContinueProject({
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
  const activeObjectCount = workspace ? Object.values(workspace.objects).filter((object) => object.visibility === "active").length : 0;
  const imageCount = workspace ? Object.values(workspace.objects).filter((object) => object.visibility === "active" && object.type === "image").length : 0;

  return (
    <section className="continue-project" aria-label="继续最近项目">
      <div className="continue-project-copy">
        <span>继续最近项目</span>
        <h2>{project.title}</h2>
        <p>{project.continuityNote ?? project.subtitle}</p>
        <div className="continue-project-meta">
          <small>最近打开 · {formatDate(project.lastOpenedAt)}</small>
          <small>最近更新 · {formatDate(project.continuityUpdatedAt ?? project.updatedAt)}</small>
          <small>{focusLabel(project.currentFocus?.area)}</small>
        </div>
        <div className="continue-project-signals">
          <span><strong>{activeObjectCount}</strong> 个画布对象</span>
          <span><strong>{imageCount}</strong> 张视觉素材</span>
          <span>{project.continuityNote ? "已有当前工作记录" : "等待下一步工作记录"}</span>
        </div>
      </div>
      <ProjectCanvasPreview workspace={workspace} assetUrls={assetUrls} className="continue-project-cover" />
      <button className="brand-button" type="button" onClick={onOpen}>
        进入工作台
        <ArrowRight size={15} />
      </button>
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
    <article className="project-card">
      <button className="project-card-open" type="button" onClick={onOpen} aria-label={`进入项目：${project.title}`}>
        <ProjectCanvasPreview workspace={workspace} assetUrls={assetUrls} className="project-cover" />
        <div className="project-card-body">
          <div>
            <h2>{project.title}</h2>
            <p>{project.subtitle}</p>
          </div>
          <div className="project-meta">
            <span>{focusLabel(project.currentFocus?.area)}</span>
            <span>更新 · {formatDate(project.continuityUpdatedAt ?? project.updatedAt)}</span>
            <span>打开 · {formatDate(project.lastOpenedAt)}</span>
          </div>
          <small>{project.continuityNote ?? "从已有材料继续整理和发展。"}</small>
        </div>
        <span className="project-card-arrow"><ArrowRight size={16} /></span>
      </button>
    </article>
  );
}

function CreateProjectCard({ onCreate, disabled }: { onCreate: () => void; disabled: boolean }) {
  return (
    <button className="project-create-card" type="button" onClick={onCreate} disabled={disabled}>
      <span className="project-create-mark"><Plus size={18} /></span>
      <strong>新建项目</strong>
      <span>从一句话、图片、文件或链接开始。</span>
    </button>
  );
}

function getAccountInitial(email: string | undefined): string {
  return email?.trim().slice(0, 1).toUpperCase() || "M";
}

function getAccountDisplayName(email: string | undefined): string {
  return email?.split("@")[0]?.trim() || "Morpho 用户";
}

function getWorkspaceName(email: string | undefined): string {
  return `${getAccountDisplayName(email)} 的工作区`;
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
