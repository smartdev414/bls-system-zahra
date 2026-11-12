import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { jwtVerify } from "jose"
import { sessionState, SIGNED_IN_ELSEWHERE } from "@/lib/single-session"

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "bsl-dev-secret-change-in-production"
)
const COOKIE = "bsl-token"

const PUBLIC_ROUTES = ["/login", "/register"]
// A student who signed up and is waiting for staff approval (or was turned
// down, or has been suspended) is kept on this page — see lib/account-approval.ts.
const PENDING_PATH = "/pending"
const ROLE_HOME: Record<string, string> = {
  STUDENT: "/student",
  TUTOR: "/tutor",
  SUPPORT: "/support",
  ADMIN: "/admin",
}

// Each dashboard tree and the roles allowed inside it. Admins may look at any
// of them; everyone else is bounced back to their own home.
const TREE_ROLES: Record<string, string[]> = {
  "/student": ["STUDENT"],
  "/tutor": ["TUTOR"],
  "/support": ["SUPPORT", "ADMIN"],
  "/admin": ["ADMIN"],
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const token = request.cookies.get(COOKIE)?.value
  const verified = token ? await verifyToken(token) : null
  // A student whose account was signed in on another device keeps a valid JWT;
  // treat them as signed out and drop the stale cookie.
  const state = verified ? await sessionState(verified) : null
  const replaced = state === "replaced"
  const session = replaced ? null : verified
  // Waiting for approval, turned down, suspended, or every course finished: kept on one page.
  const awaitingApproval =
    state === "pending" || state === "rejected" || state === "suspended" || state === "finished"
  const home = (role: string) => (awaitingApproval ? PENDING_PATH : ROLE_HOME[role] ?? "/student")

  // The waiting page is only for students who are waiting
  if (pathname === PENDING_PATH) {
    if (awaitingApproval) return NextResponse.next()
    const url = request.nextUrl.clone()
    url.pathname = session ? home(session.role) : "/login"
    return NextResponse.redirect(url)
  }

  const isPublic = PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"))
  const tree = Object.keys(TREE_ROLES).find(
    (t) => pathname === t || pathname.startsWith(t + "/")
  )
  const isProtected = Boolean(tree)

  // Unauthenticated user hitting a protected route → send to login
  if (isProtected && !session) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("from", pathname)
    if (replaced) url.searchParams.set("reason", SIGNED_IN_ELSEWHERE)
    const res = NextResponse.redirect(url)
    if (replaced) res.cookies.delete(COOKIE)
    return res
  }

  // Authenticated user hitting /login or /register → send to their dashboard
  if (isPublic && session) {
    const url = request.nextUrl.clone()
    url.pathname = home(session.role)
    url.searchParams.delete("from")
    return NextResponse.redirect(url)
  }

  // Authenticated user on a dashboard their role doesn't own (or a student not
  // approved yet, who owns none) → send them home
  if (session && tree && (awaitingApproval || !TREE_ROLES[tree].includes(session.role))) {
    const url = request.nextUrl.clone()
    url.pathname = home(session.role)
    return NextResponse.redirect(url)
  }

  const res = NextResponse.next()
  if (replaced) res.cookies.delete(COOKIE)
  return res
}

async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as { sub: string; role: string; sid?: string }
  } catch {
    return null
  }
}

export const config = {
  matcher: [
    "/login",
    "/register",
    "/pending",
    "/student/:path*",
    "/tutor/:path*",
    "/support/:path*",
    "/admin/:path*",
  ],
}
