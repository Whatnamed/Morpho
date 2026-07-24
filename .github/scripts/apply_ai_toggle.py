from pathlib import Path


def read_preserving_bom(path: Path) -> tuple[str, bool]:
    raw = path.read_bytes()
    has_bom = raw.startswith(b"\xef\xbb\xbf")
    return raw.decode("utf-8-sig"), has_bom


def write_preserving_bom(path: Path, text: str, has_bom: bool) -> None:
    payload = text.encode("utf-8")
    if has_bom:
        payload = b"\xef\xbb\xbf" + payload
    path.write_bytes(payload)


component_path = Path("src/features/workspace/components/AiConversationPanel.tsx")
component_source, component_bom = read_preserving_bom(component_path)
old_component = '''      <button className="ai-toggle" type="button" aria-label={isOpen ? "收起 AI" : "打开 AI"} onClick={onToggleOpen}>
        <div className="toggle-icon morpho-toggle-mark" aria-hidden="true">
          M
        </div>
      </button>'''
new_component = '''      <button className="ai-toggle" type="button" aria-label={isOpen ? "收起 AI" : "打开 AI"} onClick={onToggleOpen}>
        <div
          className={`toggle-icon morpho-toggle-mark${isOpen ? " is-open" : ""}`}
          role="img"
          aria-label="Morpho AI"
        >
          <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
            <g className="morpho-toggle-wing is-left">
              <path d="M9.35 5.25C7.15 5.72 5.48 7.32 4.85 9.55C5.47 11.83 7.16 13.58 9.45 14.35" />
            </g>
            <g className="morpho-toggle-wing is-right">
              <path d="M10.65 5.25C12.85 5.72 14.52 7.32 15.15 9.55C14.53 11.83 12.84 13.58 10.55 14.35" />
            </g>
            <path className="morpho-toggle-seam" d="M10 6.35V13.65" />
          </svg>
        </div>
      </button>'''
if component_source.count(old_component) != 1:
    raise SystemExit("Expected exactly one AI toggle monogram block")
component_source = component_source.replace(old_component, new_component)
write_preserving_bom(component_path, component_source, component_bom)

css_path = Path("src/app/globals.css")
css_source, css_bom = read_preserving_bom(css_path)
old_css = '''.morpho-toggle-mark {
  border: 1px solid rgba(78, 68, 58, 0.1);
  background: rgba(255, 255, 255, 0.58);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 680;
  letter-spacing: 0;
}'''
new_css = '''.morpho-toggle-mark {
  border: 1px solid rgba(78, 68, 58, 0.1);
  background: rgba(255, 255, 255, 0.58);
  color: var(--text-primary);
}

.morpho-toggle-mark svg {
  width: 19px;
  height: 19px;
  overflow: visible;
}

.morpho-toggle-wing,
.morpho-toggle-seam {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.morpho-toggle-wing {
  transform-box: fill-box;
  transform-origin: center;
  stroke-width: 1.55;
  transition:
    transform 200ms cubic-bezier(0.32, 0.72, 0, 1),
    opacity 160ms ease;
}

.morpho-toggle-wing.is-left {
  transform: translateX(0.35px) rotate(1.5deg);
}

.morpho-toggle-wing.is-right {
  transform: translateX(-0.35px) rotate(-1.5deg);
}

.morpho-toggle-seam {
  stroke-width: 1.25;
  opacity: 0.42;
  transition: opacity 160ms ease;
}

.ai-toggle:hover .morpho-toggle-wing.is-left {
  transform: translateX(-0.25px) rotate(-4deg);
}

.ai-toggle:hover .morpho-toggle-wing.is-right {
  transform: translateX(0.25px) rotate(4deg);
}

.morpho-toggle-mark.is-open .morpho-toggle-wing.is-left {
  transform: translateX(-0.7px) rotate(-7deg);
}

.morpho-toggle-mark.is-open .morpho-toggle-wing.is-right {
  transform: translateX(0.7px) rotate(7deg);
}

.morpho-toggle-mark.is-open .morpho-toggle-seam {
  opacity: 0.7;
}

@media (prefers-reduced-motion: reduce) {
  .morpho-toggle-wing,
  .morpho-toggle-seam {
    transition: none;
  }

  .morpho-toggle-wing.is-left,
  .morpho-toggle-wing.is-right,
  .ai-toggle:hover .morpho-toggle-wing.is-left,
  .ai-toggle:hover .morpho-toggle-wing.is-right,
  .morpho-toggle-mark.is-open .morpho-toggle-wing.is-left,
  .morpho-toggle-mark.is-open .morpho-toggle-wing.is-right {
    transform: none;
  }
}'''
if css_source.count(old_css) != 1:
    raise SystemExit("Expected exactly one Morpho toggle CSS block")
css_source = css_source.replace(old_css, new_css)
write_preserving_bom(css_path, css_source, css_bom)
