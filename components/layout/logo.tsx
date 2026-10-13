import Link from "next/link"
import Image from "next/image"
import { cn } from "@/lib/utils"

// Brand assets are generated from public/tms logo.png (the 710x512 master):
//   tms-mark.png — the three "Teach / Me / Sign" tiles only (401x387). Used at
//                  small sizes (header, watermark) where the tagline would be
//                  illegible. Works on light and dark backgrounds.
//   tms-logo.png — full lockup incl. "WIDEN YOUR OPPORTUNITIES" (635x455).
//                  Black tagline on transparent; tms-logo-dark.png is the same
//                  with a white tagline for dark mode.
export const LOGO_MARK_SRC = "/brand/tms-mark.png"
export const LOGO_FULL_SRC = "/brand/tms-logo.png"
export const LOGO_FULL_DARK_SRC = "/brand/tms-logo-dark.png"
export const LOGO_BRAND = "Teach Me Sign"

export const MARK_W = 401
export const MARK_H = 387
const FULL_W = 635
const FULL_H = 455

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2.5 shrink-0", className)}>
      <Image
        src={LOGO_MARK_SRC}
        alt={LOGO_BRAND}
        width={MARK_W}
        height={MARK_H}
        sizes="42px"
        className="h-10 w-auto shrink-0"
        priority
      />
      {/* lg–xl: the inline nav needs the room, so the wordmark steps aside. */}
      <div className="hidden sm:flex lg:hidden xl:flex flex-col leading-none">
        <span className="font-bold text-[15px] tracking-tight text-foreground">{LOGO_BRAND}</span>
        <span className="text-[10px] text-muted-foreground font-medium">BSL Learning</span>
      </div>
    </Link>
  )
}

// Full lockup with tagline — for roomy spots like the auth pages. Sits directly
// on the page background; dark mode swaps to a copy with a white tagline.
export function LogoFull({ className, width = 170 }: { className?: string; width?: number }) {
  const img = {
    alt: `${LOGO_BRAND} — Widen your opportunities`,
    width: FULL_W,
    height: FULL_H,
    sizes: `${width}px`,
    style: { width, height: "auto" },
    priority: true,
  }
  return (
    <Link href="/" className={cn("inline-block shrink-0", className)}>
      <Image src={LOGO_FULL_SRC} className="dark:hidden" {...img} />
      <Image src={LOGO_FULL_DARK_SRC} className="hidden dark:block" {...img} />
    </Link>
  )
}

// Watermark variant — fixed-corner overlay used inside the classroom room and
// other immersive views where the header isn't shown. Non-interactive.
// `size` is the height of the tile; the mark is slightly wider than tall.
export function LogoWatermark({
  className,
  size = 48,
}: {
  className?: string
  size?: number
}) {
  const pad = Math.round(size * 0.1)
  return (
    <div
      className={cn(
        "absolute z-30 pointer-events-none select-none rounded-lg bg-white/95 ring-1 ring-black/10 shadow-md",
        className,
      )}
      style={{ padding: pad }}
      aria-hidden
    >
      <Image
        src={LOGO_MARK_SRC}
        alt=""
        width={MARK_W}
        height={MARK_H}
        sizes={`${size}px`}
        style={{ height: size - pad * 2, width: "auto" }}
      />
    </div>
  )
}
