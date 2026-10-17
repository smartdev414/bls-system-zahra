"use client"

import { MapPin, Video } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { CourseFormat } from "@/lib/course-format"

const OPTIONS: Array<{ value: CourseFormat; label: string; hint: string; icon: typeof Video }> = [
  { value: "ONLINE", label: "Online classroom", hint: "Students join classes here", icon: Video },
  { value: "IN_PERSON", label: "Face to face", hint: "Students come to a venue", icon: MapPin },
]

/**
 * How a course is taught — two cards, one tap. Face to face asks for the
 * venue, which students then see on every class instead of a Join button.
 */
export function CourseFormatPicker({ format, venue, onFormatChange, onVenueChange }: {
  format: CourseFormat
  venue: string
  onFormatChange: (format: CourseFormat) => void
  onVenueChange: (venue: string) => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label id="course-format-label">How are the classes taught?</Label>
        <div role="radiogroup" aria-labelledby="course-format-label" className="grid grid-cols-2 gap-2">
          {OPTIONS.map(({ value, label, hint, icon: Icon }) => {
            const selected = format === value
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onFormatChange(value)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border-2 px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  selected
                    ? value === "IN_PERSON"
                      ? "border-orange-500 bg-orange-50 dark:bg-orange-950/30"
                      : "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/50",
                )}
              >
                <Icon className={cn("size-4", selected ? (value === "IN_PERSON" ? "text-orange-700" : "text-primary") : "text-muted-foreground")} />
                <span className="text-sm font-semibold leading-tight">{label}</span>
                <span className="text-xs text-muted-foreground leading-tight">{hint}</span>
              </button>
            )
          })}
        </div>
      </div>

      {format === "IN_PERSON" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="course-venue">Where</Label>
          <Input
            id="course-venue"
            value={venue}
            onChange={(e) => onVenueChange(e.target.value)}
            placeholder="Room and address, e.g. Room 2, 10 High Street, Leeds"
          />
        </div>
      )}
    </div>
  )
}
