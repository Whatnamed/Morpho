import type { ConceptDirectionObject, ConceptDirectionRevision } from "@/domain/morpho/types";

type ConceptDirectionDetailProps = {
  object: ConceptDirectionObject;
  revision: ConceptDirectionRevision;
};

export function ConceptDirectionDetail({ object, revision }: ConceptDirectionDetailProps) {
  return (
    <article className="proposal-card concept-direction-detail">
      <header className="proposal-card-header">
        <div>
          <span>概念方向详情</span>
          <strong>{revision.title}</strong>
        </div>
        <div className="proposal-meta">
          <span>{directionStatusLabel(object.status)}</span>
          <span>修订 {revision.revisionNumber}</span>
        </div>
      </header>

      <div className="proposal-read">
        <DetailSection title="摘要" body={revision.summary} />
        <DetailSection title="概念说明" body={revision.conceptStatement} />
        <DetailList title="关键词" items={revision.keywords} inline />
        <DetailSection title="策略" body={revision.strategy} />
        <DetailList title="差异点" items={revision.differentiators} />
        <DetailList title="视觉信号" items={revision.visualSignals} />
        <DetailList title="风险" items={revision.risks} />
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

function DetailList({ title, items, inline = false }: { title: string; items: string[]; inline?: boolean }) {
  if (items.length === 0) {
    return null;
  }

  if (inline) {
    return <DetailSection title={title} body={items.join(" / ")} />;
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

function directionStatusLabel(status: ConceptDirectionObject["status"]): string {
  switch (status) {
    case "pendingPreview":
      return "待预览";
    case "primary":
      return "主方向";
    case "alternative":
      return "备选方向";
    case "eliminated":
      return "已淘汰";
    case "needsReview":
      return "待复核";
  }
}
