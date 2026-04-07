import { Header } from "@/components/layout/header"
import { Footer } from "@/components/layout/footer"
import { UserIdSeeder } from "@/components/layout/user-id-seeder"
import { TutorPendingApproval } from "@/components/tutor-pending-approval"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"
import prisma from "@/lib/prisma"

export default async function TutorLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession()
  if (!session || session.role !== "TUTOR") redirect("/login")

  const dbUser = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { avatarUrl: true, tutorProfile: { select: { isVerified: true } } },
  })

  const user = { id: session.sub, name: session.name, email: session.email, avatarUrl: dbUser?.avatarUrl ?? undefined }
  const isVerified = dbUser?.tutorProfile?.isVerified ?? false

  return (
    <>
      <UserIdSeeder userId={user.id} />
      <Header role="TUTOR" user={user} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">
        {isVerified ? children : <TutorPendingApproval userName={session.name} />}
      </main>
      <Footer />
    </>
  )
}
