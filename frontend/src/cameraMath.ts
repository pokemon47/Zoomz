import type { BoardNode, Scene } from "./api";

export type Point = { x: number; y: number };
export type Viewport = { width: number; height: number };
export type Camera = Point & { scale: number };
export type CameraBookmark = { center: Point; scale: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;
export const FIT_PADDING = 48;
export const BUTTON_ZOOM_STEP = 1.25;
export const WHEEL_ZOOM_SENSITIVITY = 0.002;
export const WHEEL_LINE_PIXELS = 16;
export const KEYBOARD_PAN_PIXELS = 48;

type Geometry = Pick<Scene["nodes"][number], "x" | "y" | "w" | "h">;

export function cardBounds(card: Geometry): Bounds {
  return { minX: card.x, minY: card.y, maxX: card.x + card.w, maxY: card.y + card.h };
}

export function intoChild(camera: Camera, child: Point): Camera {
  return { x: camera.x + camera.scale * child.x, y: camera.y + camera.scale * child.y, scale: camera.scale };
}

export function intoParent(camera: Camera, child: Point): Camera {
  return { x: camera.x - camera.scale * child.x, y: camera.y - camera.scale * child.y, scale: camera.scale };
}

export function bookmarkCamera(camera: Camera, viewport: Viewport): CameraBookmark {
  return {
    center: { x: (viewport.width / 2 - camera.x) / camera.scale, y: (viewport.height / 2 - camera.y) / camera.scale },
    scale: camera.scale,
  };
}

export function restoreCamera(bookmark: CameraBookmark, viewport: Viewport): Camera {
  return {
    x: viewport.width / 2 - bookmark.center.x * bookmark.scale,
    y: viewport.height / 2 - bookmark.center.y * bookmark.scale,
    scale: bookmark.scale,
  };
}

export function boardBounds(root: Pick<BoardNode, "w" | "h">, children: readonly Geometry[]): Bounds {
  return children.reduce<Bounds>(
    (bounds, child) => ({
      minX: Math.min(bounds.minX, child.x),
      minY: Math.min(bounds.minY, child.y),
      maxX: Math.max(bounds.maxX, child.x + child.w),
      maxY: Math.max(bounds.maxY, child.y + child.h),
    }),
    { minX: 0, minY: 0, maxX: root.w, maxY: root.h },
  );
}

export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

export function zoomAt(camera: Camera, requestedScale: number, anchor: Point): Camera {
  const scale = clampZoom(requestedScale);
  const ratio = scale / camera.scale;
  return {
    x: anchor.x - (anchor.x - camera.x) * ratio,
    y: anchor.y - (anchor.y - camera.y) * ratio,
    scale,
  };
}

export function fitCamera(bounds: Bounds, viewport: Viewport): Camera {
  const availableWidth = Math.max(1, viewport.width - FIT_PADDING * 2);
  const availableHeight = Math.max(1, viewport.height - FIT_PADDING * 2);
  const scale = clampZoom(Math.min(
    availableWidth / (bounds.maxX - bounds.minX),
    availableHeight / (bounds.maxY - bounds.minY),
  ));
  return {
    x: viewport.width / 2 - (bounds.minX + bounds.maxX) * scale / 2,
    y: viewport.height / 2 - (bounds.minY + bounds.maxY) * scale / 2,
    scale,
  };
}

export function wheelPixels(delta: Point, mode: number, viewport: Viewport): Point {
  return {
    x: delta.x * (mode === 1 ? WHEEL_LINE_PIXELS : mode === 2 ? viewport.width : 1),
    y: delta.y * (mode === 1 ? WHEEL_LINE_PIXELS : mode === 2 ? viewport.height : 1),
  };
}

export function clientPoint(
  point: Point,
  frame: { left: number; top: number; clientLeft: number; clientTop: number },
): Point {
  return {
    x: point.x - frame.left - frame.clientLeft,
    y: point.y - frame.top - frame.clientTop,
  };
}
