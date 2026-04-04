import { Header } from "@/components/layout/header"
import { Footer } from "@/components/layout/footer"
import { UserIdSeeder } from "@/components/layout/user-id-seeder"
import { getSession } from "@/lib/auth"

export default async function TutorLayout({ children }: { children: React.ReactNode }) {
  let user = { id: "", name: "Sarah Connor", email: "sarah@bslplatform.com", avatarUrl: undefined }
  try {
    const session = await getSession()
    if (session) user = { id: session.sub, name: session.name, email: session.email, avatarUrl: undefined }
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
