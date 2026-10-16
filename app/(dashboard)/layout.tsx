import { FeedbackButton } from "@/components/feedback/feedback-button"
import { PwaSupport } from "@/components/pwa/pwa-support"

// Shared wrapper — role-specific sub-layouts (tutor/student) add the header
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-muted/30">
      {children}
      <FeedbackButton />
      {/* Service worker + the "install app" / "turn on notifications" strip */}
      <PwaSupport />
    </div>
  )
}
