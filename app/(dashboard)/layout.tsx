import { FeedbackButton } from "@/components/feedback/feedback-button"
import { ConnectionStatusBanner } from "@/components/connection/ConnectionStatusBanner"

// Shared wrapper — role-specific sub-layouts (tutor/student) add the header
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col min-h-screen bg-muted/30">
      {/* Outside the role sub-layouts on purpose: it has to sit above the
          classroom, which renders itself fixed over the whole viewport. */}
      <ConnectionStatusBanner />
      {children}
      <FeedbackButton />
    </div>
  )
}
