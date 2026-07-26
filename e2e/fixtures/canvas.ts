import { expect, type Page } from "@playwright/test";

import { readStoredWorkspace, shapeSelector } from "./seed";

/**
 * Canvas interaction helpers.
 *
 * tldraw shapes carry `pointer-events: none`; the editor hit-tests geometry from
 * pointer events on its container. Playwright's `locator.click()` therefore
 * refuses to click a shape — it sees the stage-region layer under the cursor.
 * Driving the mouse at real coordinates is what a person does and what works.
 */

export async function shapeCentre(page: Page, objectId: string): Promise<{ x: number; y: number }> {
  const box = await page.locator(shapeSelector(objectId)).boundingBox();
  if (!box) {
    throw new Error(`Shape for ${objectId} is not laid out.`);
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Object cards auto-grow to fit their content shortly after mount, so a click
 * fired the instant the shape appears can land on a stale box. Wait for the
 * geometry to settle before measuring.
 */
async function settledShapeCentre(page: Page, objectId: string): Promise<{ x: number; y: number }> {
  await expect(page.locator(shapeSelector(objectId))).toBeVisible();
  let previous = await shapeCentre(page, objectId);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await page.waitForTimeout(150);
    const current = await shapeCentre(page, objectId);
    if (Math.abs(current.x - previous.x) < 0.5 && Math.abs(current.y - previous.y) < 0.5) {
      return current;
    }
    previous = current;
  }
  return previous;
}

export async function clickShape(page: Page, objectId: string): Promise<void> {
  const centre = await settledShapeCentre(page, objectId);
  await page.mouse.click(centre.x, centre.y);
}

/**
 * Clicks the shape and waits until the workspace records that exact selection.
 *
 * Checking only that a toolbar appeared is not enough: a click that lands on a
 * neighbouring card also produces a toolbar, and the test then drives the wrong
 * object. Under parallel load that is exactly what happens, so the selection
 * itself is the thing to wait on.
 */
export async function selectObject(page: Page, objectId: string, projectId?: string): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await clickShape(page, objectId);
    try {
      await expect
        .poll(async () => (await readStoredWorkspace(page, projectId)).ui.lastSelectionIds, { timeout: 4_000 })
        .toEqual([objectId]);
      await expect(page.locator('[aria-label="选中对象工具"]')).toBeVisible({ timeout: 4_000 });
      return;
    } catch {
      // The editor may still have been settling; measure again and retry.
    }
  }
  throw new Error(`Could not select ${objectId} on the canvas.`);
}

/**
 * A viewport point inside the canvas but outside every shape, stage region and
 * floating panel, so a click there is an unambiguous "clicked empty canvas".
 */
export async function emptyCanvasPoint(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    const canvas = document.querySelector(".tl-container");
    if (!canvas) {
      throw new Error("tldraw container is not mounted.");
    }
    const canvasRect = canvas.getBoundingClientRect();
    const blocked = Array.from(
      document.querySelectorAll(".tl-shape, .ai-panel, .ai-toggle, .ai-queue, .floating-cluster, .rail, .selection-toolbar")
    ).map((node) => node.getBoundingClientRect());

    for (let y = canvasRect.bottom - 24; y > canvasRect.top + 24; y -= 12) {
      for (let x = canvasRect.right - 24; x > canvasRect.left + 24; x -= 12) {
        const clear = blocked.every(
          (rect) => x < rect.left - 12 || x > rect.right + 12 || y < rect.top - 12 || y > rect.bottom + 12
        );
        if (clear) {
          return { x: Math.round(x), y: Math.round(y) };
        }
      }
    }
    throw new Error("No empty canvas point is reachable in this viewport.");
  });
}

export async function clickEmptyCanvas(page: Page): Promise<void> {
  const point = await emptyCanvasPoint(page);
  await page.mouse.click(point.x, point.y);
}
