"use client"

import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  BookOpen, FlaskConical, Library, Video, Users,
  LayoutDashboard, Settings, LogOut, ChevronDown, Bell, ShieldCheck, Tag, FolderOpen, MessageSquare,
} from "lucide-react"
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

type Role = "STUDENT" | "TUTOR" | "ADMIN"

type NavItem = {
  label: string
  href: string
  icon: React.ElementType
}

const studentNav: NavItem[] = [
  { label: "Dashboard", href: "/student", icon: LayoutDashboard },
  { label: "Courses", href: "/student/courses", icon: BookOpen },
  { label: "Lessons", href: "/student/lessons", icon: BookOpen },
  { label: "Resources", href: "/student/resources", icon: FolderOpen },
  { label: "Dictionary", href: "/student/dictionary", icon: Library },
  { label: "Tests", href: "/student/tests", icon: FlaskConical },
  { label: "Classroom", href: "/student/classroom", icon: Video },
  { label: "Messages", href: "/student/messages", icon: MessageSquare },
]

const adminNav: NavItem[] = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard },
  { label: "Users", href: "/admin/users", icon: Users },
  { label: "Courses", href: "/admin/courses", icon: BookOpen },
  { label: "Categories", href: "/admin/categories", icon: Tag },
  { label: "Dictionary", href: "/admin/signs", icon: Library },
]

const tutorNav: NavItem[] = [
  { label: "Dashboard", href: "/tutor", icon: LayoutDashboard },
  { label: "My Courses", href: "/tutor/courses", icon: BookOpen },
  { label: "Live Sessions", href: "/tutor/sessions", icon: Video },
  { label: "Students", href: "/tutor/students", icon: Users },
  { label: "Messages", href: "/tutor/messages", icon: MessageSquare },
]

type HeaderProps = {
  role: Role
  user: {
    name: string
    email: string
    avatarUrl?: string
  }
}

export function Header({ role, user }: HeaderProps) {
  const pathname = usePathname()
  const router = useRouter()

  const navItems = role === "TUTOR" ? tutorNav : role === "ADMIN" ? adminNav : studentNav

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
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-6">

        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-8">
          <Logo />

          <nav className="hidden md:flex items-center gap-1">
            {navItems.map(({ label, href, icon: Icon }) => {
              const isActive = pathname === href || pathname.startsWith(href + "/")
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
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Right: notifications + avatar */}
        <div className="flex items-center gap-3">
          {/* Role badge */}
          <Badge variant="secondary" className="hidden sm:inline-flex capitalize text-xs">
            {role.toLowerCase()}
          </Badge>

          {/* Notifications */}
          <Button variant="ghost" size="icon" className="relative">
            <Bell className="size-4" />
            <span className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-primary" />
          </Button>

          <Separator orientation="vertical" className="h-6" />

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
                <span className="hidden sm:block text-sm font-medium max-w-[120px] truncate">
                  {user.name}
                </span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col gap-0.5">
                  <span className="font-semibold text-sm">{user.name}</span>
                  <span className="text-xs text-muted-foreground truncate">{user.email}</span>
                </div>
              </DropdownMenuLabel>

              <DropdownMenuSeparator />

              {role !== "ADMIN" && (
                <DropdownMenuItem asChild>
                  <Link href={`/${role.toLowerCase()}/profile`} className="cursor-pointer">
                    <Users className="size-4 mr-2" />
                    Profile
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
              <DropdownMenuItem asChild>
                <Link href={`/${role.toLowerCase()}/settings`} className="cursor-pointer">
                  <Settings className="size-4 mr-2" />
                  Settings
                </Link>
              </DropdownMenuItem>

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
    </header>
  )
}
