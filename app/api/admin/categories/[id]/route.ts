import { NextRequest, NextResponse } from "next/server"
import prisma from "@/lib/prisma"
import { getSession } from "@/lib/auth"

function toSlug(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    const { name } = await req.json() as { name: string }
    if (!name?.trim()) return NextResponse.json({ message: "Name is required" }, { status: 400 })

    const slug = toSlug(name.trim())
    const category = await prisma.category.update({
      where: { id },
      data: { name: name.trim(), slug },
    })

    return NextResponse.json({ category })
  } catch (err: unknown) {
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ message: "Category name already taken" }, { status: 409 })
    }
    console.error("[PATCH /api/admin/categories/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getSession()
    if (!session) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (session.role !== "ADMIN") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params

    const courseCount = await prisma.course.count({ where: { categoryId: id } })
    if (courseCount > 0) {
      return NextResponse.json(
        { message: `Cannot delete: ${courseCount} course(s) use this category` },
        { status: 409 }
      )
    }

    await prisma.category.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error("[DELETE /api/admin/categories/[id]]", err)
    return NextResponse.json({ message: "Internal server error" }, { status: 500 })
  }
}
