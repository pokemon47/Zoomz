import { describe, expect, it } from "vitest"
import { lerpCam } from "./cameraEngine"
import { SPACE, lodFor } from "./constants"
import { indexScene, pathTo, previewImages } from "./scene"
import { Space, covers, layout } from "./space"
import type { Scene } from "./types"

const scene: Scene = {
  rootBoardId: "root",
  nodes: [
    { id: "root", type: "board", parentId: null, x: 0, y: 0, w: 10, h: 10, content: { title: "Root" } },
    { id: "a", type: "board", parentId: "root", x: 100, y: 80, w: 360, h: 330, content: { title: "A" } },
    { id: "a1", type: "image", parentId: "a", x: 0, y: 0, z: 30, w: 200, h: 290, content: { title: "i", src: "/api/assets/x.svg", alt: "x" } },
    { id: "b", type: "board", parentId: "a", x: 400, y: 0, w: 360, h: 330, content: { title: "B" } },
    { id: "b1", type: "image", parentId: "b", x: 0, y: 0, z: 20, w: 200, h: 290, content: { title: "j", src: "/api/assets/y.svg", alt: "y" } },
    { id: "n", type: "note", parentId: "root", x: 600, y: 500, z: 100, w: 220, h: 190, content: { title: "N", body: "body" } },
  ],
}
const vp = { w: 1200, h: 800 }
const index = indexScene(scene)
const space = new Space(index, "root")

/** Where a child-frame point lands on screen, computed from a camera in any frame. */
const screenOf = (cam: { s: number; x: number; y: number }, p: { x: number; y: number }) => ({ x: p.x * cam.s + cam.x, y: p.y * cam.s + cam.y })

describe("scene helpers", () => {
  it("builds the ancestor path for breadcrumbs", () => {
    expect(pathTo(index, "b").map((b) => b.id)).toEqual(["root", "a", "b"])
  })
  it("collects preview images from a board and its descendants", () => {
    expect(previewImages(index, "a").map((i) => i.id)).toEqual(["a1", "b1"])
  })
})

describe("nested frames", () => {
  it("toChild and toParent are inverses", () => {
    const cam = { b: "root", s: 2.5, x: -120, y: 40 }
    const down = space.toChild(cam, "a")
    const up = space.toParent(down)
    expect(up.b).toBe("root")
    expect(up.s).toBeCloseTo(cam.s)
    expect(up.x).toBeCloseTo(cam.x)
    expect(up.y).toBeCloseTo(cam.y)
  })

  it("a child's content sits inside its card face", () => {
    const f = space.frameOf("a")
    const cb = space.boundsOf("a")
    const tl = { x: f.ax + cb.x * f.k, y: f.ay + cb.y * f.k }
    const br = { x: tl.x + cb.w * f.k, y: tl.y + cb.h * f.k }
    expect(tl.x).toBeGreaterThanOrEqual(100)
    expect(tl.y).toBeGreaterThanOrEqual(80 + SPACE.faceHeader - 0.001)
    expect(br.x).toBeLessThanOrEqual(100 + 360 + 0.001)
    expect(br.y).toBeLessThanOrEqual(80 + 330 + 0.001)
  })

  it("re-anchors into a board once its card covers the viewport, without moving anything", () => {
    // Camera in root frame zoomed so card A covers the viewport.
    const s = 6
    const cam = { b: "root", s, x: vp.w / 2 - (100 + 180) * s, y: vp.h / 2 - (80 + 165) * s }
    expect(covers(space.cardRect(cam, index.byId.get("a")!), vp)).toBe(true)
    const n = space.normalize(cam, vp)
    expect(n.b).toBe("a")
    // The same child point is at the same screen spot either way.
    const f = space.frameOf("a")
    const viaRoot = screenOf(cam, { x: f.ax + 50 * f.k, y: f.ay + 70 * f.k })
    const viaChild = screenOf(n, { x: 50, y: 70 })
    expect(viaChild.x).toBeCloseTo(viaRoot.x)
    expect(viaChild.y).toBeCloseTo(viaRoot.y)
  })

  it("re-anchors back out when the board no longer covers the viewport", () => {
    const fit = space.fit("a", vp)
    const out = space.normalize({ ...fit, s: fit.s * 0.2 }, vp)
    expect(out.b).toBe("root")
  })

  it("can express any camera in any board's frame", () => {
    const cam = { b: "b", s: 3, x: 10, y: 20 }
    const inRoot = space.toFrame(cam, "root")
    expect(inRoot.b).toBe("root")
    const back = space.toFrame(inRoot, "b")
    expect(back.s).toBeCloseTo(3)
    expect(back.x).toBeCloseTo(10)
    expect(space.globalScale(cam)).toBeCloseTo(inRoot.s)
  })
})

describe("depth layout", () => {
  it("draws a board's contents on its face only once it is big enough", () => {
    const rootFit = space.fit("root", vp)
    const far = layout(space, { ...rootFit, s: rootFit.s * 0.25, x: vp.w / 2, y: vp.h / 2 }, vp, { x: 0, y: 0 }, true)
    const near = layout(space, space.fit("a", vp), vp, { x: 0, y: 0 }, true)
    expect(far.items.some((i) => i.node.id === "a1")).toBe(false)
    expect(near.items.some((i) => i.node.id === "a1")).toBe(true)
    expect(near.focus).toBe("a")
  })

  it("raised things grow faster than the floor and fly past when very close", () => {
    const fit = space.fit("root", vp)
    const at = (k: number) => layout(space, { ...fit, s: fit.s * k }, vp, { x: 0, y: 0 }, true).items.find((i) => i.node.id === "n")
    const near = at(1.5)
    expect(near!.g).toBeGreaterThan(1)
    const g1 = at(1)!.g
    expect(near!.g).toBeGreaterThan(g1)
    // Close enough that the note's height reaches the eye: it is gone.
    const s = (SPACE.eye / 100) * 0.95
    const passed = layout(space, { b: "root", s, x: 0, y: 0 }, vp, { x: 0, y: 0 }, true).items.find((i) => i.node.id === "n")
    expect(passed).toBeUndefined()
  })
})

describe("camera interpolation", () => {
  it("lerpCam hits both ends and zooms uniformly in log space", () => {
    const a = { b: "root", s: 1, x: 0, y: 0 }
    const b = { b: "root", s: 16, x: -500, y: -300 }
    expect(lerpCam(a, b, 0, vp).s).toBeCloseTo(1)
    expect(lerpCam(a, b, 1, vp).x).toBeCloseTo(-500)
    expect(lerpCam(a, b, 0.5, vp).s).toBeCloseTo(4)
  })
})

describe("level of detail", () => {
  it("is decided by on-screen size", () => {
    expect(lodFor("image", 60)).toBe("far")
    expect(lodFor("image", 200)).toBe("medium")
    expect(lodFor("image", 500)).toBe("close")
    expect(lodFor("note", 260)).toBe("close")
  })
})
