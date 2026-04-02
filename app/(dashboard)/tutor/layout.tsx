import { Header } from "@/components/layout/header"
import { Footer } from "@/components/layout/footer"

// TODO: Replace with real session once auth is implemented
const mockTutor = {
  name: "Sarah Connor",
  email: "sarah@bslplatform.com",
  avatarUrl: undefined,
}

export default function TutorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header role="TUTOR" user={mockTutor} />
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-8">{children}</main>
      <Footer />
    </>
  )
}
