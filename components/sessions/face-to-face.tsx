import Link from "next/link"
import { MapPin, Video } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/** A link that opens the venue in the phone's or computer's maps. */
export function mapsUrl(venue: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(venue)}`
}

/**
 * Says where a class happens, so nobody on a face-to-face course looks for it
 * in the online classroom: "Face to face" with the venue, or "Online".
 */
export function ClassFormatBadge({ inPerson, className = "" }: { inPerson: boolean; className?: string }) {
  return inPerson ? (
    <Badge variant="outline" className={`text-[0.625rem] gap-1 bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900 ${className}`}>
      <MapPin className="size-2.5" /> Face to face
    </Badge>
  ) : (
    <Badge variant="outline" className={`text-[0.625rem] gap-1 bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900 ${className}`}>
      <Video className="size-2.5" /> Online
    </Badge>
  )
}

/** The venue, tappable to open it in maps — or a plain note when none is set yet. */
export function VenueLink({ venue, className = "" }: { venue: string | null; className?: string }) {
  if (!venue) {
    return (
      <span className={`inline-flex items-center gap-1 text-orange-800 dark:text-orange-300 ${className}`}>
        <MapPin className="size-3.5 shrink-0" /> Face to face — your teacher will tell you where
      </span>
    )
  }
  return (
    <a
      href={mapsUrl(venue)}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-start gap-1 font-medium text-orange-800 dark:text-orange-300 hover:underline ${className}`}
    >
      <MapPin className="size-3.5 shrink-0 mt-0.5" /> <span>{venue}</span>
    </a>
  )
}

/**
 * What the classroom page shows for a face-to-face class — opened from a
 * reminder, a calendar entry or an old link. There is no room to wait in, so
 * it says where and when the class is instead of opening the camera.
 */
export function FaceToFaceClassScreen({ title, scheduledAt, durationMins, venue, backHref }: {
  title: string
  scheduledAt: string
  durationMins: number
  venue: string | null
  backHref: string
}) {
  const start = new Date(scheduledAt)
  const end = new Date(start.getTime() + durationMins * 60_000)
  const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="size-20 rounded-full bg-orange-100 dark:bg-orange-950/40 flex items-center justify-center">
        <MapPin className="size-9 text-orange-700 dark:text-orange-300" />
      </div>
      <div className="max-w-sm flex flex-col gap-2">
        <p className="text-xs font-bold uppercase tracking-wider text-orange-800 dark:text-orange-300">Face-to-face class</p>
        <h2 className="text-2xl font-black leading-tight">{title}</h2>
        <p className="text-muted-foreground text-sm">
          {start.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
          {" · "}{clock(start)}–{clock(end)}
        </p>
        <VenueLink venue={venue} className="text-base justify-center mt-1" />
        <p className="text-muted-foreground text-sm mt-2">
          This class happens in person, not in the online classroom.
        </p>
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        {venue && (
          <Button asChild size="lg">
            <a href={mapsUrl(venue)} target="_blank" rel="noopener noreferrer">
              <MapPin className="size-4 mr-1.5" /> Open in maps
            </a>
          </Button>
        )}
        <Button asChild size="lg" variant="outline">
          <Link href={backHref}>Back</Link>
        </Button>
      </div>
    </div>
  )
}
