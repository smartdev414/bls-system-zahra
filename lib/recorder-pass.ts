import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"

// The recorder pass
// ─────────────────
// LiveKit's recorder is a headless browser that opens our /egress page to film
// a class. It is not signed in as anyone, yet the recording has to show what
// the tutor is presenting — slides, a shared video, the whiteboard — which
// normally only people in the class may fetch.
//
// So when a recording starts, the server signs a pass naming that one class
// and puts it in the recorder's address (/egress/<pass>). The page swaps it for
// a cookie, and the few read-only endpoints the recording needs accept that
// cookie for that class only. It grants nothing else: no user, no other class,
// no downloads, and it expires.

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "bsl-dev-secret-change-in-production"
)
export const RECORDER_COOKIE = "bsl-recorder"
// Long enough for the longest class plus LiveKit's per-segment time limit.
const PASS_TTL_SECS = 8 * 60 * 60

export async function createRecorderPass(sessionId: string): Promise<string> {
  return new SignJWT({ sessionId, typ: "recorder" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${PASS_TTL_SECS}s`)
    .sign(SECRET)
}

export async function verifyRecorderPass(pass: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(pass, SECRET)
    return payload.typ === "recorder" && typeof payload.sessionId === "string" ? payload.sessionId : null
  } catch {
    return null
  }
}

export const recorderCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: PASS_TTL_SECS,
}

/** The class the calling recorder may see, or null for anyone else. */
export async function recorderSessionId(): Promise<string | null> {
  const pass = (await cookies()).get(RECORDER_COOKIE)?.value
  return pass ? verifyRecorderPass(pass) : null
}
