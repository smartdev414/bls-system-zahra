"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { useState } from "react"
import {
  BookOpen, FlaskConical, Library, Video, Users,
  LayoutDashboard, Settings, LogOut, ChevronDown, ShieldCheck, Tag, FolderOpen, MessageSquare,
  Sun, Moon, Activity, Ticket, Star, Menu, X, Wifi,
  CalendarDays, UserPlus, Headset,
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
import { roleLabel } from "@/lib/permissions"

type Role = "STUDENT" | "TUTOR" | "SUPPORT" | "ADMIN"

type NavItem = {
  label: string
  href: string
  icon: React.ElementType
}

const studentNav: NavItem[] = [
  { label: "Dashboard", href: "/student", icon: LayoutDashboard },
  { label: "Courses", href: "/student/courses", icon: BookOpen },
  { label: "Certifications", href: "/student/certifications", icon: ShieldCheck },
  { label: "Tutors", href: "/student/tutors", icon: Users },
  { label: "Classroom", href: "/student/classroom", icon: Video },
]

const studentDropdownNav: NavItem[] = [
  { label: "Dictionary", href: "/student/dictionary", icon: Library },
  { label: "Tests", href: "/student/tests", icon: FlaskConical },
  { label: "Resources", href: "/student/resources", icon: FolderOpen },
  { label: "Tickets", href: "/student/tickets", icon: Ticket },
  { label: "Connection check", href: "/student/connection-check", icon: Wifi },
]

const adminNav: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Courses", href: "/admin/courses", icon: BookOpen },
  { label: "Certifications", href: "/admin/certifications", icon: ShieldCheck },
  { label: "Categories", href: "/admin/categories", icon: Tag },
  { label: "API Logs", href: "/admin/audit-logs", icon: Activity },
]

const adminDropdownNav: NavItem[] = [
  { label: "Dictionary", href: "/admin/signs", icon: Library },
  { label: "Tickets", href: "/admin/tickets", icon: Ticket },
  { label: "Support desk", href: "/support", icon: Headset },
]

// Support Team — the timetable and the people on it. No dictionary, no lesson
// resources, no audit logs: see SUPPORT_CAPABILITIES in lib/permissions.ts.
const supportNav: NavItem[] = [
  { label: "Dashboard", href: "/support", icon: LayoutDashboard },
  { label: "Timetable", href: "/support/timetable", icon: CalendarDays },
  { label: "Enrolments", href: "/support/enrolments", icon: UserPlus },
  { label: "Courses", href: "/support/courses", icon: BookOpen },
  { label: "Students", href: "/support/students", icon: Users },
]

const supportDropdownNav: NavItem[] = [
  { label: "Users", href: "/support/users", icon: Users },
  { label: "Tickets", href: "/support/tickets", icon: Ticket },
  { label: "Connection check", href: "/support/connection-check", icon: Wifi },
]

const tutorNav: NavItem[] = [
  { label: "Dashboard", href: "/tutor", icon: LayoutDashboard },
  { label: "My Courses", href: "/tutor/courses", icon: BookOpen },
  { label: "Live Sessions", href: "/tutor/sessions", icon: Video },
  { label: "Students", href: "/tutor/students", icon: Users },
  { label: "Reviews", href: "/tutor/reviews", icon: Star },
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
  const router = useRouter()
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
    onSuccess: () => router.push("/login"),
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
        <div className="flex items-center gap-2 sm:gap-4 md:gap-8 min-w-0">
          {/* Mobile menu toggle — md:hidden so it disappears once the inline nav fits. */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden shrink-0 -ml-1"
            onClick={() => setMobileNavOpen((v) => !v)}
            aria-label={mobileNavOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileNavOpen}
          >
            {mobileNavOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </Button>

          <Logo />

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(({ label, href, icon: Icon }) => {
              // Only use startsWith for paths deeper than the role root (e.g. /student/courses)
              // otherwise /student would always match /student/courses, /student/classroom, etc.
              const hasSubPaths = href.split("/").filter(Boolean).length > 1
              const isActive = pathname === href || (hasSubPaths && pathname.startsWith(href + "/"))
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
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
                <div className="hidden sm:flex flex-col items-start">
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
        </div>
      </div>

      {/* Mobile nav panel — overlays page content (absolute, not in flow) so
          opening it doesn't shift the layout below. md:hidden hides it once the
          inline desktop nav fits. */}
      {mobileNavOpen && (
        <div className="md:hidden absolute top-16 inset-x-0 border-b border-t bg-background/95 backdrop-blur-md shadow-lg">
          <nav className="max-w-7xl mx-auto px-3 py-2 flex flex-col">
            {[...navItems, ...dropdownNavItems].map(({ label, href, icon: Icon }) => {
              const hasSubPaths = href.split("/").filter(Boolean).length > 1
              const isActive = pathname === href || (hasSubPaths && pathname.startsWith(href + "/"))
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
          </nav>
        </div>
      )}
    </header>
  )
}
