// Colours for notes and boards: two neutrals (white, dark grey) and the house palette.
// Each has a face, a darker side (the slab's edge) and the ink that reads on it.

export type CardColorId = "lemon" | "white" | "graphite" | "tomato" | "peach" | "mint" | "sky" | "lilac" | "pink"
export type CardColor = { id: CardColorId; name: string; face: string; side: string; ink: string }

export const CARD_COLORS: CardColor[] = [
  { id: "lemon", name: "Lemon", face: "#FFD56E", side: "#E8B84A", ink: "#17131F" },
  { id: "white", name: "White", face: "#FFFFFF", side: "#D8D2CA", ink: "#17131F" },
  { id: "graphite", name: "Dark grey", face: "#3A3640", side: "#211E26", ink: "#F7F2EA" },
  { id: "tomato", name: "Tomato", face: "#FF8E72", side: "#DE6D51", ink: "#17131F" },
  { id: "peach", name: "Peach", face: "#FFC9A8", side: "#E9A780", ink: "#17131F" },
  { id: "mint", name: "Mint", face: "#72D9A9", side: "#4DB585", ink: "#17131F" },
  { id: "sky", name: "Sky", face: "#9DBBFF", side: "#7193E6", ink: "#17131F" },
  { id: "lilac", name: "Lilac", face: "#C7AEFF", side: "#A386E8", ink: "#17131F" },
  { id: "pink", name: "Pink", face: "#FFA6C9", side: "#E57FA7", ink: "#17131F" },
]

export const colorById = (id: string | null | undefined): CardColor | undefined => CARD_COLORS.find((c) => c.id === id)
