import Link from "next/link"
import { Hand } from "lucide-react"
import { Separator } from "@/components/ui/separator"

export function Footer() {
  return (
    <footer className="bg-background border-t">
      <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Hand className="size-4 text-primary" />
          <span>© 2025 BSL Learning Platform. All rights reserved.</span>
        </div>
        <div className="flex items-center gap-5 text-sm text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <Separator orientation="vertical" className="h-3" />
          <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service</Link>
          <Separator orientation="vertical" className="h-3" />
          <Link href="/support" className="hover:text-foreground transition-colors">Contact Support</Link>
        </div>
      </div>
    </footer>
  )
}
