import { describe, expect, it } from "vitest"
import { CameraEngine, lerpCam } from "./cameraEngine"
import { CARD_BOX, SPACE, TILT, cardBoxFactor, lodFor, perspectiveFor } from "./constants"
import { indexScene, pathTo, previewImages } from "./scene"
import { Space, covers, layerOf, layout, lift, localFromScreen, sortByLayer } from "./space"
import { SceneStore } from "./store"
import { layerOps, topRank } from "./layers"
import { SCENERY, THEMES, layerMarkup, placeLayers } from "./scenery"
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
  it("shows a board's contents on its face unless the board is tiny on screen", () => {
    const far = layout(space, { b: "root", s: 0.1, x: vp.w / 2, y: vp.h / 2 }, vp, { x: 0, y: 0 }, true)
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

describe("session edits", () => {
  it("re-parents a node and draws it in its new board", () => {
    const local = new Space(indexScene(structuredClone(scene)), "root")
    local.setParent("n", "a")
    expect(local.node("n")!.parentId).toBe("a")
    expect(local.index.children.get("root")!.some((c) => c.id === "n")).toBe(false)
    expect(local.index.children.get("a")!.some((c) => c.id === "n")).toBe(true)
  })

  it("removes a board with everything inside it", () => {
    const local = new Space(indexScene(structuredClone(scene)), "root")
    const removed = local.removeNode("a").map((n) => n.id).sort()
    expect(removed).toEqual(["a", "a1", "b", "b1"])
    expect(local.node("b1")).toBeUndefined()
  })

  it("localFromScreen inverts the depth projection", () => {
    const cam = { b: "root", s: 2, x: -100, y: 50 }
    const pointer = { x: 0.4, y: -0.3 }
    const z = 60
    const { g, dx, dy } = lift(z, cam.s, pointer, true)
    const local = { x: 123, y: 45 }
    const baseX = local.x * cam.s + cam.x, baseY = local.y * cam.s + cam.y
    const sx = vp.w / 2 + (baseX - vp.w / 2) * g + dx
    const sy = vp.h / 2 + (baseY - vp.h / 2) * g + dy
    const back = localFromScreen(cam, vp, z, sx, sy, pointer, true)
    expect(back.x).toBeCloseTo(local.x)
    expect(back.y).toBeCloseTo(local.y)
    expect(back.screenScale).toBeCloseTo(cam.s * g)
  })
})

describe("scenery", () => {
  it("every theme with layers generates deterministic markup", () => {
    for (const t of THEMES.filter((t) => t.layer)) {
      const a = layerMarkup(t, 7)
      expect(a.length).toBeGreaterThan(100)
      expect(layerMarkup(t, 7)).toBe(a)
    }
  })

  it("moving forward brings layers closer, and recycles them endlessly", () => {
    const at = (z: number) => placeLayers(z, 0, 0, { x: 0, y: 0 }, 3000, 800, false)
    const before = at(3).find((l) => l.n === 6)!
    const after = at(4).find((l) => l.n === 6)!
    expect(after.scale).toBeGreaterThan(before.scale)
    const deep = at(250)
    expect(deep.length).toBeGreaterThan(3)
    expect(deep.every((l) => l.n - 250 > SCENERY.near && l.n - 250 <= SCENERY.far)).toBe(true)
  })
})

describe("zooming stays anchored", () => {
  // World point (root frame) under a screen point.
  const worldAt = (s: Space, e: CameraEngine, px: number, py: number) => {
    const c = s.toFrame(e.target, "root")
    return { x: (px - c.x) / c.s, y: (py - c.y) / c.s }
  }

  it("zooming out past the limit with the pointer off-centre doesn't drift", () => {
    const e = new CameraEngine(space, vp, space.fit("root", vp))
    const px = vp.w * 0.85, py = vp.h * 0.3
    for (let i = 0; i < 200; i++) e.zoomAt(px, py, 0.8) // far past the minimum
    const a = worldAt(space, e, px, py)
    for (let i = 0; i < 200; i++) e.zoomAt(px, py, 0.8)
    const b = worldAt(space, e, px, py)
    expect(b.x).toBeCloseTo(a.x, 6)
    expect(b.y).toBeCloseTo(a.y, 6)
  })

  it("the point under the pointer stays put while zooming out (until the limit)", () => {
    const e = new CameraEngine(space, vp, space.fit("root", vp))
    const px = vp.w * 0.2, py = vp.h * 0.75
    const before = worldAt(space, e, px, py)
    for (let i = 0; i < 6; i++) e.zoomAt(px, py, 0.9)
    const after = worldAt(space, e, px, py)
    expect(after.x).toBeCloseTo(before.x, 6)
    expect(after.y).toBeCloseTo(before.y, 6)
  })

  it("the gliding display keeps the pointer's point fixed on every frame", () => {
    const e = new CameraEngine(space, vp, space.fit("root", vp))
    const px = vp.w * 0.9, py = vp.h * 0.1
    const at = () => {
      const c = space.toFrame(e.display, "root")
      return { x: (px - c.x) / c.s, y: (py - c.y) / c.s }
    }
    const start = at()
    for (let i = 0; i < 5; i++) e.zoomAt(px, py, 0.85)
    for (let f = 0; f < 90; f++) {
      e.tick(f * 16.7, 16.7)
      const p = at()
      expect(p.x).toBeCloseTo(start.x, 4)
      expect(p.y).toBeCloseTo(start.y, 4)
    }
  })

  it("can zoom out a long way", () => {
    const e = new CameraEngine(space, vp, space.fit("root", vp))
    for (let i = 0; i < 300; i++) e.zoomAt(vp.w / 2, vp.h / 2, 0.8)
    expect(e.target.s).toBeLessThan(space.fit("root", vp).s * 0.12)
  })
})

describe("layers", () => {
  const make = () => {
    const nodes: Scene["nodes"] = [
      { id: "root", type: "board", parentId: null, x: 0, y: 0, w: 10, h: 10, content: { title: "Root" } },
      { id: "p", type: "image", parentId: "root", x: 0, y: 0, w: 10, h: 10, content: { title: "p", src: "", alt: "" } },
      { id: "q", type: "image", parentId: "root", x: 0, y: 0, w: 10, h: 10, content: { title: "q", src: "", alt: "" } },
      { id: "r", type: "image", parentId: "root", x: 0, y: 0, w: 10, h: 10, content: { title: "r", src: "", alt: "" } },
    ]
    return new SceneStore({ space: { id: "s", title: "t", role: "owner", scenery: "studio", workspaceId: "" }, rootBoardId: "root", seq: 0, nodes, boardRoles: {} }, { local: true })
  }
  const order = (st: SceneStore) => sortByLayer(st.space.index.children.get("root")!).map((n) => n.id).join("")

  it("brings to front, sends to back, and steps one at a time", () => {
    const st = make()
    expect(order(st)).toBe("pqr")
    st.commit(layerOps(st.space, "p", "front")!)
    expect(order(st)).toBe("qrp")
    st.commit(layerOps(st.space, "p", "back")!)
    expect(order(st)).toBe("pqr")
    st.commit(layerOps(st.space, "p", "forward")!) // ties: renumbers the stack
    expect(order(st)).toBe("qpr")
    st.commit(layerOps(st.space, "p", "forward")!)
    expect(order(st)).toBe("qrp")
    st.commit(layerOps(st.space, "r", "backward")!)
    expect(order(st)).toBe("rqp")
    expect(layerOps(st.space, "p", "front")).toBeNull() // already on top
  })

  it("layer changes undo", () => {
    const st = make()
    st.commit(layerOps(st.space, "q", "front")!)
    expect(order(st)).toBe("prq")
    st.undo()
    expect(order(st)).toBe("pqr")
  })

  it("new things land on top", () => {
    const st = make()
    expect(topRank(st.space, "root")).toBeGreaterThan(Math.max(...st.space.index.children.get("root")!.map(layerOf)))
  })
})

describe("card tilt", () => {
  // Nearest a corner of a w×h card gets to the eye under a tilt (rotate about the centre,
  // lifted by `y` px), as a fraction of the perspective distance. ≥ 1 means behind the eye.
  const reach = (w: number, h: number, rx: number, ry: number, lift: number) => {
    const p = perspectiveFor(w, h)
    const a = (rx * Math.PI) / 180, b = (ry * Math.PI) / 180
    let worst = 0
    for (const [x, y] of [[-w / 2, -h / 2], [w / 2, -h / 2], [-w / 2, h / 2], [w / 2, h / 2]]) {
      // rotateX then rotateY; z toward the viewer is positive
      const z1 = -y * Math.sin(a)
      const z = x * Math.sin(b) + z1 * Math.cos(b)
      worst = Math.max(worst, (z + Math.abs(lift)) / p)
    }
    return worst
  }

  it("never brings a corner anywhere near the eye, however big the card", () => {
    for (const [w, h] of [[220, 290], [1200, 900], [6000, 7900], [20000, 20000]]) {
      expect(reach(w, h, TILT.hover.rotateX, TILT.hover.rotateY, TILT.hover.y)).toBeLessThan(0.15)
      expect(reach(w, h, TILT.drag.rotateX, 0, TILT.drag.y)).toBeLessThan(0.15)
    }
  })

  it("leaves normal-sized cards (prints and notes) exactly as before", () => {
    expect(perspectiveFor(200, 290)).toBe(900)
    expect(perspectiveFor(220, 190)).toBe(900)
  })
})

describe("card layout box", () => {
  it("never lets a card's own box exceed CARD_BOX, and keeps its on-screen size", () => {
    for (const [w, h] of [[200, 290], [1024, 700], [6000, 7900], [20000, 20000]]) {
      const f = cardBoxFactor({ type: "image", w, h })
      expect(Math.max(w / f, h / f)).toBeLessThanOrEqual(CARD_BOX + 1e-9)
      const s = 0.03
      expect((w / f) * (s * f)).toBeCloseTo(w * s) // same size on screen
    }
  })

  it("leaves normal cards and boards alone", () => {
    expect(cardBoxFactor({ type: "note", w: 220, h: 190 })).toBe(1)
    expect(cardBoxFactor({ type: "image", w: 220, h: 420 })).toBe(1)
    expect(cardBoxFactor({ type: "board", w: 9000, h: 9000 })).toBe(1)
  })
})

describe("fit board", () => {
  it("frames the cards themselves, not the board's original content window", () => {
    const nodes = [
      { id: "root", type: "board", parentId: null, x: 0, y: 0, w: 10, h: 10, content: { title: "Root", frame: { x: 0, y: 0, w: 1300, h: 1100 } } },
      { id: "far", type: "note", parentId: "root", x: 5000, y: 3000, w: 200, h: 200, content: { title: "Far", body: "" } },
    ]
    const space = new Space(indexScene({ ...structuredClone(scene), nodes } as Scene), "root")
    const vp = { w: 1000, h: 800 }
    const cam = space.fitContent("root", vp)
    // The note's centre lands at the centre of the fitted area.
    const cx = (5100 * cam.s + cam.x), cy = (3100 * cam.s + cam.y)
    const pad = SPACE.fitPad
    expect(cx).toBeCloseTo(pad.left + (vp.w - pad.left - pad.right) / 2, 3)
    expect(cy).toBeCloseTo(pad.top + (vp.h - pad.top - pad.bottom) / 2, 3)
  })
})

describe("undo with collaborators (Google Docs / Canva style)", () => {
  const make = () => {
    const nodes: Scene["nodes"] = [
      { id: "root", type: "board", parentId: null, x: 0, y: 0, w: 10, h: 10, content: { title: "Root" } },
      { id: "b", type: "board", parentId: "root", x: 500, y: 0, w: 360, h: 300, content: { title: "B" } },
      { id: "n", type: "note", parentId: "root", x: 10, y: 20, w: 220, h: 190, content: { title: "Mine", body: "hello" } },
    ]
    return new SceneStore({ space: { id: "s", title: "t", role: "owner", scenery: "studio", workspaceId: "" }, rootBoardId: "root", seq: 0, nodes, boardRoles: {} }, { local: true })
  }
  // What arrives from someone else (the store applies server changes like this).
  const remote = (st: SceneStore, id: string, patch: Record<string, unknown>) => {
    const n = st.space.node(id)!
    st.space.upsert({ ...n, ...patch, content: { ...n.content, ...((patch.content as object) ?? {}) } } as never)
  }

  it("undoing my move keeps someone else's later text edit", () => {
    const st = make()
    st.commit({ type: "update", id: "n", patch: { x: 300, y: 400 } })
    remote(st, "n", { content: { body: "edited by Mina" } })
    st.undo()
    const n = st.space.node("n")!
    expect([n.x, n.y]).toEqual([10, 20])
    expect((n.content as { body: string }).body).toBe("edited by Mina")
  })

  it("undoing my text edit keeps someone else's later move", () => {
    const st = make()
    st.commit({ type: "update", id: "n", patch: { content: { body: "mine" } } })
    remote(st, "n", { x: 999 })
    st.undo()
    const n = st.space.node("n")!
    expect((n.content as { body: string }).body).toBe("hello")
    expect(n.x).toBe(999)
  })

  it("skips quietly when a collaborator deleted the card, and doesn't bring it back", () => {
    const st = make()
    st.commit({ type: "update", id: "n", patch: { x: 300 } })
    st.space.removeNode("n")
    expect(st.undo()).toBeNull()
    expect(st.space.node("n")).toBeUndefined()
  })

  it("moving a card into a board undoes in one step, back to its board and place", () => {
    const st = make()
    st.commit({ type: "update", id: "n", patch: { parentId: "b", x: 5, y: 6 } })
    expect(st.space.node("n")!.parentId).toBe("b")
    st.undo()
    const n = st.space.node("n")!
    expect([n.parentId, n.x, n.y]).toEqual(["root", 10, 20])
    st.redo()
    expect(st.space.node("n")!.parentId).toBe("b")
  })

  it("a multi-item paste undoes as one action", () => {
    const st = make()
    const ops = Array.from({ length: 10 }, (_, i) => ({ type: "create" as const, node: { id: `p${i}`, type: "note" as const, parentId: "b", x: i, y: i, w: 100, h: 100, content: { title: "", body: `${i}` } } }))
    st.commit({ type: "batch", ops }, "paste")
    expect(st.space.index.children.get("b")!.length).toBe(10)
    expect(st.undo()).toBe("paste")
    expect(st.space.index.children.get("b") ?? []).toHaveLength(0)
  })

  it("undoing a delete restores a board with everything inside it", () => {
    const st = make()
    st.commit({ type: "create", node: { id: "k", type: "note", parentId: "b", x: 1, y: 1, w: 100, h: 100, content: { title: "", body: "kid" } } })
    st.commit({ type: "delete", id: "b" })
    expect(st.space.node("k")).toBeUndefined()
    st.undo()
    expect(st.space.node("b")).toBeDefined()
    expect(st.space.node("k")!.parentId).toBe("b")
  })
})

describe("one action, one undo step", () => {
  it("re-stacking several selected cards undoes together", () => {
    const nodes: Scene["nodes"] = [
      { id: "root", type: "board", parentId: null, x: 0, y: 0, w: 10, h: 10, content: { title: "Root" } },
      ...["p", "q", "r"].map((id) => ({ id, type: "image" as const, parentId: "root", x: 0, y: 0, w: 10, h: 10, content: { title: id, src: "", alt: "" } })),
    ]
    const st = new SceneStore({ space: { id: "s", title: "t", role: "owner", scenery: "studio", workspaceId: "" }, rootBoardId: "root", seq: 0, nodes, boardRoles: {} }, { local: true })
    const order = () => sortByLayer(st.space.index.children.get("root")!).map((n) => n.id).join("")
    st.group("bring to front", () => {
      for (const id of ["q", "p"]) st.commit(layerOps(st.space, id, "front")!, "bring to front")
    })
    expect(order()).toBe("rqp")
    expect(st.undo()).toBe("bring to front")
    expect(order()).toBe("pqr")
  })
})

describe("copy and paste", () => {
  it("pastes a nested board with new ids, keeps the arrangement, and undoes in one step", async () => {
    const { copyNodes, pasteOps } = await import("./clipboard")
    const nodes: Scene["nodes"] = [
      { id: "root", type: "board", parentId: null, x: 0, y: 0, w: 10, h: 10, content: { title: "Root" } },
      { id: "src", type: "board", parentId: "root", x: 0, y: 0, w: 360, h: 300, content: { title: "Src" } },
      { id: "dst", type: "board", parentId: "root", x: 900, y: 0, w: 360, h: 300, content: { title: "Dst" } },
      { id: "nb", type: "board", parentId: "src", x: 100, y: 100, w: 360, h: 300, content: { title: "Nested" } },
      { id: "k1", type: "note", parentId: "nb", x: 10, y: 20, w: 100, h: 100, content: { title: "", body: "a" } },
      { id: "k2", type: "note", parentId: "src", x: 500, y: 140, w: 100, h: 100, content: { title: "", body: "b" } },
    ]
    const st = new SceneStore({ space: { id: "s", title: "t", role: "owner", scenery: "studio", workspaceId: "" }, rootBoardId: "root", seq: 0, nodes, boardRoles: {} }, { local: true })
    const clip = copyNodes(st.space, ["nb", "k2"], null)!
    const { op, roots } = await pasteOps(clip, "dst", 600, 400, null)
    st.commit(op, "paste")
    const pasted = roots.map((id) => st.space.node(id)!)
    expect(pasted.every((n) => n.parentId === "dst" && !["nb", "k2"].includes(n.id))).toBe(true)
    // Relative arrangement is kept.
    const [b, n] = pasted
    expect([n.x - b.x, n.y - b.y]).toEqual([400, 40])
    // The nested board came with its contents; the originals are untouched.
    expect((st.space.index.children.get(b.id) ?? []).map((k) => (k.content as { body: string }).body)).toEqual(["a"])
    expect(st.space.node("k1")!.parentId).toBe("nb")
    st.undo()
    expect(st.space.index.children.get("dst") ?? []).toHaveLength(0)
  })
})
