import { FilePlus2, LayoutGrid, Plus, StickyNote } from "lucide-react"
import { useRef } from "react"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

type Props = {
  onFiles(files: File[]): void
  onNewNote(): void
  onNewBoard(): void
}

/** The one primary action per view: put something on the board you're in. */
export function AddMenu({ onFiles, onNewNote, onNewBoard }: Props) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<button type="button" className="zb-btn zb-btn-primary zb-btn-sm" />}>
          <Plus size={16} strokeWidth={2.5} aria-hidden />
          Add
        </DropdownMenuTrigger>
        <DropdownMenuContent className="zb-menu" align="end" sideOffset={10}>
          <DropdownMenuItem className="zb-menu-item" onClick={() => input.current?.click()}>
            <FilePlus2 strokeWidth={2.25} aria-hidden />
            Images & files…
          </DropdownMenuItem>
          <DropdownMenuItem className="zb-menu-item" onClick={onNewNote}>
            <StickyNote strokeWidth={2.25} aria-hidden />
            Note
            <DropdownMenuShortcut>N</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem className="zb-menu-item" onClick={onNewBoard}>
            <LayoutGrid strokeWidth={2.25} aria-hidden />
            Board
            <DropdownMenuShortcut>B</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) onFiles(files)
          e.target.value = ""
        }}
      />
    </>
  )
}
