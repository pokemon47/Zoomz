import { LogOut, Search, Settings } from "lucide-react"
import type { ReactNode } from "react"
import { Link, navigate } from "@/app/router"
import { useSession, type User } from "@/app/session"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

export function Avatar({ name, color, avatar, size = 32, ring }: { name: string; color: string; avatar?: string | null; size?: number; ring?: boolean }) {
  const initials = name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase() || "?"
  return (
    <span className={`zb-avatar${ring ? " has-ring" : ""}`} style={{ width: size, height: size, background: color, fontSize: size * 0.4 }} title={name}>
      {avatar ? <img src={avatar} alt="" referrerPolicy="no-referrer" /> : initials}
    </span>
  )
}

/** The app's top bar (home, search, you). Board pages pass extra controls as children. */
export function TopBar({ children, onSearch }: { children?: ReactNode; onSearch?(): void }) {
  const { user, signOut } = useSession()
  return (
    <header className="zb-topbar">
      <Link to="/" className="zb-brand" aria-label="Zoomz home">
        <span className="zb-logo zb-logo-sm" aria-hidden>
          <i className="zb-tomato" />
          <i className="zb-lilac" />
          <i className="zb-mint" />
        </span>
        <span className="zb-brand-name">Zoomz</span>
      </Link>
      <div className="zb-topbar-mid">{children}</div>
      {onSearch && (
        <button type="button" className="zb-search-btn" onClick={onSearch} aria-label="Search (⌘K)">
          <Search size={16} strokeWidth={2.25} aria-hidden />
          <span>Search</span>
          <kbd>⌘K</kbd>
        </button>
      )}
      {user ? <UserMenu user={user} onSignOut={signOut} /> : <Link to={`/login?next=${encodeURIComponent(location.pathname)}`} className="zb-btn zb-btn-primary zb-btn-sm">Sign in</Link>}
    </header>
  )
}

function UserMenu({ user, onSignOut }: { user: User; onSignOut(): Promise<void> }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<button type="button" className="zb-avatar-btn" aria-label={`Account: ${user.name}`} />}>
        <Avatar name={user.name} color={user.color} avatar={user.avatar} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="zb-menu" align="end" sideOffset={10}>
        <div className="zb-menu-who">
          <strong>{user.name}</strong>
          <span>{user.email}</span>
        </div>
        <DropdownMenuItem className="zb-menu-item" onClick={() => navigate("/settings")}>
          <Settings strokeWidth={2.25} aria-hidden /> Settings
        </DropdownMenuItem>
        <DropdownMenuItem
          className="zb-menu-item"
          onClick={async () => {
            await onSignOut()
            navigate("/login")
          }}
        >
          <LogOut strokeWidth={2.25} aria-hidden /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
