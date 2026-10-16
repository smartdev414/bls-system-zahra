import type { Metadata, Viewport } from "next";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { APP_NAME, THEME_COLOR } from "@/lib/pwa";
import "./globals.css";

export const metadata: Metadata = {
  title: "BSL Learning Platform",
  description: "Learn British Sign Language Online",
  applicationName: APP_NAME,
  // Added to the Home Screen on iOS: open full-screen, named "Teach Me Sign".
  // The touch icon itself comes from app/apple-icon.png; the manifest link
  // from app/manifest.ts.
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
