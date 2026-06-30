"use client";

import { ArrowRight, Clock, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { createBlankWorkspace } from "@/domain/morpho/workspace";
import {
  initializeLocalProjectCatalog,
  saveProjectWorkspace,
  upsertProjectSummary,
  type LocalProjectCatalog,
  type LocalProjectSummary
} from "@/infrastructure/persistence/localProjectStore";

export function ProjectHomeClient() {
  const router = useRouter();
  const [catalog, setCatalog] = useState<LocalProjectCatalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

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

  const openProject = (projectId: string) => {
    router.push(`/projects/${encodeURIComponent(projectId)}`);
  };

  const createProject = () => {
    const projectId = createProjectId();
    const workspace = createBlankWorkspace(projectId);
    saveProjectWorkspace(window.localStorage, workspace);
    const nextCatalog = upsertProjectSummary(window.localStorage, workspace);
    setCatalog(nextCatalog);
    openProject(projectId);
  };

  return (
    <main className="project-home">
      <section className="home-hero" aria-label="Morpho 项目首页">
        <div>
          <div className="wordmark home-wordmark">Morpho</div>
          <h1>本地项目</h1>
          <p>从已有项目继续，或直接创建一个空白工作台。资料、画布、聊天和资产都会保存在当前浏览器本地。</p>
        </div>
        <div className="home-actions">
          <button className="brand-button" type="button" onClick={createProject}>
            <Plus size={15} />
            新建项目
          </button>
          <button
            className="plain-button"
            type="button"
            disabled={!recentProject}
            onClick={() => recentProject && openProject(recentProject.id)}
          >
            <Clock size={15} />
            继续最近项目
          </button>
        </div>
      </section>

      <section className="home-search" aria-label="项目搜索">
        <Search size={16} />
        <input
          value={query}
          placeholder="按项目名称或一句说明搜索"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </section>

      {catalogError ? (
        <section className="home-warning">
          <strong>本地项目目录暂不可用</strong>
          <p>{catalogError} 原始数据没有被覆盖；可以清理损坏目录后重新载入。</p>
        </section>
      ) : null}

      <section className="project-list" aria-label="已有项目">
        {projects.map((project) => (
          <ProjectCard project={project} key={project.id} onOpen={() => openProject(project.id)} />
        ))}
        {projects.length === 0 ? <p className="home-empty">没有匹配项目。</p> : null}
      </section>
    </main>
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
