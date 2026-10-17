import { Monitor, Moon, Sun } from "lucide-react"
import { useState } from "react"
import { getTheme, setTheme, type ThemePref } from "@/lib/theme"

const OPTIONS: { value: ThemePref; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
]

/** Light, dark, or follow the system — applied instantly, remembered in this browser. */
export function ThemePicker() {
  const [pref, setPref] = useState<ThemePref>(getTheme)
  const choose = (v: ThemePref) => {
    setPref(v)
    setTheme(v)
  }
  return (
    <div className="zb-segmented" role="radiogroup" aria-label="Appearance">
      {OPTIONS.map(({ value, label, Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={pref === value}
          tabIndex={pref === value ? 0 : -1}
          className="zb-segment"
          onClick={() => choose(value)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return
            e.preventDefault()
            const i = OPTIONS.findIndex((o) => o.value === pref)
            const next = OPTIONS[(i + (e.key === "ArrowRight" ? 1 : OPTIONS.length - 1)) % OPTIONS.length]
            choose(next.value)
            ;(e.currentTarget.parentElement?.querySelector(`[data-value="${next.value}"]`) as HTMLElement | null)?.focus()
          }}
          data-value={value}
        >
          <Icon size={16} strokeWidth={2.25} aria-hidden />
          {label}
        </button>
      ))}
    </div>
  )
}
