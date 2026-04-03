import Link from "next/link"
import { Hand } from "lucide-react"
import { cn } from "@/lib/utils"

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2.5 shrink-0", className)}>
      <div className="bg-primary flex items-center justify-center rounded-lg p-1.5 shrink-0">
        <Hand className="size-5 text-primary-foreground" />
      </div>
      <div className="flex flex-col leading-none">
        <span className="font-bold text-[15px] tracking-tight text-foreground">BSL Learning</span>
        <span className="text-[10px] text-muted-foreground font-medium">Platform</span>
      </div>
    </Link>
  )
}
