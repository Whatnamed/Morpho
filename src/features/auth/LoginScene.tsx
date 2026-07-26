import type { CSSProperties } from "react";

/**
 * Decorative backdrop for the sign-in page: a skeletonized Morpho workspace
 * with three stage zones, placeholder canvas objects and relation curves.
 * Geometry values are the design-handoff spec; they are one-off per element,
 * so they live inline instead of as forty single-use CSS classes.
 */
export function LoginScene() {
  return (
    <div className="login-scene" aria-hidden="true">
      <svg viewBox="0 0 1622 580" style={{ width: 1622, height: 580 }}>
        <path d="M300,213 C 388,182 516,144 604,166" fill="none" stroke="rgba(109,127,136,.28)" strokeWidth="1.2" />
        <path d="M236,412 C 344,448 504,436 620,398" fill="none" stroke="rgba(109,127,136,.24)" strokeWidth="1.2" />
        <path d="M1136,173 C 1176,166 1194,170 1228,181" fill="none" stroke="rgba(109,127,136,.28)" strokeWidth="1.2" />
      </svg>

      {/* 暖沙分区：图片、文件、图片合集 */}
      <div className="login-stage" style={{ width: 500, height: 470, marginTop: 76, background: "rgba(238,224,201,.26)", border: "1px solid rgba(174,143,101,.28)" }}>
        <span className="login-stage-label" style={{ width: 64, background: "rgba(122,91,57,.22)" }} />
        <div style={{ position: "absolute", left: 32, top: 48, width: 268, transform: "rotate(-1.6deg)" }}>
          <div style={{ width: 268, height: 178, borderRadius: 10, border: "1px solid rgba(78,68,58,.1)", background: "radial-gradient(circle at 32% 30%, #f8f1e2, transparent 58%), radial-gradient(circle at 72% 68%, rgba(255,217,135,.32), transparent 46%), linear-gradient(135deg, #e9e2d3, #cfc6b3)", boxShadow: "var(--shadow-image)" }} />
          <SceneCaption chipWidth={28} lineWidth={76} />
        </div>
        <div style={{ position: "absolute", left: 330, top: 84, width: 132, height: 104, transform: "rotate(.8deg)", borderRadius: "4px 10px 10px 4px", border: "1px solid rgba(78,68,58,.09)", borderLeft: "4px solid rgba(109,127,136,.55)", background: "#fffefb", boxShadow: "var(--shadow-object)", padding: "14px 14px 0", boxSizing: "border-box" }}>
          <SceneLine width="70%" height={6} tone={0.12} />
          <SceneLine width="90%" marginTop={9} />
          <SceneLine width="82%" marginTop={7} />
          <SceneLine width="56%" marginTop={7} />
        </div>
        <div style={{ position: "absolute", left: 88, top: 288, width: 148, transform: "rotate(1.4deg)" }}>
          <div style={{ width: 148, height: 96, boxSizing: "border-box", borderRadius: 10, border: "1px solid rgba(78,68,58,.1)", background: "#f2eee5", boxShadow: "var(--shadow-image)", padding: 10, display: "flex", gap: 10 }}>
            <span style={{ flex: 1, borderRadius: 6, background: "#d9d4ca" }} />
            <span style={{ flex: 1, borderRadius: 6, background: "#a99782" }} />
            <span style={{ flex: 1, borderRadius: 6, background: "#4d5a4a" }} />
          </div>
          <SceneCaption chipWidth={28} lineWidth={64} />
        </div>
      </div>

      {/* 雾蓝分区：大图、图片网格、文档、批注片段 */}
      <div className="login-stage" style={{ width: 600, height: 580, marginLeft: 64, background: "rgba(213,227,234,.26)", border: "1px solid rgba(117,148,164,.3)" }}>
        <span className="login-stage-label" style={{ width: 78, background: "rgba(73,107,125,.24)" }} />
        <div style={{ position: "absolute", left: 40, top: 56, width: 330, transform: "rotate(-.8deg)" }}>
          <div style={{ width: 330, height: 220, borderRadius: 10, border: "1px solid rgba(78,68,58,.1)", background: "radial-gradient(circle at 30% 28%, #f8f1e2, transparent 56%), radial-gradient(circle at 70% 70%, rgba(255,217,135,.3), transparent 44%), linear-gradient(135deg, #e7e0d1, #c9bfab)", boxShadow: "var(--shadow-image)" }} />
          <SceneCaption chipWidth={30} lineWidth={88} />
        </div>
        <div style={{ position: "absolute", left: 404, top: 118, width: 168, transform: "rotate(1.6deg)" }}>
          <div style={{ width: 168, height: 110, boxSizing: "border-box", borderRadius: 10, border: "1px solid rgba(78,68,58,.1)", background: "#fbf9f4", boxShadow: "var(--shadow-image)", padding: 9, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gridTemplateRows: "1fr 1fr", gap: 6 }}>
            {["#e5ddcb", "#d4c9bc", "#c3b6a0", "#ddd6c6", "#b9aa98", "#cfc6b3"].map((color) => (
              <span key={color} style={{ borderRadius: 4, background: color }} />
            ))}
          </div>
          <SceneCaption chipWidth={28} lineWidth={70} />
        </div>
        <div style={{ position: "absolute", left: 56, top: 330, width: 210, transform: "rotate(.5deg)" }}>
          <div style={{ width: 210, height: 136, boxSizing: "border-box", borderRadius: 10, border: "1px solid rgba(78,68,58,.1)", background: "#f2eee5", boxShadow: "var(--shadow-image)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ flex: 1, borderRadius: 5, background: "#e8e0d5" }} />
            <span style={{ flex: 1, borderRadius: 5, background: "#d4c9bc" }} />
          </div>
          <SceneCaption chipWidth={26} lineWidth={58} />
        </div>
        <div style={{ position: "absolute", left: 420, top: 390, width: 136, height: 100, transform: "rotate(-.6deg)", borderRadius: 3, background: "#fbf8f2", boxShadow: "var(--shadow-object)", padding: "14px 14px 0 20px", boxSizing: "border-box" }}>
          <span style={{ position: "absolute", left: 10, top: 14, bottom: 14, width: 2, background: "rgba(120,100,82,.5)" }} />
          <SceneLine width="86%" tone={0.1} />
          <SceneLine width="92%" marginTop={8} />
          <SceneLine width="74%" marginTop={8} />
          <SceneLine width="60%" marginTop={8} />
        </div>
      </div>

      {/* 鼠尾草分区：设计定义卡、图片、便签 */}
      <div className="login-stage" style={{ width: 430, height: 400, margin: "52px 0 0 28px", background: "rgba(218,230,218,.28)", border: "1px solid rgba(125,151,128,.3)" }}>
        <span className="login-stage-label" style={{ width: 56, background: "rgba(79,110,84,.24)" }} />
        <div style={{ position: "absolute", left: 36, top: 58, width: 200, height: 142, borderRadius: "4px 10px 10px 4px", border: "1px solid rgba(78,68,58,.09)", borderLeft: "3px solid rgba(78,107,82,.45)", background: "#fffefb", boxShadow: "var(--shadow-object)", padding: 16, boxSizing: "border-box" }}>
          <SceneLine width="58%" height={7} tone={0.14} />
          <span style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <span style={{ flex: 1, height: 40, borderRadius: 4, border: "1px solid rgba(78,68,58,.1)", background: "rgba(247,245,241,.8)" }} />
            <span style={{ flex: 1, height: 40, borderRadius: 4, border: "1px solid rgba(78,68,58,.1)", background: "rgba(247,245,241,.8)" }} />
          </span>
          <SceneLine width="84%" marginTop={12} />
          <SceneLine width="66%" marginTop={7} />
        </div>
        <div style={{ position: "absolute", left: 252, top: 196, width: 146, transform: "rotate(1.8deg)" }}>
          <div style={{ width: 146, height: 96, borderRadius: 10, border: "1px solid rgba(78,68,58,.1)", background: "radial-gradient(circle at 50% 115%, rgba(255,217,135,.36), transparent 55%), linear-gradient(180deg, #e5ddcb, #bdb09a)", boxShadow: "var(--shadow-image)" }} />
          <SceneCaption chipWidth={28} lineWidth={62} />
        </div>
        <div style={{ position: "absolute", left: 60, top: 246, width: 112, height: 80, transform: "rotate(-.5deg)", borderRadius: 8, background: "#efeae2", boxShadow: "var(--shadow-object-soft)", padding: "14px 16px 0", boxSizing: "border-box" }}>
          <span style={{ display: "block", width: 28, height: 2, background: "rgba(78,68,58,.3)" }} />
          <SceneLine width="80%" tone={0.1} marginTop={11} />
          <SceneLine width="64%" marginTop={7} />
        </div>
      </div>
    </div>
  );
}

/** Image/collection caption skeleton: a small chip plus a title line. */
function SceneCaption({ chipWidth, lineWidth }: { chipWidth: number; lineWidth: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8, padding: "0 2px" }}>
      <span style={{ width: chipWidth, height: 12, borderRadius: 4, border: "1px solid rgba(78,68,58,.1)", background: "rgba(252,251,248,.88)" }} />
      <span style={{ width: lineWidth, height: 6, borderRadius: 3, background: "rgba(78,68,58,.14)" }} />
    </div>
  );
}

/** A single skeleton text line. */
function SceneLine({
  width,
  height = 5,
  tone = 0.08,
  marginTop = 0
}: {
  width: CSSProperties["width"];
  height?: number;
  tone?: number;
  marginTop?: number;
}) {
  return (
    <span
      style={{
        display: "block",
        width,
        height,
        marginTop,
        borderRadius: 3,
        background: `rgba(78,68,58,${tone})`
      }}
    />
  );
}
