"use client";

import { MessageCircle, Upload } from "lucide-react";

type WorkspaceStarterProps = {
  onStartChat: () => void;
  onImport: () => void;
};

/**
 * Low-pressure first screen for a blank project. It disappears as soon as the
 * canvas has any active object or the conversation has begun; drops and paste
 * keep working because the shell never captures pointer events.
 */
export function WorkspaceStarter({ onStartChat, onImport }: WorkspaceStarterProps) {
  return (
    <div className="workspace-starter" role="note" aria-label="开始一个新项目">
      <div className="workspace-starter-card">
        <span className="workspace-starter-kicker">新项目</span>
        <h2>从任何东西开始</h2>
        <p>一句想法、一张参考图、一个文件或链接，都可以直接放进这张画布。</p>
        <div className="workspace-starter-actions">
          <button className="brand-button" type="button" onClick={onStartChat}>
            <MessageCircle size={15} />
            开始对话
          </button>
          <button className="plain-button" type="button" onClick={onImport}>
            <Upload size={14} />
            导入资料
          </button>
        </div>
        <p className="workspace-starter-hint">也可以直接粘贴（Ctrl + V）图片或文字，或把文件拖进画布任意位置。</p>
      </div>
    </div>
  );
}
