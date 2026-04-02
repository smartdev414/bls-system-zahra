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
  ADMIN: "/admin",
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const token = request.cookies.get(COOKIE)?.value
  const session = token ? await verifyToken(token) : null

  const isPublic = PUBLIC_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"))
  const isProtected =
    pathname.startsWith("/student") ||
    pathname.startsWith("/tutor") ||
    pathname.startsWith("/admin")

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

  // Authenticated user on the wrong role's dashboard → redirect to their own
  if (session) {
    const home = ROLE_HOME[session.role]
    if (
      (session.role === "STUDENT" && pathname.startsWith("/tutor")) ||
      (session.role === "TUTOR" && pathname.startsWith("/student"))
    ) {
      const url = request.nextUrl.clone()
      url.pathname = home
      return NextResponse.redirect(url)
    }
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
    "/admin/:path*",
  ],
}
