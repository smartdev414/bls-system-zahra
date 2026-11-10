import { Suspense } from "react"
import { SlidesEmbed } from "./slides-embed"

export const dynamic = "force-dynamic"

// Shown inside the Teach Me Sign phone app's live classroom (a WebView), so students on a phone
// see the tutor's slides with the same renderer as the website. Nothing here is private: it
// only draws a file the classroom already gave the app, and only from this site's own storage.
export default function SlidesEmbedPage() {
  return (
    <Suspense>
      <SlidesEmbed />
    </Suspense>
  )
}
