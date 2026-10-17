import { useState, type FormEvent } from "react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "./Button"

export type CreateKind = "note" | "board"

type Props = {
  kind: CreateKind | null
  /** Board the new thing will land in. */
  where: string
  onClose(): void
  onCreate(kind: CreateKind, title: string, body: string): void
}

/** Small form for a new note or board; restyled shadcn dialog (matte face, lift shadow). */
export function CreateDialog({ kind, where, onClose, onCreate }: Props) {
  return (
    <Dialog open={kind !== null} onOpenChange={(open) => !open && onClose()}>
      {kind && <DialogBody key={kind} kind={kind} where={where} onClose={onClose} onCreate={onCreate} />}
    </Dialog>
  )
}

function DialogBody({ kind, where, onClose, onCreate }: Props & { kind: CreateKind }) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const submit = (e: FormEvent) => {
    e.preventDefault()
    onCreate(kind, title.trim() || (kind === "note" ? "Note" : "New board"), body.trim())
  }
  return (
    <DialogContent className="zb-dialog" showCloseButton={false}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        <DialogHeader>
          <DialogTitle className="zb-dialog-title">{kind === "note" ? "New note" : "New board"}</DialogTitle>
          <DialogDescription>Goes into {where}. You can drag it anywhere afterwards.</DialogDescription>
        </DialogHeader>
        <label className="zb-field">
          <span>Title</span>
          <input autoFocus value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} placeholder={kind === "note" ? "Shoot day" : "Moodboard"} />
        </label>
        <label className="zb-field">
          <span>{kind === "note" ? "Note" : "Description (optional)"}</span>
          <textarea value={body} rows={kind === "note" ? 4 : 2} maxLength={280} onChange={(e) => setBody(e.target.value)} placeholder={kind === "note" ? "Keep it short — under 40 words reads best." : "What goes in here?"} />
        </label>
        <DialogFooter className="zb-dialog-footer">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit">
            {kind === "note" ? "Add note" : "Add board"}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  )
}
