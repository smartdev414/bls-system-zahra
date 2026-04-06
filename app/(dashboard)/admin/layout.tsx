import { Header } from "@/components/layout/header"
import { Footer } from "@/components/layout/footer"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"
import prisma from "@/lib/prisma"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let user = { name: "Admin", email: "admin@bslplatform.com", avatarUrl: undefined as string | undefined }
  try {
    const session = await getSession()
    if (!session || session.role !== "ADMIN") redirect("/login")
    const dbUser = await prisma.user.findUnique({ where: { id: session.sub }, select: { avatarUrl: true } })
    user = { name: session.name, email: session.email, avatarUrl: dbUser?.avatarUrl ?? undefined }
  } catch {
    redirect("/login")
  }

  return (
    <>
      <Header role="ADMIN" user={user} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">{children}</main>
      <Footer />
    </>
  )
}
