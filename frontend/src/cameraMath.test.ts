import { describe, expect, it } from "vitest";
import {
  FIT_PADDING,
  MAX_ZOOM,
  MIN_ZOOM,
  WHEEL_LINE_PIXELS,
  boardBounds,
  bookmarkCamera,
  cardBounds,
  clientPoint,
  fitCamera,
  intoChild,
  intoParent,
  restoreCamera,
  wheelPixels,
  zoomAt,
  type Camera,
  type Point,
} from "./cameraMath";

function worldAt(camera: Camera, screen: Point): Point {
  return { x: (screen.x - camera.x) / camera.scale, y: (screen.y - camera.y) / camera.scale };
}

describe("zoomAt", () => {
  it.each([
    [{ x: 115, y: -70, scale: 0.75 }, 1.8, { x: 416, y: 231 }, 1.8],
    [{ x: -260, y: 190, scale: 2 }, 0.5, { x: 73, y: 617 }, 0.5],
    [{ x: 190, y: -90, scale: 0.5 }, 0.01, { x: 333, y: 444 }, MIN_ZOOM],
    [{ x: -95, y: 145, scale: 1.5 }, 20, { x: 208, y: 82 }, MAX_ZOOM],
  ] satisfies [Camera, number, Point, number][])("preserves the point beneath an anchor", (camera, requestedScale, anchor, expectedScale) => {
    const before = worldAt(camera, anchor);
    const next = zoomAt(camera, requestedScale, anchor);
    expect(worldAt(next, anchor).x).toBeCloseTo(before.x);
    expect(worldAt(next, anchor).y).toBeCloseTo(before.y);
    expect(next.scale).toBe(expectedScale);
    expect(next.scale).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(next.scale).toBeLessThanOrEqual(MAX_ZOOM);
  });

  it("returns to the same camera after zooming in and out at one anchor", () => {
    const initial = { x: -110, y: 85, scale: 0.8 };
    const anchor = { x: 540, y: 180 };
    const roundTrip = zoomAt(zoomAt(initial, 1.6, anchor), initial.scale, anchor);
    expect(roundTrip.x).toBeCloseTo(initial.x);
    expect(roundTrip.y).toBeCloseTo(initial.y);
    expect(roundTrip.scale).toBe(initial.scale);
  });
});

describe("boardBounds and fitCamera", () => {
  it("uses root-local geometry and all direct card extents, including negative coordinates", () => {
    const root = { x: 700, y: -500, w: 1200, h: 800 };
    const bounds = boardBounds(root, [
      { x: -260, y: 100, w: 100, h: 100 },
      { x: 1300, y: -180, w: 240, h: 120 },
      { x: 20, y: 950, w: 150, h: 90 },
    ]);
    expect(bounds).toEqual({ minX: -260, minY: -180, maxX: 1540, maxY: 1040 });
    const rootAtAnotherPosition = { ...root, x: -999, y: 999 };
    expect(boardBounds(rootAtAnotherPosition, [])).toEqual({ minX: 0, minY: 0, maxX: 1200, maxY: 800 });
  });

  it("fits a landscape extent within a landscape viewport with padding", () => {
    const bounds = { minX: 0, minY: 0, maxX: 1200, maxY: 800 };
    const viewport = { width: 1440, height: 900 };
    const camera = fitCamera(bounds, viewport);
    expect(camera.scale).toBeCloseTo((viewport.height - 2 * FIT_PADDING) / 800);
    expect(camera.x + 600 * camera.scale).toBeCloseTo(viewport.width / 2);
    expect(camera.y + 400 * camera.scale).toBeCloseTo(viewport.height / 2);
  });

  it("centers a nonzero, negative extent in a portrait viewport", () => {
    const bounds = { minX: -240, minY: -120, maxX: 960, maxY: 1080 };
    const viewport = { width: 480, height: 900 };
    const camera = fitCamera(bounds, viewport);
    expect(camera.scale).toBeCloseTo((viewport.width - 2 * FIT_PADDING) / 1200);
    expect(camera.x + (bounds.minX + bounds.maxX) / 2 * camera.scale).toBeCloseTo(viewport.width / 2);
    expect(camera.y + (bounds.minY + bounds.maxY) / 2 * camera.scale).toBeCloseTo(viewport.height / 2);
  });

  it("handles root-only bounds and clamps both ends of Fit", () => {
    expect(fitCamera(boardBounds({ w: 400, h: 300 }, []), { width: 800, height: 600 }).scale).toBeCloseTo(1.68);
    expect(fitCamera({ minX: 0, minY: 0, maxX: 20, maxY: 20 }, { width: 900, height: 900 }).scale).toBe(MAX_ZOOM);
    expect(fitCamera({ minX: -2000, minY: -1000, maxX: 2000, maxY: 1000 }, { width: 10, height: 10 }).scale).toBe(MIN_ZOOM);
  });
});

describe("wheel geometry", () => {
  const viewport = { width: 800, height: 600 };

  it("normalizes pixel, line, and page deltas", () => {
    expect(wheelPixels({ x: 2, y: -3 }, 0, viewport)).toEqual({ x: 2, y: -3 });
    expect(wheelPixels({ x: 2, y: -3 }, 1, viewport)).toEqual({ x: 2 * WHEEL_LINE_PIXELS, y: -3 * WHEEL_LINE_PIXELS });
    expect(wheelPixels({ x: 2, y: -3 }, 2, viewport)).toEqual({ x: 1600, y: -1800 });
  });

  it("removes viewport border offsets from a client position", () => {
    expect(clientPoint({ x: 327, y: 248 }, { left: 100, top: 40, clientLeft: 2, clientTop: 3 })).toEqual({ x: 225, y: 205 });
  });
});

describe("board navigation geometry", () => {
  it.each([
    [{ x: -413, y: 97, scale: 0.35 }, { x: 920, y: 380 }, { x: 127, y: 56 }],
    [{ x: 221, y: -708, scale: 1.7 }, { x: -640, y: 270 }, { x: -89, y: 412 }],
    [{ x: -710, y: 317, scale: 3 }, { x: 340, y: -540 }, { x: 360, y: -100 }],
  ] satisfies [Camera, Point, Point][])("preserves a point's screen position across both coordinate handoffs", (parent, offset, point) => {
    const child = intoChild(parent, offset);
    const parentScreen = { x: parent.x + (offset.x + point.x) * parent.scale, y: parent.y + (offset.y + point.y) * parent.scale };
    expect(child.x + point.x * child.scale).toBeCloseTo(parentScreen.x);
    expect(child.y + point.y * child.scale).toBeCloseTo(parentScreen.y);
    expect(child.scale).toBe(parent.scale);
    const restored = intoParent(child, offset);
    expect(restored.x).toBeCloseTo(parent.x);
    expect(restored.y).toBeCloseTo(parent.y);
    expect(restored.scale).toBe(parent.scale);
  });

  it("uses the selected card for the handoff and the full child extent for the destination", () => {
    const board = { x: 920, y: 120, w: 520, h: 340 };
    const viewport = { width: 1200, height: 800 };
    const seam = fitCamera(cardBounds(board), viewport);
    const rebased = intoChild(seam, board);
    expect(rebased.x + board.w / 2 * rebased.scale).toBeCloseTo(viewport.width / 2);
    expect(rebased.y + board.h / 2 * rebased.scale).toBeCloseTo(viewport.height / 2);
    const bounds = boardBounds(board, [{ x: 920, y: 400, w: 430, h: 320 }]);
    const destination = fitCamera(bounds, viewport);
    expect(destination.scale).toBeLessThan(rebased.scale);
    expect(destination.x + bounds.maxX * destination.scale).toBeLessThanOrEqual(viewport.width - FIT_PADDING);
    expect(destination.y + bounds.maxY * destination.scale).toBeLessThanOrEqual(viewport.height - FIT_PADDING);
  });

  it("walks two local handoffs without accumulating a global scene position", () => {
    const initial = { x: -510, y: 230, scale: 0.65 };
    const child = { x: 920, y: 120 };
    const grandchild = { x: 920, y: -160 };
    const nested = intoChild(intoChild(initial, child), grandchild);
    const restored = intoParent(intoParent(nested, grandchild), child);
    expect(restored.x).toBeCloseTo(initial.x);
    expect(restored.y).toBeCloseTo(initial.y);
    expect(restored.scale).toBe(initial.scale);
  });
});

describe("parent camera bookmarks", () => {
  it.each([
    { x: -315, y: 126, scale: 0.65 },
    { x: 181, y: -493, scale: 2.4 },
  ])("restores the prior camera at the same viewport size", (camera) => {
    const viewport = { width: 1280, height: 720 };
    const restored = restoreCamera(bookmarkCamera(camera, viewport), viewport);
    expect(restored.x).toBeCloseTo(camera.x);
    expect(restored.y).toBeCloseTo(camera.y);
    expect(restored.scale).toBe(camera.scale);
  });

  it("keeps the saved board point centered at the same zoom after a resize", () => {
    const camera = { x: -300, y: 147, scale: 1.2 };
    const original = { width: 1200, height: 700 };
    const resized = { width: 800, height: 1100 };
    const bookmark = bookmarkCamera(camera, original);
    const restored = restoreCamera(bookmark, resized);
    expect(worldAt(restored, { x: resized.width / 2, y: resized.height / 2 })).toEqual(bookmark.center);
    expect(restored.scale).toBe(camera.scale);
    expect(restored.x).toBeCloseTo(camera.x + (resized.width - original.width) / 2);
    expect(restored.y).toBeCloseTo(camera.y + (resized.height - original.height) / 2);
  });
});
