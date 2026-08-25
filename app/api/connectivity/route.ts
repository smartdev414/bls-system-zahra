import { NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { appHost, networkRequirements } from "@/lib/network-requirements"

/**
 * Endpoint inventory for the in-app connection check.
 *
 * Hostnames only — never keys or secrets. Requires a session because there is
 * no reason to publish an infrastructure map to anonymous visitors; the public
 * `/it-requirements` page renders the same inventory server-side for the IT
 * team, who have no account.
 */
export const dynamic = "force-dynamic"

export async function GET() {
  const session = await getSession()
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

  const bucket = process.env.AWS_S3_BUCKET
  const region = process.env.AWS_REGION ?? "eu-west-2"

  return NextResponse.json({
    appHost: appHost(),
    storageHost: bucket ? `${bucket}.s3.${region}.amazonaws.com` : null,
    livekitConfigured: !!(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_WS_URL),
    pusherConfigured: !!(process.env.NEXT_PUBLIC_PUSHER_KEY && process.env.NEXT_PUBLIC_PUSHER_CLUSTER),
    requirements: networkRequirements(),
  })
}
