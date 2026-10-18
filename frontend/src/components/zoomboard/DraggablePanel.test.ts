import { describe, expect, it } from "vitest"
import { clampToViewport } from "./DraggablePanel"

describe("floating panels stay on screen", () => {
  it("keeps a panel fully inside the viewport with a margin", () => {
    expect(clampToViewport(-500, -20, 200, 60, 1000, 800)).toEqual({ left: 8, top: 8 })
    expect(clampToViewport(990, 790, 200, 60, 1000, 800)).toEqual({ left: 792, top: 732 })
    expect(clampToViewport(300, 300, 200, 60, 1000, 800)).toEqual({ left: 300, top: 300 })
  })
  it("pulls a remembered spot back in after the window shrinks", () => {
    // Saved at x=1400 on a wide screen; now the window is 900 wide.
    expect(clampToViewport(1400, 100, 240, 50, 900, 700).left).toBe(900 - 240 - 8)
  })
  it("keeps the grip reachable when the panel is larger than the screen", () => {
    expect(clampToViewport(50, 50, 1200, 900, 800, 600)).toEqual({ left: 8, top: 8 })
  })
})
