"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import {
  BookOpen, FlaskConical, Library, Video, Users,
  LayoutDashboard, Settings, LogOut, ChevronDown, ShieldCheck, Tag, FolderOpen, MessageSquare, Clapperboard,
  Sun, Moon, Activity, Ticket, Star, Menu, X, Wifi,
  CalendarDays, UserPlus, Headset, GraduationCap, MapPin, Trophy, MessageSquarePlus, LogIn, Eye,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Logo } from "@/components/layout/logo"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { useDeleteCallback } from "@/hooks/use-fetch"
import { NotificationBell } from "@/components/ui/notification-bell"
import { MessagesBadge } from "@/components/layout/messages-badge"
import { RunpodCredit } from "@/components/layout/runpod-credit"
import { OPEN_FEEDBACK_EVENT } from "@/components/feedback/feedback-button"
import { roleLabel } from "@/lib/permissions"

type Role = "STUDENT" | "TUTOR" | "SUPPORT" | "ADMIN"

type NavItem = {
  label: string
  href: string
  icon: React.ElementType
}

// A parent menu in the main bar: one button that opens its child links, so the
// bar stays short enough to fit on one line.
type NavGroup = {
  label: string
  icon: React.ElementType
  items: NavItem[]
}

type NavEntry = NavItem | NavGroup

const isGroup = (entry: NavEntry): entry is NavGroup => "items" in entry

function isActiveHref(pathname: string, href: string) {
  // Only use startsWith for paths deeper than the role root (e.g. /student/courses)
  // otherwise /student would always match /student/courses, /student/classroom, etc.
  const hasSubPaths = href.split("/").filter(Boolean).length > 1
  return pathname === href || (hasSubPaths && pathname.startsWith(href + "/"))
}

const studentNav: NavEntry[] = [
  { label: "Dashboard", href: "/student", icon: LayoutDashboard },
  {
    label: "Learning", icon: BookOpen, items: [
      { label: "Courses", href: "/student/courses", icon: BookOpen },
      { label: "Tests", href: "/student/tests", icon: FlaskConical },
      { label: "Receptive log", href: "/student/receptive-log", icon: Eye },
      { label: "Leagues", href: "/student/leagues", icon: Trophy },
      { label: "Certifications", href: "/student/certifications", icon: ShieldCheck },
    ],
  },
  { label: "Tutors", href: "/student/tutors", icon: Users },
  { label: "Classroom", href: "/student/classroom", icon: Video },
]

const studentDropdownNav: NavItem[] = [
  { label: "Dictionary", href: "/student/dictionary", icon: Library },
  { label: "My videos", href: "/student/videos", icon: Clapperboard },
  { label: "Resources", href: "/student/resources", icon: FolderOpen },
  { label: "Tickets", href: "/student/tickets", icon: Ticket },
  { label: "Connection check", href: "/student/connection-check", icon: Wifi },
]

// Admins run the school from this one login: the courses and the library they
// build, the timetable, and the students — so those sit in the main bar and the
// occasional admin screens move into the menu.
const adminNav: NavEntry[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  {
    label: "Content", icon: BookOpen, items: [
      { label: "Courses", href: "/admin/courses", icon: BookOpen },
      { label: "Library", href: "/admin/library", icon: FolderOpen },
      { label: "Tests", href: "/admin/tests", icon: FlaskConical },
      { label: "Leagues", href: "/admin/leagues", icon: Trophy },
    ],
  },
  {
    label: "Classes", icon: Video, items: [
      { label: "Live Sessions", href: "/admin/sessions", icon: Video },
      { label: "Face to face", href: "/admin/face-to-face", icon: MapPin },
    ],
  },
  {
    label: "People", icon: Users, items: [
      { label: "Students", href: "/admin/students", icon: GraduationCap },
      { label: "Users", href: "/admin/users", icon: Users },
      { label: "Login activity", href: "/admin/login-activity", icon: LogIn },
    ],
  },
]

const adminDropdownNav: NavItem[] = [
  { label: "Dictionary", href: "/admin/signs", icon: Library },
  { label: "Certifications", href: "/admin/certifications", icon: ShieldCheck },
  { label: "Categories", href: "/admin/categories", icon: Tag },
  { label: "Tickets", href: "/admin/tickets", icon: Ticket },
  { label: "API Logs", href: "/admin/audit-logs", icon: Activity },
  { label: "Support desk", href: "/support", icon: Headset },
]

// Support Team — the timetable and the people on it. No dictionary, no lesson
// resources, no audit logs: see SUPPORT_CAPABILITIES in lib/permissions.ts.
const supportNav: NavEntry[] = [
  { label: "Dashboard", href: "/support", icon: LayoutDashboard },
  {
    label: "Classes", icon: CalendarDays, items: [
      { label: "Timetable", href: "/support/timetable", icon: CalendarDays },
      { label: "Face to face", href: "/support/face-to-face", icon: MapPin },
    ],
  },
  {
    label: "Courses", icon: BookOpen, items: [
      { label: "Courses", href: "/support/courses", icon: BookOpen },
      { label: "Enrolments", href: "/support/enrolments", icon: UserPlus },
    ],
  },
  { label: "Students", href: "/support/students", icon: Users },
]

const supportDropdownNav: NavItem[] = [
  { label: "Users", href: "/support/users", icon: Users },
  { label: "Tickets", href: "/support/tickets", icon: Ticket },
  { label: "Connection check", href: "/support/connection-check", icon: Wifi },
]

const tutorNav: NavEntry[] = [
  { label: "Dashboard", href: "/tutor", icon: LayoutDashboard },
  {
    label: "Teaching", icon: BookOpen, items: [
      { label: "My Courses", href: "/tutor/courses", icon: BookOpen },
      { label: "Library", href: "/tutor/library", icon: FolderOpen },
      { label: "Tests", href: "/tutor/tests", icon: FlaskConical },
      { label: "Leagues", href: "/tutor/leagues", icon: Trophy },
    ],
  },
  {
    label: "Classes", icon: Video, items: [
      { label: "Live Sessions", href: "/tutor/sessions", icon: Video },
      { label: "Face to face", href: "/tutor/face-to-face", icon: MapPin },
    ],
  },
  {
    label: "Students", icon: Users, items: [
      { label: "My Students", href: "/tutor/students", icon: Users },
      { label: "Reviews", href: "/tutor/reviews", icon: Star },
    ],
  },
]

const tutorDropdownNav: NavItem[] = [
  { label: "Dictionary", href: "/tutor/dictionary", icon: Library },
  { label: "Tickets", href: "/tutor/tickets", icon: Ticket },
  { label: "Connection check", href: "/tutor/connection-check", icon: Wifi },
]

type HeaderProps = {
  role: Role
  user: {
    id?: string
    name: string
    email: string
    avatarUrl?: string
  }
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      aria-label="Toggle theme"
    >
      <Sun className="size-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute size-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </Button>
  )
}

export function Header({ role, user }: HeaderProps) {
  const pathname = usePathname()
  const isMessagesRole = role === "STUDENT" || role === "TUTOR"

  const navItems =
    role === "TUTOR" ? tutorNav
    : role === "ADMIN" ? adminNav
    : role === "SUPPORT" ? supportNav
    : studentNav
  const dropdownNavItems =
    role === "TUTOR" ? tutorDropdownNav
    : role === "ADMIN" ? adminDropdownNav
    : role === "SUPPORT" ? supportDropdownNav
    : studentDropdownNav

  // Mobile nav panel — closed by default; closes when the user taps a link.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const { execute: signOut, loading: signingOut } = useDeleteCallback("/api/auth/logout", {
    successMessage: "Signed out successfully",
    onSuccess: () => window.location.assign("/login"),
  })

  const initials = user.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-md border-b">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 h-16 flex items-center justify-between gap-3 sm:gap-6">

        {/* Left: hamburger (mobile) + Logo + Nav */}
        <div className="flex items-center gap-2 sm:gap-4 lg:gap-4 xl:gap-8 min-w-0">
          {/* Mobile menu toggle — lg:hidden so it disappears once the inline nav fits. */}
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden shrink-0 -ml-1"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileNavOpen}
          >
            {mobileNavOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>

          <Logo />

          <nav className="hidden lg:flex items-center gap-1">
            {navItems.map((entry) => {
              if (isGroup(entry)) {
                const { label, icon: Icon, items } = entry
                const groupActive = items.some((item) => isActiveHref(pathname, item.href))
                return (
                  <DropdownMenu key={label} modal={false}>
                    <DropdownMenuTrigger
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors outline-none",
                        groupActive
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted data-[state=open]:bg-muted data-[state=open]:text-foreground"
                      )}
                    >
                      <Icon className="size-4" />
                      {label}
                      <ChevronDown className="size-3.5 opacity-70" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                      {items.map(({ label: itemLabel, href, icon: ItemIcon }) => (
                        <DropdownMenuItem key={href} asChild>
                          <Link
                            href={href}
                            className={cn(
                              "cursor-pointer",
                              isActiveHref(pathname, href) && "bg-primary/10 text-primary focus:text-primary"
                            )}
                          >
                            <ItemIcon className="size-4 mr-2" />
                            {itemLabel}
                          </Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )
              }
              const { label, href, icon: Icon } = entry
              const isActive = isActiveHref(pathname, href)
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <Icon className="size-4" />
                  {label}
                  {label === "Messages" && isMessagesRole && user.id && (
                    <MessagesBadge userId={user.id} />
                  )}
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Right: theme + notifications + avatar */}
        <div className="flex items-center gap-1">
          {/* Theme toggle — UI utility, lives outside the user cluster */}
          <ThemeToggle />

          <Separator orientation="vertical" className="h-5 mx-1" />

          {/* Bell sits next to avatar — both are user-centric */}
          <NotificationBell />

          {/* Avatar dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 px-2 h-9">
                <Avatar className="size-7">
                  <AvatarImage src={user.avatarUrl} alt={user.name} />
                  <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
                    {initials}
                  </AvatarFallback>
                </Avatar>
                <div className="hidden sm:flex lg:hidden xl:flex flex-col items-start">
                  <span className="text-sm font-medium max-w-30 truncate leading-tight">
                    {user.name}
                  </span>
                  <Badge variant="secondary" className="text-[10px] h-3.5 px-1 leading-none mt-0.5">
                    {roleLabel(role)}
                  </Badge>
                </div>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-sm">{user.name}</span>
                  <span className="text-xs text-muted-foreground truncate">{user.email}</span>
                  <Badge variant="secondary" className="text-[10px] h-4 px-1.5 w-fit mt-0.5">
                    {roleLabel(role)}
                  </Badge>
                </div>
              </DropdownMenuLabel>

              <DropdownMenuSeparator />

              {role !== "ADMIN" && role !== "SUPPORT" && (
                <DropdownMenuItem asChild>
                  <Link href={`/${role.toLowerCase()}/settings`} className="cursor-pointer">
                    <Users className="size-4 mr-2" />
                    Profile & Settings
                  </Link>
                </DropdownMenuItem>
              )}
              {role === "ADMIN" && (
                <DropdownMenuItem asChild>
                  <Link href="/admin" className="cursor-pointer">
                    <ShieldCheck className="size-4 mr-2" />
                    Admin Panel
                  </Link>
                </DropdownMenuItem>
              )}
              {role === "ADMIN" && (
                <DropdownMenuItem asChild>
                  <Link href="/admin/settings" className="cursor-pointer">
                    <Settings className="size-4 mr-2" />
                    Settings
                  </Link>
                </DropdownMenuItem>
              )}

              {dropdownNavItems.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  {dropdownNavItems.map(({ label, href, icon: Icon }) => (
                    <DropdownMenuItem key={href} asChild>
                      <Link href={href} className="cursor-pointer">
                        <Icon className="size-4 mr-2" />
                        {label}
                      </Link>
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              <DropdownMenuSeparator />

              <DropdownMenuItem
                className="text-destructive focus:text-destructive cursor-pointer"
                disabled={signingOut}
                onSelect={() => signOut()}
              >
                <LogOut className="size-4 mr-2" />
                {signingOut ? "Signing out…" : "Sign Out"}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {role === "ADMIN" && <RunpodCredit />}
        </div>
      </div>

      {/* Mobile nav panel — overlays page content (absolute, not in flow) so
          opening it doesn't shift the layout below. lg:hidden hides it once the
          inline desktop nav fits. */}
      {mobileNavOpen && (
        <div className="lg:hidden absolute top-16 inset-x-0 max-h-[calc(100dvh-4rem)] overflow-y-auto border-b border-t bg-background/95 backdrop-blur-md shadow-lg">
          <nav className="max-w-7xl mx-auto px-3 py-2 flex flex-col">
            {[...navItems.flatMap((entry) => (isGroup(entry) ? entry.items : [entry])), ...dropdownNavItems].map(({ label, href, icon: Icon }) => {
              const isActive = isActiveHref(pathname, href)
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileNavOpen(false)}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted"
                  )}
                >
                  <Icon className="size-4 shrink-0" />
                  {label}
                  {label === "Messages" && isMessagesRole && user.id && (
                    <MessagesBadge userId={user.id} />
                  )}
                </Link>
              )
            })}
            {/* The floating Feedback button is hidden on phones; it lives here instead. */}
            <button
              type="button"
              onClick={() => { setMobileNavOpen(false); window.dispatchEvent(new Event(OPEN_FEEDBACK_EVENT)) }}
              className="sm:hidden flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted text-left"
            >
              <MessageSquarePlus className="size-4 shrink-0" />
              Send feedback
            </button>
          </nav>
        </div>
      )}
    </header>
  )
}
