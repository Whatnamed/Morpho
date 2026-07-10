import type { DesignDefinitionObject, DesignDefinitionRevision } from "@/domain/morpho/types";

type DesignDefinitionDetailProps = {
  object: DesignDefinitionObject;
  revision: DesignDefinitionRevision;
};

export function DesignDefinitionDetail({ object, revision }: DesignDefinitionDetailProps) {
  return (
    <article className="proposal-card design-definition-detail">
      <header className="proposal-card-header">
        <div>
          <span>设计定义详情</span>
          <strong>{revision.title}</strong>
        </div>
        <div className="proposal-meta">
          <span>{object.isCurrentEffective ? "当前设计定义" : "非当前定义"}</span>
          <span>修订 {revision.revisionNumber}</span>
        </div>
      </header>

      <div className="proposal-read">
        <DetailSection title="摘要" body={revision.summary} />
        <DetailSection title="项目目标" body={revision.projectGoal} />
        <DetailList title="目标用户" items={revision.targetUsers} />
        <DetailList title="主要场景" items={revision.primaryScenarios} />
        <DetailSection title="核心问题" body={revision.coreProblem} />
        <DetailList title="设计原则" items={revision.designPrinciples} />
        <DetailList title="约束" items={revision.constraints} />
        <DetailList title="避免方向" items={revision.avoidDirections} />
        <DetailList title="机会点" items={revision.opportunities} />
        <DetailList title="待确认问题" items={revision.openQuestions} />
        {revision.changeNote ? <DetailSection title="本次变化" body={revision.changeNote} /> : null}
      </div>
    </article>
  );
}

function DetailSection({ title, body }: { title: string; body: string }) {
  if (!body.trim()) {
    return null;
  }

  return (
    <section className="proposal-read-section">
      <span className="proposal-read-kicker">{title}</span>
      <p>{body}</p>
    </section>
  );
}

function DetailList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="proposal-read-section">
      <span className="proposal-read-kicker">{title}</span>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
