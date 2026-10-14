"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Hand } from "lucide-react"
import { Separator } from "@/components/ui/separator"

export function Footer() {
  const pathname = usePathname()
  if (pathname.endsWith("/messages")) return null

  return (
    <footer className="bg-background border-t">
      <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col xl:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm max-xl:text-center">
          <Hand className="size-4 text-primary shrink-0" />
          <span>© {new Date().getFullYear()} Teach Me Sign Student Space. All rights reserved.</span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <Separator orientation="vertical" className="h-3 max-sm:hidden" />
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          <Separator orientation="vertical" className="h-3 max-sm:hidden" />
          <Link href="/support" className="hover:text-foreground transition-colors">Contact Support</Link>
          <Separator orientation="vertical" className="h-3 max-sm:hidden" />
          {/* Public and login-free: the IT team who has to approve a firewall
              exception has no account here, so the student must be able to send
              them a working link. */}
          <Link href="/it-requirements" className="hover:text-foreground transition-colors">Network Requirements</Link>
        </div>
      </div>
    </footer>
  )
}
