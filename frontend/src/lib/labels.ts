// Board labels (titles and descriptions) and photo labels (image titles and captions) can each
// be hidden, for a cleaner view. Saved per browser.

export type Labels = { boards: boolean; photos: boolean }

const KEY = { boards: "zoomz.labels.boards", photos: "zoomz.labels.photos" }

export function getLabels(): Labels {
  try {
    // The single "captions" switch this replaces turned both off.
    const legacyOff = localStorage.getItem("zoomz.captions") === "off"
    const read = (k: string) => {
      const v = localStorage.getItem(k)
      return v === null ? !legacyOff : v !== "off"
    }
    return { boards: read(KEY.boards), photos: read(KEY.photos) }
  } catch {
    return { boards: true, photos: true }
  }
}

export function saveLabels(l: Labels) {
  try {
    localStorage.removeItem("zoomz.captions")
    for (const k of ["boards", "photos"] as const) {
      if (l[k]) localStorage.removeItem(KEY[k])
      else localStorage.setItem(KEY[k], "off")
    }
  } catch {
    /* private mode: applies for this visit only */
  }
}
