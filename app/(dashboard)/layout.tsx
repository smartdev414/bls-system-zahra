// Shared wrapper — role-specific sub-layouts (tutor/student) add the header
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col min-h-screen bg-muted/30">{children}</div>
}
