import { Header } from "@/components/layout/header"
import { Footer } from "@/components/layout/footer"
import { getSession } from "@/lib/auth"
import { redirect } from "next/navigation"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  let user = { name: "Admin", email: "admin@bslplatform.com", avatarUrl: undefined }
  try {
    const session = await getSession()
    if (!session || session.role !== "ADMIN") redirect("/login")
    user = { name: session.name, email: session.email, avatarUrl: undefined }
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
