import { describe, expect, it } from "vitest"
import { SEE_THROUGH_ENABLED, boardLook, noteLook } from "./fills"

describe("board and note fills", () => {
  it("plain boards are the background's own colour, solid", () => {
    expect(boardLook({})).toMatchObject({ fill: "plain", surface: "var(--depth-0)" })
  })
  it("outline keeps the plain surface and colours the rim; full tints the surface too", () => {
    const o = boardLook({ color: "mint", fill: "outline" })
    expect(o.surface).toBe("var(--depth-0)")
    expect(o.rim).toBe("#72D9A9")
    const f = boardLook({ color: "mint", fill: "full" })
    expect(f.surface).toContain("color-mix")
    expect(f.rim).toBe("#4DB585") // the deep tone
  })
  it("a colour from before fills existed means full colour", () => {
    expect(boardLook({ color: "sky" }).fill).toBe("full")
  })
  it.skipIf(!SEE_THROUGH_ENABLED)("glass and clear are see-through, without a colour", () => {
    expect(boardLook({ fill: "glass" }).fill).toBe("glass")
    expect(boardLook({ fill: "glass", color: "mint" }).color).toBeUndefined()
    expect(boardLook({ fill: "clear" }).surface).toBe("transparent")
  })
  it("notes are lemon by default", () => {
    expect(noteLook({})).toMatchObject({ fill: "full", color: { id: "lemon" } })
  })
  it.skipIf(SEE_THROUGH_ENABLED)("while glass and clear are switched off, they show as plain", () => {
    expect(boardLook({ fill: "glass" }).fill).toBe("plain")
    expect(boardLook({ fill: "clear", color: "mint" }).fill).toBe("plain")
    expect(noteLook({ fill: "glass" }).fill).toBe("full")
  })
})
