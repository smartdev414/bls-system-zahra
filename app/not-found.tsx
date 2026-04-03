import Link from "next/link"
import { FileQuestion, Home } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-6">
      <div className="text-center max-w-md">
        <div className="inline-flex items-center justify-center rounded-2xl bg-primary/10 p-6 mb-6">
          <FileQuestion className="size-12 text-primary" />
        </div>
        <h1 className="text-6xl font-black tracking-tight text-primary mb-2">404</h1>
        <h2 className="text-xl font-bold mb-3">Page not found</h2>
        <p className="text-muted-foreground mb-8">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Button asChild>
          <Link href="/">
            <Home className="size-4 mr-2" /> Go Home
          </Link>
        </Button>
      </div>
    </div>
  )
}
