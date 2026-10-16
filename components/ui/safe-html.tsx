"use client"

import { useMemo } from "react"
import DOMPurify from "dompurify"

/**
 * Renders rich text written in the lesson editor. The HTML is cleaned first so
 * a description can never carry scripts, event handlers or iframes into a
 * student's browser — only ordinary formatting and links survive.
 */
export function SafeHtml({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => {
    // DOMPurify needs a DOM; lesson text is only ever fetched in the browser,
    // so render nothing during the server pass rather than unchecked HTML.
    if (typeof window === "undefined") return ""
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ["target"] })
  }, [html])

  return <div className={className} dangerouslySetInnerHTML={{ __html: clean }} />
}
