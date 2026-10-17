import { z } from "zod";

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();

export const API_BASE_URL = (configuredBaseUrl || "/api").replace(/\/+$/, "");

const nodeBase = {
  id: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite().positive(),
  h: z.number().finite().positive(),
};

const boardSchema = z.object({
  ...nodeBase,
  type: z.literal("board"),
  content: z.object({ title: z.string().min(1), description: z.string().nullish() }),
});

const imageSchema = z.object({
  ...nodeBase,
  type: z.literal("image"),
  content: z.object({
    title: z.string().min(1),
    src: z.string().startsWith("/assets/"),
    alt: z.string().min(1),
  }),
});

const noteSchema = z.object({
  ...nodeBase,
  type: z.literal("note"),
  content: z.object({ title: z.string().min(1), body: z.string().min(1) }),
});

const sceneSchema = z.object({
  rootBoardId: z.string().min(1),
  nodes: z.array(z.discriminatedUnion("type", [boardSchema, imageSchema, noteSchema])),
});

export type Scene = z.infer<typeof sceneSchema>;
export type BoardNode = z.infer<typeof boardSchema>;
export type ImageNode = z.infer<typeof imageSchema>;
export type NoteNode = z.infer<typeof noteSchema>;
export type DemoBoard = { scene: Scene; rootBoard: BoardNode };

export async function fetchDemoBoard(signal: AbortSignal): Promise<DemoBoard> {
  const response = await fetch(`${API_BASE_URL}/demo-board`, { signal });
  if (!response.ok) throw new Error(`Board request failed (${response.status}).`);

  const payload: unknown = await response.json();
  const scene = sceneSchema.parse(payload);
  const rootBoard = scene.nodes.find(
    (node): node is BoardNode =>
      node.id === scene.rootBoardId && node.type === "board" && node.parentId === null,
  );
  if (!rootBoard) throw new Error("The scene has no valid root board.");

  return { scene, rootBoard };
}
