"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  memo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { ChevronDown, FileText, ImageIcon, Search, Wrench } from "lucide-react";

import type { AgentMessagePart, AgentTrace } from "@/domain/morpho/types";
import { getAgentTraceTitle, hasVisibleAgentTraceParts } from "../agentProcessUi";

const AUTO_CLOSE_DELAY_MS = 800;
const COLLAPSE_DURATION_MS = 200;
const NEAR_BOTTOM_PX = 36;
const renderDefaultText = (text: string) => <p>{text}</p>;

export function AgentProcessDisclosure({
  trace,
  renderText = renderDefaultText
}: {
  trace: AgentTrace;
  renderText?: (text: string) => ReactNode;
}) {
  const isStreaming = trace.status === "streaming";
  const hasVisibleParts = hasVisibleAgentTraceParts(trace);
  const [isOpen, setIsOpen] = useState(isStreaming);
  const [fadeState, setFadeState] = useState({ top: false, bottom: false });
  const manuallyToggledRef = useRef(false);
  const closeTimerRef = useRef<number | null>(null);
  const resizeFrameRef = useRef<number | null>(null);
  const nearBottomRef = useRef(true);
  const userScrolledRef = useRef(false);
  const rootRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const scrollLockCleanupRef = useRef<(() => void) | null>(null);
  const contentId = useId();
  const reducedMotion = usePrefersReducedMotion();

  const updateFadeState = useCallback(() => {
    const element = scrollRef.current;
    if (!element) {
      return;
    }
    const distanceFromBottom = Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop);
    const top = element.scrollTop > 3;
    const bottom = distanceFromBottom > 3;
    setFadeState((current) => (current.top === top && current.bottom === bottom ? current : { top, bottom }));
  }, []);

  const followLatest = useCallback(
    (force = false) => {
      const element = scrollRef.current;
      if (!element || !isOpen || (!force && !nearBottomRef.current)) {
        updateFadeState();
        return;
      }
      element.scrollTop = element.scrollHeight;
      nearBottomRef.current = true;
      updateFadeState();
    },
    [isOpen, updateFadeState]
  );

  const lockOuterScroll = useCallback(() => {
    scrollLockCleanupRef.current?.();
    const outer = rootRef.current?.closest<HTMLElement>(".ai-scroll");
    if (!outer) {
      return;
    }
    const scrollTop = outer.scrollTop;
    const restore = () => {
      outer.scrollTop = scrollTop;
    };
    outer.addEventListener("scroll", restore);
    const timeout = window.setTimeout(() => {
      outer.removeEventListener("scroll", restore);
      scrollLockCleanupRef.current = null;
    }, reducedMotion ? 0 : COLLAPSE_DURATION_MS);
    scrollLockCleanupRef.current = () => {
      window.clearTimeout(timeout);
      outer.removeEventListener("scroll", restore);
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (isStreaming) {
      if (!manuallyToggledRef.current) {
        setIsOpen(true);
      }
      return;
    }
    if (!manuallyToggledRef.current && isOpen) {
      closeTimerRef.current = window.setTimeout(() => {
        lockOuterScroll();
        setIsOpen(false);
      }, AUTO_CLOSE_DELAY_MS);
    }
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
    };
  }, [isOpen, isStreaming, lockOuterScroll]);

  useLayoutEffect(() => {
    if (!isOpen || !hasVisibleParts) {
      return;
    }
    if (resizeFrameRef.current !== null) {
      window.cancelAnimationFrame(resizeFrameRef.current);
    }
    resizeFrameRef.current = window.requestAnimationFrame(() => {
      followLatest(!userScrolledRef.current);
      resizeFrameRef.current = null;
    });
    return () => {
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
    };
  }, [followLatest, hasVisibleParts, isOpen, trace.parts]);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => followLatest(false));
    observer.observe(content);
    return () => observer.disconnect();
  }, [followLatest, hasVisibleParts]);

  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
      }
      scrollLockCleanupRef.current?.();
    },
    []
  );

  if (!isStreaming && !hasVisibleParts) {
    return null;
  }

  const title = getAgentTraceTitle(trace);
  return (
    <section
      className={`agent-process ${isStreaming ? "is-streaming" : ""} ${reducedMotion ? "is-reduced-motion" : ""}`}
      aria-label="Agent 过程"
      data-reduced-motion={reducedMotion ? "true" : "false"}
      ref={rootRef}
    >
      <button
        className="agent-process-trigger"
        type="button"
        aria-expanded={isOpen}
        aria-controls={hasVisibleParts ? contentId : undefined}
        onClick={() => {
          manuallyToggledRef.current = true;
          lockOuterScroll();
          setIsOpen((open) => !open);
        }}
      >
        <span className="agent-process-title-wrap" aria-live="polite" aria-atomic="true">
          <span className="agent-process-title">{title}</span>
          {isStreaming ? <span className="agent-process-title-shimmer" aria-hidden="true">{title}</span> : null}
        </span>
        <ChevronDown className={isOpen ? "is-open" : ""} size={14} aria-hidden="true" />
      </button>
      {hasVisibleParts ? (
        <div
          className={`agent-process-collapse ${isOpen ? "is-open" : "is-closed"}`}
          id={contentId}
          aria-hidden={!isOpen}
        >
          <div className="agent-process-collapse-inner">
            <div className="agent-process-viewport">
              <div
                className="agent-process-parts"
                ref={scrollRef}
                onScroll={() => {
                  const element = scrollRef.current;
                  if (!element) {
                    return;
                  }
                  userScrolledRef.current = true;
                  nearBottomRef.current =
                    element.scrollHeight - element.clientHeight - element.scrollTop <= NEAR_BOTTOM_PX;
                  updateFadeState();
                }}
              >
                <div className="agent-process-parts-content" ref={contentRef}>
                  {trace.parts.map((part) => (
                    <AgentProcessPart key={part.id} part={part} renderText={renderText} />
                  ))}
                </div>
              </div>
              <div className={`agent-process-fade is-top ${fadeState.top ? "is-visible" : ""}`} aria-hidden="true" />
              <div className={`agent-process-fade is-bottom ${fadeState.bottom ? "is-visible" : ""}`} aria-hidden="true" />
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

const AgentProcessPart = memo(function AgentProcessPart({
  part,
  renderText
}: {
  part: AgentMessagePart;
  renderText: (text: string) => ReactNode;
}) {
  if (part.type === "toolActivity") {
    const running = part.state === "running";
    return (
      <div
        className={`agent-process-activity ${running ? "is-running" : ""} ${part.state === "failed" ? "is-failed" : ""}`}
        data-state={part.state}
      >
        <AgentActivityIcon kind={part.activityKind} />
        <div className="agent-process-activity-copy">
          <span className="agent-process-activity-label-wrap">
            <span className="agent-process-activity-label">{part.label}</span>
            {running ? <span className="agent-process-activity-shimmer" aria-hidden="true">{part.label}</span> : null}
          </span>
          {part.detail ? <small>{part.detail}</small> : null}
        </div>
      </div>
    );
  }

  if (!part.text.trim()) {
    return null;
  }
  return <div className={`agent-process-text agent-process-${part.type}`}>{renderText(part.text)}</div>;
});

function AgentActivityIcon({ kind }: { kind: Extract<AgentMessagePart, { type: "toolActivity" }>["activityKind"] }) {
  if (kind === "webSearch") {
    return <Search size={13} aria-hidden="true" />;
  }
  if (kind === "fileRead" || kind === "contextRead") {
    return <FileText size={13} aria-hidden="true" />;
  }
  if (kind === "imageGeneration") {
    return <ImageIcon size={13} aria-hidden="true" />;
  }
  return <Wrench size={13} aria-hidden="true" />;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return reduced;
}
