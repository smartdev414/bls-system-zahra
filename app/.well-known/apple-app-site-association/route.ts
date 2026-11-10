import { NextResponse } from "next/server"

// iOS Universal Links: lets the Teach Me Sign phone app open https://<this site>/reset-password/…
// and /invite/… links itself.
//   MOBILE_IOS_TEAM_ID     the Apple developer team ID
//   MOBILE_IOS_BUNDLE_ID   defaults to com.teachmesign.app (app.json → ios.bundleIdentifier)
// Without a team ID the file is not served and links keep opening in the browser.
export const dynamic = "force-dynamic"

export function GET() {
  const team = process.env.MOBILE_IOS_TEAM_ID?.trim()
  if (!team) return new NextResponse(null, { status: 404 })

  const appID = `${team}.${process.env.MOBILE_IOS_BUNDLE_ID || "com.teachmesign.app"}`
  return NextResponse.json({
    applinks: {
      details: [
        {
          appIDs: [appID],
          components: [
            { "/": "/reset-password/*", comment: "Password reset email" },
            { "/": "/invite/*", comment: "Tutor invitation email" },
          ],
        },
      ],
    },
  })
}
