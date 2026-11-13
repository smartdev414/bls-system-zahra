import { Suspense } from "react"
import { VideoEmbed } from "./video-embed"

export const dynamic = "force-dynamic"

// Shown inside the Teach Me Sign phone app (a WebView) for videos that live on
// YouTube or Vimeo: a lesson video, or the video a tutor is playing to the
// class. The app's native player cannot play those sites; their own players,
// on a page of this site, can. Nothing here is private — it only plays a public
// or unlisted video from a link the app already has.
export default function VideoEmbedPage() {
  return (
    <Suspense>
      <VideoEmbed />
    </Suspense>
  )
}
