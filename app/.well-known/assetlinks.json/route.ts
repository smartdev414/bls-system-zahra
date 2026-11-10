import { NextResponse } from "next/server"

// Android App Links: lets the Teach Me Sign phone app open https://<this site>/reset-password/…
// and /invite/… links itself. Android checks this file when the app is installed.
//   MOBILE_ANDROID_PACKAGE        defaults to com.teachmesign.app (app.json → android.package)
//   MOBILE_ANDROID_SHA256_CERTS   comma-separated SHA-256 fingerprints of the app signing key
//                                 (Play Console → App integrity, or `eas credentials`)
// Without fingerprints the file is not served and links keep opening in the browser.
export const dynamic = "force-dynamic"

export function GET() {
  const fingerprints = (process.env.MOBILE_ANDROID_SHA256_CERTS ?? "")
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean)
  if (fingerprints.length === 0) return new NextResponse(null, { status: 404 })

  return NextResponse.json([
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: process.env.MOBILE_ANDROID_PACKAGE || "com.teachmesign.app",
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ])
}
