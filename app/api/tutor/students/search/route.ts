import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

export async function GET(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "TUTOR" && session.role !== "ADMIN") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""

    const students = await prisma.user.findMany({
      where: {
        role: "STUDENT",
        ...(q.length > 0 && {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
          ],
        }),
      },
      select: { id: true, name: true, email: true, avatarUrl: true },
      orderBy: { name: "asc" },
      take: 20,
    })

    return NextResponse.json({ students })
  } catch (err) {
    console.error("[GET /api/tutor/students/search]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
