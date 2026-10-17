import { describe, expect, it } from "vitest"
import { ARROW_PAD, arrowEnds, arrowPatch, distToSegment, edgePoint } from "./arrows"
import { copyNodes, pasteOps } from "./clipboard"
import { Space, arrowBox, layout } from "./space"
import { indexScene } from "./scene"
import type { ArrowNode, Scene, SceneNode } from "./types"

const box = { x: 0, y: 0, w: 100, h: 50 }

describe("arrow geometry", () => {
  it("leaves a box on its edge, towards the target", () => {
    expect(edgePoint(box, { x: 500, y: 25 })).toEqual({ x: 100, y: 25 })
    expect(edgePoint(box, { x: 50, y: -300 })).toEqual({ x: 50, y: 0 })
  })

  it("stores ends relative to a padded box and reads them back", () => {
    const g = arrowPatch({ x: 10, y: 20 }, { x: 210, y: 20 })
    expect(g.h).toBeGreaterThanOrEqual(24)
    const n = { id: "a", type: "arrow", parentId: "r", x: g.x, y: g.y, w: g.w, h: g.h, content: { ...g.content } } as ArrowNode
    expect(arrowEnds(n, { x: g.x, y: g.y }, () => null)).toEqual([{ x: 10, y: 20 }, { x: 210, y: 20 }])
    expect(g.content.x1).toBe(ARROW_PAD)
  })

  it("attached ends sit on their items' edges and follow them", () => {
    const n = { id: "a", type: "arrow", parentId: "r", x: 0, y: 0, w: 24, h: 24, content: { x1: 0, y1: 0, x2: 10, y2: 0, from: "p", to: "q" } } as ArrowNode
    const boxes: Record<string, { x: number; y: number; w: number; h: number }> = { p: { x: 0, y: 0, w: 100, h: 100 }, q: { x: 400, y: 0, w: 100, h: 100 } }
    expect(arrowEnds(n, { x: 0, y: 0 }, (id) => boxes[id])).toEqual([{ x: 100, y: 50 }, { x: 400, y: 50 }])
    boxes.q = { x: 0, y: 400, w: 100, h: 100 }
    expect(arrowEnds(n, { x: 0, y: 0 }, (id) => boxes[id])).toEqual([{ x: 50, y: 100 }, { x: 50, y: 400 }])
  })

  it("an end whose item was deleted stays where it last was", () => {
    const n = { id: "a", type: "arrow", parentId: "r", x: 5, y: 5, w: 24, h: 24, content: { x1: 1, y1: 2, x2: 30, y2: 2, from: "gone", to: null } } as ArrowNode
    expect(arrowEnds(n, { x: 5, y: 5 }, () => null)).toEqual([{ x: 6, y: 7 }, { x: 35, y: 7 }])
  })

  it("measures distance to the line, for clicking it", () => {
    expect(distToSegment({ x: 50, y: 10 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(10)
    expect(distToSegment({ x: 130, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(30)
  })
})

describe("arrows on the canvas", () => {
  const scene = (): Scene => ({
    rootBoardId: "root",
    nodes: [
      { id: "root", type: "board", parentId: null, x: 0, y: 0, w: 10, h: 10, content: { title: "Root", frame: { x: 0, y: 0, w: 1300, h: 1100 } } },
      { id: "p", type: "note", parentId: "root", x: 0, y: 0, w: 100, h: 100, content: { title: "P", body: "" } },
      { id: "q", type: "note", parentId: "root", x: 2000, y: 0, w: 100, h: 100, content: { title: "Q", body: "" } },
      { id: "a", type: "arrow", parentId: "root", x: 0, y: 0, w: 24, h: 24, content: { x1: 0, y1: 0, x2: 10, y2: 0, from: "p", to: "q" } },
    ] as SceneNode[],
  })

  it("reaches as far as the items it joins (so it isn't culled while visible)", () => {
    const space = new Space(indexScene(scene()), "root")
    const b = arrowBox(space, space.node("a") as ArrowNode)
    expect(b.x).toBeLessThanOrEqual(100)
    expect(b.x + b.w).toBeGreaterThanOrEqual(2000)
    // Looking at the far end only, the arrow is still laid out.
    const lay = layout(space, { b: "root", s: 1, x: -1900, y: 0 }, { w: 800, h: 600 }, { x: 0, y: 0 }, false)
    expect(lay.items.some((p) => p.node.id === "a")).toBe(true)
  })

  it("copy and paste keeps ends on copied items and lets go of the rest", async () => {
    const space = new Space(indexScene(scene()), "root")
    const both = copyNodes(space, ["a", "p", "q"], null)!
    const { op } = await pasteOps(both, "root", 0, 0, null)
    const ops = op.type === "batch" ? op.ops : [op]
    const made = new Map(ops.map((o) => (o.type === "create" ? [o.node.content && (o.node as SceneNode).type, o.node] : [null, null])))
    const arrow = made.get("arrow") as ArrowNode
    const ids = ops.filter((o) => o.type === "create").map((o) => (o.type === "create" ? o.node.id : ""))
    expect(ids).toContain(arrow.content.from)
    expect(ids).toContain(arrow.content.to)
    expect(arrow.content.from).not.toBe("p")
    const alone = copyNodes(space, ["a"], null)!
    const one = (await pasteOps(alone, "root", 0, 0, null)).op
    const lone = (one.type === "batch" ? one.ops[0] : one) as { node: ArrowNode }
    expect([lone.node.content.from, lone.node.content.to]).toEqual([null, null])
  })
})
