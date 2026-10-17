import { describe, expect, it } from "vitest"
import { LOD_THRESHOLDS, lodForScale } from "./constants"
import { boundsOf, indexScene, pathTo, previewImages } from "./scene"
import type { Scene } from "./types"

const scene: Scene = {
  rootBoardId: "root",
  nodes: [
    { id: "root", type: "board", parentId: null, x: 0, y: 0, w: 10, h: 10, content: { title: "Root" } },
    { id: "a", type: "board", parentId: "root", x: 10, y: 20, w: 100, h: 50, content: { title: "A" } },
    { id: "a1", type: "image", parentId: "a", x: 0, y: 0, w: 10, h: 10, content: { title: "i", src: "/api/assets/x.svg", alt: "x" } },
    { id: "b", type: "board", parentId: "a", x: 0, y: 0, w: 10, h: 10, content: { title: "B" } },
    { id: "b1", type: "image", parentId: "b", x: 0, y: 0, w: 10, h: 10, content: { title: "j", src: "/api/assets/y.svg", alt: "y" } },
    { id: "n", type: "note", parentId: "root", x: -40, y: 200, w: 20, h: 30, content: { title: "N", body: "body" } },
  ],
}

describe("scene helpers", () => {
  const index = indexScene(scene)

  it("builds the ancestor path for breadcrumbs", () => {
    expect(pathTo(index, "b").map((b) => b.id)).toEqual(["root", "a", "b"])
    expect(pathTo(index, "root").map((b) => b.id)).toEqual(["root"])
  })

  it("collects preview images from a board and its descendants", () => {
    expect(previewImages(index, "a").map((i) => i.id)).toEqual(["a1", "b1"])
  })

  it("computes local bounds of a board's children", () => {
    expect(boundsOf(index.children.get("root")!)).toEqual({ x: -40, y: 20, w: 150, h: 210 })
  })
})

describe("semantic zoom", () => {
  it("maps scale to far / medium / close", () => {
    expect(lodForScale(LOD_THRESHOLDS.far - 0.01)).toBe("far")
    expect(lodForScale(1)).toBe("medium")
    expect(lodForScale(LOD_THRESHOLDS.close + 0.01)).toBe("close")
  })
})
