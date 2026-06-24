import type { CanvasSize } from "./types";

export type ImageDimensions = {
  width?: number;
  height?: number;
  aspectRatio?: number;
};

const FALLBACK_IMAGE_SIZE: CanvasSize = { w: 245, h: 178 };
const SQUARE_IMAGE_SIZE = 240;
const MAX_IMAGE_WIDTH = 320;
const MAX_IMAGE_HEIGHT = 280;

export function getImageCanvasSize(dimensions: ImageDimensions): CanvasSize {
  const ratio = getUsableAspectRatio(dimensions);
  if (!ratio) {
    return FALLBACK_IMAGE_SIZE;
  }

  if (Math.abs(ratio - 1) < 0.01) {
    return { w: SQUARE_IMAGE_SIZE, h: SQUARE_IMAGE_SIZE };
  }

  if (ratio > 1) {
    const width = MAX_IMAGE_WIDTH;
    return {
      w: width,
      h: Math.round(width / ratio)
    };
  }

  const height = MAX_IMAGE_HEIGHT;
  return {
    w: Math.round(height * ratio),
    h: height
  };
}

function getUsableAspectRatio(dimensions: ImageDimensions): number | undefined {
  if (isPositiveFinite(dimensions.aspectRatio)) {
    return dimensions.aspectRatio;
  }

  if (isPositiveFinite(dimensions.width) && isPositiveFinite(dimensions.height)) {
    return dimensions.width / dimensions.height;
  }

  return undefined;
}

function isPositiveFinite(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}
