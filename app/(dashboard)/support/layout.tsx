import { Header } from "@/components/layout/header"
import { Footer } from "@/components/layout/footer"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"
import prisma from "@/lib/prisma"
import { isStaff } from "@/lib/permissions"
import { CoTutorInviteListener } from "@/components/layout/cotutor-invite-listener"
import { SessionStatusListener } from "@/components/layout/session-status-listener"

export default async function SupportLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  // Admins can look in on the Support Team desk; nobody else gets past here.
  if (!session || !isStaff(session.role)) redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { avatarUrl: true },
  })

  const user = {
    id: session.sub,
    name: session.name,
    email: session.email,
    avatarUrl: dbUser?.avatarUrl ?? undefined,
  }

  return (
    <>
      {/* Support staff can be invited into a class as its interpreter. */}
      <CoTutorInviteListener userId={user.id} basePath="/support" />
      <SessionStatusListener userId={user.id} />
      <Header role="SUPPORT" user={user} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">{children}</main>
      <Footer />
    </>
  )
}
