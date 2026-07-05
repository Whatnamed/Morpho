"use client";

import { ArrowRight, ChevronDown, Clock, LogOut, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import { createBlankWorkspace } from "@/domain/morpho/workspace";
import {
  initializeLocalProjectCatalog,
  saveProjectWorkspace,
  upsertProjectSummary,
  type LocalProjectCatalog,
  type LocalProjectSummary
} from "@/infrastructure/persistence/localProjectStore";
import { createBrowserSupabaseClient } from "@/infrastructure/supabase/browser";
import type { AccountAccessSnapshot } from "@/server/auth/accountAccess";

type ProjectHomeClientProps = {
  account: AccountAccessSnapshot | null;
  accessError?: string;
};

export function ProjectHomeClient({ account, accessError }: ProjectHomeClientProps) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<LocalProjectCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [accountOpen, setAccountOpen] = useState(false);
  const [isSigningOut, startSignOutTransition] = useTransition();

  useEffect(() => {
    let isCancelled = false;
    queueMicrotask(() => {
      if (isCancelled) {
        return;
      }

      const result = initializeLocalProjectCatalog(window.localStorage);
      if (result.status === "failed") {
        setCatalogError(result.reason);
        return;
      }

      setCatalog(result.catalog);
    });

    return () => {
      isCancelled = true;
    };
  }, []);

  const projects = useMemo(() => {
    const source = catalog?.projects ?? [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return source;
    }

    return source.filter((project) =>
      [project.title, project.subtitle].join(" ").toLowerCase().includes(normalizedQuery)
    );
  }, [catalog?.projects, query]);

  const recentProject = catalog?.projects.find((project) => project.id === catalog.recentProjectId) ?? catalog?.projects[0];
  const isActive = account?.accessStatus === "active";

  const openProject = (projectId: string) => {
    router.push(`/projects/${encodeURIComponent(projectId)}`);
  };

  const createProject = () => {
    if (!isActive) {
      return;
    }

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
      <header className="product-home-topbar">
        <div className="product-home-brand">
          <div className="home-logo-mark">M</div>
          <div>
            <div className="wordmark home-wordmark">Morpho</div>
            <span>项目</span>
          </div>
        </div>
        <div className="product-home-controls">
          <label className="home-search compact" aria-label="项目搜索">
            <Search size={16} />
            <input
              value={query}
              placeholder="搜索项目"
              onChange={(event) => setQuery(event.currentTarget.value)}
              disabled={!isActive}
            />
          </label>
          <button className="brand-button" type="button" onClick={createProject} disabled={!isActive}>
            <Plus size={15} />
            新建项目
          </button>
          <div className="account-menu-wrap">
            <button className="account-button" type="button" onClick={() => setAccountOpen((current) => !current)}>
              <span>{getAccountInitial(account?.email)}</span>
              <ChevronDown size={14} />
            </button>
            {accountOpen ? (
              <AccountMenu account={account} accessError={accessError} isSigningOut={isSigningOut} onSignOut={signOut} />
            ) : null}
          </div>
        </div>
      </header>

      <section className="home-hero product-home-hero" aria-label="Morpho 项目首页">
        <div>
          <p className="home-kicker">你的设计工作台</p>
          <h1>从一个新想法开始，或继续上次的项目。</h1>
          <p>项目、画布、图片和文件仍保存在当前浏览器中。账号只用于封闭测试资格与 AI 调用保护。</p>
        </div>
        <div className="home-actions">
          <button className="brand-button" type="button" onClick={createProject} disabled={!isActive}>
            <Plus size={15} />
            新建项目
          </button>
          <button
            className="plain-button"
            type="button"
            disabled={!isActive || !recentProject}
            onClick={() => isActive && recentProject && openProject(recentProject.id)}
          >
            <Clock size={15} />
            继续最近项目
          </button>
        </div>
      </section>

      {accessError ? <AccessNotice tone="error" title="账号状态暂不可用" body={accessError} /> : null}

      {!accessError && account?.accessStatus === "pending" ? (
        <AccessNotice
          tone="neutral"
          title="等待测试资格开启"
          body="当前账号已登录，但尚未获得 Morpho 封闭测试资格。请联系项目管理员开通后继续使用。"
        />
      ) : null}

      {!accessError && account?.accessStatus === "blocked" ? (
        <AccessNotice
          tone="error"
          title="当前测试资格不可用"
          body="如需继续使用，请联系项目管理员。"
        />
      ) : null}

      {catalogError ? (
        <section className="home-warning">
          <strong>本地项目目录暂不可用</strong>
          <p>{catalogError} 原始数据没有被覆盖；可以清理损坏目录后重新载入。</p>
        </section>
      ) : null}

      {isActive ? (
        <>
          {recentProject ? <ContinueProject project={recentProject} onOpen={() => openProject(recentProject.id)} /> : null}

          <section className="project-list-section" aria-label="最近项目">
            <div className="section-heading">
              <div>
                <span>最近项目</span>
                <h2>当前浏览器中的项目</h2>
              </div>
              <span>{projects.length} 个结果</span>
            </div>
            <div className="project-list">
              {projects.map((project) => (
                <ProjectCard project={project} key={project.id} onOpen={() => openProject(project.id)} />
              ))}
              {projects.length === 0 ? (
                <div className="home-empty">
                  <strong>{query.trim() ? "没有匹配项目" : "还没有本地项目"}</strong>
                  <p>{query.trim() ? "换一个关键词试试。" : "新建项目后，它会保存在当前浏览器中。"}</p>
                </div>
              ) : null}
            </div>
          </section>
        </>
      ) : null}
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

function ContinueProject({ project, onOpen }: { project: LocalProjectSummary; onOpen: () => void }) {
  return (
    <section className="continue-project" aria-label="继续进行">
      <div className="continue-project-copy">
        <span>继续进行</span>
        <h2>{project.title}</h2>
        <p>{project.continuityNote ?? project.subtitle}</p>
        <small>上次打开：{formatDate(project.lastOpenedAt)}</small>
      </div>
      <div className="continue-project-cover" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <button className="brand-button" type="button" onClick={onOpen}>
        进入工作台
        <ArrowRight size={15} />
      </button>
    </section>
  );
}

function ProjectCard({ project, onOpen }: { project: LocalProjectSummary; onOpen: () => void }) {
  return (
    <article className="project-card">
      <div className="project-cover">
        <span />
      </div>
      <div className="project-card-body">
        <div>
          <h2>{project.title}</h2>
          <p>{project.subtitle}</p>
        </div>
        <div className="project-meta">
          <span>最近工作：{focusLabel(project.currentFocus?.area)}</span>
          <span>最近明确项目更新：{formatDate(project.continuityUpdatedAt ?? project.updatedAt)}</span>
          <span>{project.continuityNote ?? "暂无明确项目记录；可以从导入资料或保存结论开始。"}</span>
          <span>上次打开：{formatDate(project.lastOpenedAt)}</span>
        </div>
      </div>
      <button className="icon-button" type="button" aria-label={`打开 ${project.title}`} onClick={onOpen}>
        <ArrowRight size={16} />
      </button>
    </article>
  );
}

function getAccountInitial(email: string | undefined): string {
  return email?.trim().slice(0, 1).toUpperCase() || "M";
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
      return "暂无明确重点";
  }
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "未知";
  }

  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}
