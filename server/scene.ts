import { sceneSchema, type Board, type SceneNode, type BoardNode } from '../shared/scene'

const image = (n: number, title: string, x: number, y: number, width: number, height: number): SceneNode => ({ kind: 'image', id: `image-${n}`, asset: String(n).padStart(2, '0'), title, caption: 'Architecture & interiors · Collected on Unsplash', x, y, width, height })
const note = (id: string, title: string, body: string, x: number, y: number, tone: 'paper' | 'sage' | 'sand' = 'paper'): SceneNode => ({ kind: 'note', id, title, body, x, y, width: 270, height: 205, tone })
const board = (boardId: string, title: string, subtitle: string, x: number, y: number, width: number): BoardNode => ({ kind: 'board', id: `frame-${boardId}`, boardId, title, subtitle, x, y, width, height: 78 + (width - 36) / 1200 * 850 })
const boards: Board[] = [
  { id: 'home', title: 'Spaces worth saving', description: 'A study in quiet spaces, honest materials and the way light falls.', nodes: [
    board('living', 'Living spaces', 'Soft forms. Slow mornings.', 0, 0, 650),
    board('materials', 'Materials', 'An honest palette', 710, 0, 520),
    board('lighting', 'Lighting', 'Chasing the afternoon sun', 1290, 0, 520),
    image(1, 'A softer kind of space', 0, 570, 290, 220),
    image(2, 'Warm minimalism', 326, 570, 324, 270),
    image(3, 'Rooms to breathe', 710, 470, 240, 240),
    image(4, 'Everyday rituals', 986, 470, 244, 240),
    note('note-intent', 'Less, but warmer.', 'Natural light. Tactile surfaces. A little room to breathe.\n\nSpaces that feel lived in, not styled.', 1290, 470, 'sage'),
  ] },
  { id: 'living', title: 'Living spaces', description: 'Spaces for gathering, unwinding and doing absolutely nothing.', nodes: [
    image(5, 'Quiet conversation', 25, 25, 360, 285), image(6, 'The afternoon room', 420, 25, 320, 235), image(7, 'A place to pause', 780, 25, 375, 300),
    image(8, 'Layers of linen', 25, 350, 360, 260), image(9, 'Open and airy', 420, 300, 320, 260), image(10, 'Earth and light', 780, 365, 375, 250),
    image(11, 'Soft edges', 25, 650, 360, 170), image(12, 'Still life at home', 420, 600, 320, 220),
    note('note-living', 'Leave a little space', 'Low furniture, generous daylight, and a palette that lets the materials do the talking.', 800, 650, 'sand'),
  ] },
  { id: 'materials', title: 'Materials', description: 'Textures you want to reach out and touch. Warm, imperfect, enduring.', nodes: [
    board('timber', 'Forms & details', 'Shape, character & contrast', 20, 20, 650),
    image(13, 'Stone and shadow', 720, 20, 440, 270), image(14, 'A warm foundation', 720, 330, 440, 250),
    image(15, 'Honest surfaces', 20, 565, 290, 250), image(16, 'Quiet contrasts', 350, 565, 320, 250),
    image(17, 'Natural rhythm', 720, 620, 200, 195), image(18, 'Made to last', 955, 620, 205, 195),
  ] },
  { id: 'timber', title: 'Forms & details', description: 'A closer look at the shapes and objects that give a space its character.', nodes: [
    image(19, 'Lines against the sky', 25, 25, 350, 310), image(20, 'Natural simplicity', 415, 25, 350, 250), image(21, 'A sculptural accent', 805, 25, 350, 310),
    image(22, 'Quiet details', 25, 375, 350, 260), image(23, 'The collected corner', 415, 315, 350, 300), image(24, 'A lived-in palette', 805, 375, 350, 260),
    note('note-timber', 'A little character', 'Simple objects. A little greenery. A quiet room, and the things that make it yours.', 460, 650, 'sand'),
  ] },
  { id: 'lighting', title: 'Lighting', description: 'A collection of soft glows, sculptural forms and changing shadows.', nodes: [
    image(25, 'Sculptural light', 25, 25, 350, 310), image(26, 'Light as a material', 415, 25, 350, 260), image(27, 'A quiet glow', 805, 25, 350, 310),
    image(28, 'Golden hour', 25, 375, 350, 280), image(29, 'Pools of warmth', 415, 325, 350, 290), image(30, 'After the sun goes down', 805, 375, 350, 280),
    note('note-lighting', 'Set the mood', 'Layer a low glow with something sculptural. Keep the light warm, and the ceiling quiet.', 450, 650),
  ] },
]

export const demoScene = sceneSchema.parse({ version: 1, rootId: 'home', boards })
