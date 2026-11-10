import { Suspense } from "react"
import { WhiteboardEmbed } from "./whiteboard-embed"

export const dynamic = "force-dynamic"

// The class whiteboard inside the Teach Me Sign phone app's live classroom (a WebView). The app
// joins the LiveKit room itself and relays the board's data-channel messages to and from this
// page, so the phone shows the same tldraw board as the website.
export default function WhiteboardEmbedPage() {
  return (
    <Suspense>
      <WhiteboardEmbed />
    </Suspense>
  )
}
