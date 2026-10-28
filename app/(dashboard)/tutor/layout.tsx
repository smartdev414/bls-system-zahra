import { Header } from "@/components/layout/header"
import { Footer } from "@/components/layout/footer"
import { UserIdSeeder } from "@/components/layout/user-id-seeder"
import { CoTutorInviteListener } from "@/components/layout/cotutor-invite-listener"
import { SessionStatusListener } from "@/components/layout/session-status-listener"
import { TutorPendingApproval } from "@/components/tutor-pending-approval"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"
import prisma from "@/lib/prisma"
import { TutorAccessProvider } from "@/components/tutor-access-provider"
import { ACCESS_SELECT, accessFromProfile } from "@/lib/tutor-access"

export default async function TutorLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session || session.role !== "TUTOR") redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { avatarUrl: true, tutorProfile: { select: { isVerified: true, ...ACCESS_SELECT } } },
  })

  const user = { id: session.sub, name: session.name, email: session.email, avatarUrl: dbUser?.avatarUrl ?? undefined }
  const isVerified = dbUser?.tutorProfile?.isVerified ?? false
  const access = accessFromProfile(dbUser?.tutorProfile)

  return (
    <TutorAccessProvider access={access}>
      <UserIdSeeder userId={user.id} />
      <CoTutorInviteListener userId={user.id} />
      <SessionStatusListener userId={user.id} />
      <Header role="TUTOR" user={user} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {isVerified ? children : <TutorPendingApproval userName={session.name} />}
      </main>
      <Footer />
    </TutorAccessProvider>
  )
}
