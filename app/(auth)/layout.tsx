import { AccessibilityMenu } from "@/components/accessibility/accessibility-menu";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-muted/30">
      {/* Display settings before sign-in, so low-vision users can read the form. */}
      <div className="flex justify-end px-3 pt-3 sm:px-6">
        <AccessibilityMenu labelled className="bg-background" />
      </div>
      {children}
    </div>
  );
}
