import { Header } from "@/components/layout/header"
import { Footer } from "@/components/layout/footer"
import { UserIdSeeder } from "@/components/layout/user-id-seeder"
import { getSession } from "@/lib/auth"
import prisma from "@/lib/prisma"

export default async function TutorLayout({ children }: { children: React.ReactNode }) {
  let user = { id: "", name: "Sarah Connor", email: "sarah@bslplatform.com", avatarUrl: undefined as string | undefined }
  try {
    const session = await getSession()
    if (session) {
      const dbUser = await prisma.user.findUnique({ where: { id: session.sub }, select: { avatarUrl: true } })
      user = { id: session.sub, name: session.name, email: session.email, avatarUrl: dbUser?.avatarUrl ?? undefined }
    }
  } catch {}

  return (
    <>
      <UserIdSeeder userId={user.id} />
      <Header role="TUTOR" user={user} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">{children}</main>
      <Footer />
    </>
  )
}
