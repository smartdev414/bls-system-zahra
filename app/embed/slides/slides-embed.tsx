"use client"

import { useEffect, useState, useSyncExternalStore } from "react"
import { useSearchParams } from "next/navigation"
import { PptSlideViewer } from "@/components/classroom/PptSlideViewer"

// The phone app drives this page: it loads it with ?url=&page= and then calls
// window.tmsSetSlide({ url, page }) whenever the tutor moves on.
declare global {
  interface Window {
    tmsSetSlide?: (next: { url?: string; page?: number }) => void
    ReactNativeWebView?: { postMessage: (data: string) => void }
  }
}

const S3_HOST = /\.s3[.-]([a-z0-9-]+\.)?amazonaws\.com$/i

/** Only the classroom's own files: an S3 object of this site, or its media gateway. */
function allowed(url: string | null): url is string {
  if (!url) return false
  if (url.startsWith("/api/media/")) return true
  try {
    const u = new URL(url)
    return u.origin === window.location.origin || (u.protocol === "https:" && S3_HOST.test(u.hostname))
  } catch {
    return false
  }
}

const noop = () => () => {}

export function SlidesEmbed() {
  // The URL check needs `window`, so draw nothing until running in the WebView.
  const isClient = useSyncExternalStore(noop, () => true, () => false)
  const params = useSearchParams()
  const [url, setUrl] = useState<string | null>(params.get("url"))
  const [page, setPage] = useState(() => Math.max(1, Number(params.get("page")) || 1))

  useEffect(() => {
    window.tmsSetSlide = (next) => {
      if (typeof next.url === "string") setUrl(next.url)
      if (typeof next.page === "number" && next.page >= 1) setPage(Math.floor(next.page))
    }
    return () => {
      delete window.tmsSetSlide
    }
  }, [])

  if (!isClient || !allowed(url)) {
    return <div className="flex-1 bg-black" />
  }

  return (
    <div className="fixed inset-0 bg-black">
      <PptSlideViewer
        fileUrl={url}
        currentPage={page}
        onTotalPages={(total) => window.ReactNativeWebView?.postMessage(JSON.stringify({ total }))}
      />
    </div>
  )
}
