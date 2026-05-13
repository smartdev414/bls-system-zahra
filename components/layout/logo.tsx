import Link from "next/link"
import Image from "next/image"
import { cn } from "@/lib/utils"

export const LOGO_SRC = "/logo-1.jpeg"
export const LOGO_BRAND = "Deaf Signs"

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2.5 shrink-0", className)}>
      <div className="relative size-9 rounded-full overflow-hidden bg-white ring-1 ring-foreground/10 shrink-0">
        <Image
          src={LOGO_SRC}
          alt={LOGO_BRAND}
          fill
          sizes="36px"
          className="object-cover"
          priority
        />
      </div>
      <div className="flex flex-col leading-none">
        <span className="font-bold text-[15px] tracking-tight text-foreground">{LOGO_BRAND}</span>
        <span className="text-[10px] text-muted-foreground font-medium">BSL Learning</span>
      </div>
    </Link>
  )
}

// Watermark variant — fixed-corner overlay used inside the classroom room and
// other immersive views where the header isn't shown. Non-interactive.
export function LogoWatermark({
  className,
  size = 40,
}: {
  className?: string
  size?: number
}) {
  return (
    <div
      className={cn(
        "absolute z-30 pointer-events-none select-none rounded-full overflow-hidden bg-white/95 ring-1 ring-black/10 shadow-md",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Image
        src={LOGO_SRC}
        alt=""
        fill
        sizes={`${size}px`}
        className="object-cover"
      />
    </div>
  )
}
