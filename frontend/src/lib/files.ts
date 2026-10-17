import { File, FileArchive, FileAudio, FileSpreadsheet, FileText, FileType, Presentation } from "lucide-react"

type Kind = { label: string; tone: string; Icon: typeof File }

/** Colour lives on things you can act on: each file type gets a toy colour. */
export function fileKind(mime: string, name: string): Kind {
  const ext = name.split(".").pop()?.toLowerCase() ?? ""
  if (mime === "application/pdf" || ext === "pdf") return { label: "PDF", tone: "zb-tomato", Icon: FileText }
  if (mime.startsWith("video/")) return { label: ext.toUpperCase() || "VIDEO", tone: "zb-cobalt", Icon: File }
  if (mime.startsWith("audio/")) return { label: ext.toUpperCase() || "AUDIO", tone: "zb-lilac", Icon: FileAudio }
  if (/sheet|excel|csv/.test(mime) || ["xls", "xlsx", "csv", "numbers"].includes(ext)) return { label: ext.toUpperCase(), tone: "zb-mint", Icon: FileSpreadsheet }
  if (/presentation|powerpoint|keynote/.test(mime) || ["ppt", "pptx", "key"].includes(ext)) return { label: ext.toUpperCase(), tone: "zb-tomato", Icon: Presentation }
  if (/zip|compressed|tar/.test(mime) || ["zip", "rar", "7z", "gz"].includes(ext)) return { label: ext.toUpperCase(), tone: "zb-lilac", Icon: FileArchive }
  if (/font/.test(mime) || ["ttf", "otf", "woff", "woff2"].includes(ext)) return { label: ext.toUpperCase(), tone: "zb-lemon", Icon: FileType }
  if (mime.startsWith("text/") || ["doc", "docx", "md", "txt", "pages", "rtf"].includes(ext)) return { label: ext.toUpperCase() || "TEXT", tone: "zb-cobalt", Icon: FileText }
  return { label: ext.toUpperCase() || "FILE", tone: "zb-lemon", Icon: File }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
