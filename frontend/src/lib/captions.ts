// Captions on images and boards can be hidden for a clean, pictures-only view. Saved per browser.

const KEY = "zoomz.captions"

export function getCaptions(): boolean {
  try {
    return localStorage.getItem(KEY) !== "off"
  } catch {
    return true
  }
}

export function saveCaptions(on: boolean) {
  try {
    if (on) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, "off")
  } catch {
    /* private mode: applies for this visit only */
  }
}
