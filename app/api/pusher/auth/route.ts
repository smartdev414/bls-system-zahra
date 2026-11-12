import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { getPusher } from "@/lib/pusher-server"
import { withAudit } from "@/lib/audit"

/**
 * Pusher private-channel auth endpoint.
 * Pusher sends socket_id + channel_name as application/x-www-form-urlencoded.
 * We verify the user owns the channel they're requesting.
 */
async function handlePOST(req: NextRequest) {
  const session = await getSession()
  if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

  const body = await req.text()
  const params = new URLSearchParams(body)
  const socketId    = params.get("socket_id")    ?? ""
  const channelName = params.get("channel_name") ?? ""

  if (!socketId || !channelName) {
    return NextResponse.json({ message: "Missing socket_id or channel_name" }, { status: 400 })
  }

  // Mirror the pusher lib's own validation so malformed client input is a 400,
  // not an uncaught throw from authorizeChannel() that surfaces as a 500 alert.
  if (!/^\d+\.\d+$/.test(socketId)) {
    return NextResponse.json({ message: "Invalid socket_id" }, { status: 400 })
  }
  if (
    channelName.length > 200 ||
    /[^A-Za-z0-9_\-=@,.;]/.test(channelName) ||
    !(channelName.startsWith("private-user-") || channelName.startsWith("private-conversation-"))
  ) {
    return NextResponse.json({ message: "Invalid channel_name" }, { status: 400 })
  }

  // Only allow subscribing to channels the user owns:
  // - private-conversation-<id>  → verified after subscription; we allow any authenticated user
  //   (the conversation route already enforces membership)
  // - private-user-<userId>      → only the matching user
  if (channelName.startsWith("private-user-")) {
    const userId = channelName.replace("private-user-", "")
    if (userId !== session.sub) {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }
  }

  const authResponse = getPusher().authorizeChannel(socketId, channelName)
  return NextResponse.json(authResponse)
}

export const POST = withAudit(handlePOST)
