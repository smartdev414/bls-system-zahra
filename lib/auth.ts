import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"
import { NextResponse } from "next/server"

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "bsl-dev-secret-change-in-production"
)
const COOKIE = "bsl-token"
const EXPIRY = "7d"

export type SessionPayload = {
  sub: string   // userId
  name: string
  email: string
  role: "STUDENT" | "TUTOR" | "ADMIN"
}

export async function signToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(SECRET)
}

export async function verifyToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as SessionPayload
  } catch {
    return null
  }
}

/** Read the session from the cookie — works in Server Components and Route Handlers */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE)?.value
  if (!token) return null
  return verifyToken(token)
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: "/",
  })
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.delete(COOKIE)
}

/** Role → default redirect path after login */
export function dashboardPath(role: SessionPayload["role"]): string {
  if (role === "TUTOR") return "/tutor"
  if (role === "ADMIN") return "/admin"
  return "/student"
}
