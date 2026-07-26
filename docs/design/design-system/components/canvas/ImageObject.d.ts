import * as React from 'react';

/**
 * @startingPoint section="Canvas objects" subtitle="Image-first canvas object with floating caption" viewport="700x320"
 */
export interface ImageObjectProps {
  /** 参考图 · 预览 · 概念图 · 主视觉 · 场景视觉 · CMF 研究 · 细节研究 · 结构示意 · 交互示意 · 交付素材 */
  role?: React.ReactNode;
  title?: React.ReactNode;
  src?: string;
  alt?: string;
  /** Images keep their own aspect; the object resizes with the shape. */
  width?: number;
  height?: number;
  /** Shows the 局部编辑中 annotation ring. */
  editing?: boolean;
  /** <ProductVisual /> when no asset exists. */
  children?: React.ReactNode;
  style?: React.CSSProperties;
}

export declare function ImageObject(props: ImageObjectProps): JSX.Element;
