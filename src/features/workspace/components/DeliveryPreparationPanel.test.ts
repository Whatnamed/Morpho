// @vitest-environment happy-dom

import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { addObjectsToDeliverySection } from "@/domain/morpho/deliveryPreparation";
import { createInitialWorkspace } from "@/domain/morpho/workspace";
import type { MorphoWorkspace } from "@/domain/morpho/types";
import { DeliveryPreparationPanel } from "./DeliveryPreparationPanel";

vi.mock("next/image", () => ({
  default: (props: ComponentProps<"img">) => createElement("img", props)
}));

type PanelProps = ComponentProps<typeof DeliveryPreparationPanel>;

const roots: Root[] = [];

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(async () => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root) {
      await act(async () => root.unmount());
    }
  }
  document.body.replaceChildren();
});

describe("DeliveryPreparationPanel", () => {
  it("submits the creation form, selects a package, and closes from the panel", async () => {
    const onCreateDelivery = vi.fn();
    const onSelectDelivery = vi.fn();
    const onClose = vi.fn();
    const { container } = await renderPanel(
      buildProps({
        onCreateDelivery,
        onSelectDelivery,
        onClose
      })
    );

    const title = query<HTMLInputElement>(container, 'input[aria-label="交付准备标题"]');
    setValue(title, "客户评审包");
    const format = query<HTMLSelectElement>(container, 'select[aria-label="交付形式"]');
    setValue(format, "board");

    await act(async () => {
      findButton(container, "新建").click();
    });
    expect(onCreateDelivery).toHaveBeenCalledWith({ title: "客户评审包", format: "board" });

    const packageRows = container.querySelectorAll<HTMLButtonElement>(".delivery-package-row");
    expect(packageRows).toHaveLength(2);
    await act(async () => {
      packageRows[1]?.click();
    });
    expect(onSelectDelivery).toHaveBeenCalledWith("delivery-ppt-six");

    await act(async () => {
      query<HTMLButtonElement>(container, 'button[aria-label="关闭交付准备"]').click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clears the local new-section fields after submitting a section", async () => {
    const onCreateSection = vi.fn();
    const onSelectDeliverySection = vi.fn();
    const { container } = await renderPanel(buildProps({ onCreateSection, onSelectDeliverySection }));

    const title = query<HTMLInputElement>(container, 'input[aria-label="新增章节标题"]');
    const purpose = query<HTMLTextAreaElement>(container, 'textarea[aria-label="新增章节目的"]');
    setValue(title, "使用场景");
    setValue(purpose, "说明产品在真实环境中的使用方式");

    const createButton = query<HTMLButtonElement>(container, ".delivery-section-create button");
    expect(createButton.disabled).toBe(false);
    await act(async () => {
      createButton.click();
    });

    expect(onCreateSection).toHaveBeenCalledWith({
      deliveryObjectId: "delivery-ppt-six",
      title: "使用场景",
      purpose: "说明产品在真实环境中的使用方式"
    });
    expect(onSelectDeliverySection).toHaveBeenCalledWith(null);
    expect(title.value).toBe("");
    expect(purpose.value).toBe("");
  });

  it("routes a selected section to the draft action and disables it without references or while streaming", async () => {
    const workspace = addReferenceToActiveSection(createInitialWorkspace());
    const onRequestSectionDraft = vi.fn();
    const { container } = await renderPanel(
      buildProps({
        workspace,
        onRequestSectionDraft
      })
    );

    const draftButton = findButton(container, "生成本节说明草稿");
    expect(draftButton.disabled).toBe(false);
    await act(async () => {
      draftButton.click();
    });
    expect(onRequestSectionDraft).toHaveBeenCalledWith({
      deliveryObjectId: "delivery-ppt-six",
      sectionId: "section-delivery-ppt-six-1"
    });

    const emptyWorkspace = createInitialWorkspace();
    const emptyRender = await renderPanel(
      buildProps({
        workspace: emptyWorkspace
      })
    );
    expect(findButton(emptyRender.container, "生成本节说明草稿").disabled).toBe(true);

    const streamingRender = await renderPanel(
      buildProps({
        workspace,
        isStreaming: true
      })
    );
    expect(findButton(streamingRender.container, "生成本节说明草稿").disabled).toBe(true);
  });

  it("emits a gap payload and clears the local gap input", async () => {
    const onAddGap = vi.fn();
    const { container } = await renderPanel(buildProps({ onAddGap }));
    const input = query<HTMLInputElement>(container, 'input[aria-label="待补内容"]');
    setValue(input, "补充安装示意图");

    const addButton = findButton(container, "添加");
    expect(addButton.disabled).toBe(false);
    await act(async () => {
      addButton.click();
    });

    expect(onAddGap).toHaveBeenCalledWith({
      deliveryObjectId: "delivery-ppt-six",
      sectionId: "section-delivery-ppt-six-1",
      label: "补充安装示意图"
    });
    expect(input.value).toBe("");
  });
});

function buildProps(overrides: Partial<PanelProps> = {}): PanelProps {
  return {
    workspace: createInitialWorkspace(),
    assetUrls: {},
    selectedObjects: [],
    activeDeliveryObjectId: "delivery-ppt-six",
    activeDeliverySectionId: "section-delivery-ppt-six-1",
    isStreaming: false,
    onClose: vi.fn(),
    onCreateDelivery: vi.fn(),
    onSelectDelivery: vi.fn(),
    onSelectDeliverySection: vi.fn(),
    onLocateObject: vi.fn(),
    onOpenDeliveryReferenceReader: vi.fn(),
    onAddSelectedObjects: vi.fn(),
    onCreateSection: vi.fn(),
    onUpdateSection: vi.fn(),
    onMoveSection: vi.fn(),
    onRemoveSection: vi.fn(),
    onMoveReference: vi.fn(),
    onRemoveReference: vi.fn(),
    onUpdateReferenceEditorial: vi.fn(),
    onRefreshReference: vi.fn(),
    onAddGap: vi.fn(),
    onSetGapStatus: vi.fn(),
    onRemoveGap: vi.fn(),
    onRequestSectionDraft: vi.fn(),
    onApplyDraft: vi.fn(),
    onDiscardDraft: vi.fn(),
    ...overrides
  };
}

function addReferenceToActiveSection(workspace: MorphoWorkspace): MorphoWorkspace {
  const sourceObject = Object.values(workspace.objects).find(
    (object) => object.type !== "delivery" && object.visibility === "active"
  );
  if (!sourceObject) {
    throw new Error("Expected an active source object in the delivery fixture.");
  }

  const result = addObjectsToDeliverySection(workspace, {
    deliveryObjectId: "delivery-ppt-six",
    sectionId: "section-delivery-ppt-six-1",
    sourceObjectIds: [sourceObject.id]
  });
  if (result.status !== "updated") {
    throw new Error(`Expected a delivery reference to be added: ${result.reason}`);
  }
  return result.workspace;
}

async function renderPanel(props: PanelProps): Promise<{ container: HTMLDivElement; root: Root }> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(createElement(DeliveryPreparationPanel, props));
  });
  return { container, root };
}

function query<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Expected ${selector}`);
  }
  return element;
}

function findButton(container: Element, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll<HTMLButtonElement>("button")].find((candidate) =>
    candidate.textContent?.includes(label)
  );
  if (!button) {
    throw new Error(`Expected button containing ${label}`);
  }
  return button;
}

function setValue(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}
