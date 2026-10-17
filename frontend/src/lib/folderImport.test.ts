import { describe, expect, it } from "vitest"
import { IMPORT_GRID, countFiles, fileCard, planFolder, type FolderTree } from "./folderImport"

const file = (name: string, type = "image/png") => new File(["x"], name, { type })

describe("folder import layout", () => {
  const tree: FolderTree = {
    name: "Trip",
    files: [file("a.png"), file("b.png"), file("notes.pdf", "application/pdf")],
    folders: [
      { name: "Day 1", files: [file("c.png")], folders: [{ name: "Beach", files: [file("d.png"), file("e.png")], folders: [] }] },
      { name: "Day 2", files: [], folders: [] },
    ],
  }

  it("mirrors the folder structure", () => {
    const p = planFolder(tree)
    expect(countFiles(tree)).toBe(6)
    expect(p.folders.map((f) => f.plan.name)).toEqual(["Day 1", "Day 2"])
    expect(p.folders[0].plan.folders[0].plan.files).toHaveLength(2)
  })

  it("keeps every card inside its board's content window, without overlaps", () => {
    const check = (p: ReturnType<typeof planFolder>) => {
      const rects = [
        ...p.folders.map((f) => ({ x: f.x, y: f.y, w: f.plan.w, h: f.plan.h })),
        ...p.fileCells.map((c) => ({ ...c, w: IMPORT_GRID.fileCellW, h: IMPORT_GRID.fileCellH })),
      ]
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(0)
        expect(r.y).toBeGreaterThanOrEqual(0)
        expect(r.x + r.w).toBeLessThanOrEqual(p.frame.w)
        expect(r.y + r.h).toBeLessThanOrEqual(p.frame.h)
      }
      for (const [i, a] of rects.entries())
        for (const b of rects.slice(i + 1)) expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y).toBe(true)
      // A board's card has the same shape as its content window, so its face isn't distorted.
      expect(p.h / p.w).toBeCloseTo(p.frame.h / p.frame.w, 2)
      p.folders.forEach((f) => check(f.plan))
    }
    check(planFolder(tree))
    check(planFolder({ name: "Big", files: Array.from({ length: 40 }, (_, i) => file(`${i}.png`)), folders: [] }))
  })

  it("fits tall images into a cell", () => {
    const { h } = fileCard(file("tall.png"), 3)
    expect(h).toBeLessThanOrEqual(IMPORT_GRID.fileCellH)
    expect(fileCard(file("wide.png"), 0.5)).toEqual({ w: 220, h: Math.round(12 + 208 * 0.5) })
  })
})

describe("image cards keep the picture's true shape", () => {
  it("sizes panoramas and tall shots exactly, without clamping", async () => {
    const { imageCard } = await import("./store")
    for (const r of [0.1, 0.25, 0.5, 1, 1.78, 3, 8]) {
      const { w, h } = imageCard(r)
      // An even 6px mat on every side around a picture of exactly this shape.
      expect((h - 12) / (w - 12)).toBeCloseTo(r, 1)
      expect(h).toBeLessThanOrEqual(421)
    }
  })
})
