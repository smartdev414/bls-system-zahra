import { NextResponse } from "next/server"
import type { NextRequest } from "next/server"
import { jwtVerify } from "jose"

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "bsl-dev-secret-change-in-production"
)
const COOKIE = "bsl-token"

const PUBLIC_ROUTES = ["/login", "/register"]
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
  const session = token ? await verifyToken(token) : null

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
    return NextResponse.redirect(url)
  }

  // Authenticated user hitting /login or /register → send to their dashboard
  if (isPublic && session) {
    const url = request.nextUrl.clone()
    url.pathname = ROLE_HOME[session.role] ?? "/student"
    url.searchParams.delete("from")
    return NextResponse.redirect(url)
  }

  // Authenticated user on a dashboard their role doesn't own → send them home
  if (session && tree && !TREE_ROLES[tree].includes(session.role)) {
    const url = request.nextUrl.clone()
    url.pathname = ROLE_HOME[session.role] ?? "/student"
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as { role: string }
  } catch {
    return null
  }
}

export const config = {
  matcher: [
    "/login",
    "/register",
    "/student/:path*",
    "/tutor/:path*",
    "/support/:path*",
    "/admin/:path*",
  ],
}
