import Link from "next/link"
import Image from "next/image"
import { cn } from "@/lib/utils"

// Brand asset: public/brand/deafsign-logo.png (500x500, the "Deaf Signs"
// circle on white), made from public/logo-1.jpeg. The same image serves as the
// small mark (header, watermarks) and the full lockup (auth pages). The badge
// fills ~83% of the square, so the header and auth pages crop it to a circle
// (scaled up to just inside the white corners): on the dark and yellow themes it
// then reads as a round badge instead of a white tile.
export const LOGO_MARK_SRC = "/brand/deafsign-logo.png"
export const LOGO_FULL_SRC = "/brand/deafsign-logo.png"
export const LOGO_BRAND = "Deaf Signs"

export const MARK_W = 500
export const MARK_H = 500
const FULL_W = 500
const FULL_H = 500

export function Logo({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2.5 shrink-0", className)}>
      <span className="size-10 shrink-0 overflow-hidden rounded-full bg-white">
        <Image
          src={LOGO_MARK_SRC}
          alt={LOGO_BRAND}
          width={MARK_W}
          height={MARK_H}
          sizes="48px"
          className={cn("size-full", BADGE_SCALE)}
          priority
        />
      </span>
      {/* lg–xl: the inline nav needs the room, so the wordmark steps aside. */}
      <div className="hidden sm:flex lg:hidden xl:flex flex-col leading-none">
        <span className="font-bold text-[0.9375rem] tracking-tight text-foreground">{LOGO_BRAND}</span>
        <span className="text-[0.625rem] text-muted-foreground font-medium">BSL Learning</span>
      </div>
    </Link>
  )
}

// Circle crop: the ring's outer edge sits at 83% of the image width.
const BADGE_SCALE = "scale-[1.14]"

// Large badge for roomy spots like the auth pages.
export function LogoFull({ className, width = 140 }: { className?: string; width?: number }) {
  return (
    <Link
      href="/"
      className={cn("inline-block shrink-0 overflow-hidden rounded-full bg-white", className)}
      style={{ width, height: width }}
    >
      <Image
        src={LOGO_FULL_SRC}
        alt={LOGO_BRAND}
        width={FULL_W}
        height={FULL_H}
        sizes={`${Math.round(width * 1.2)}px`}
        className={cn("size-full", BADGE_SCALE)}
        priority
      />
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
