"use client"

import { Check, ChevronDown, Globe, Lock } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { CourseVisibility } from "@/lib/course-visibility"

const OPTIONS: Record<CourseVisibility, { label: string; desc: string; icon: typeof Lock }> = {
  PRIVATE: { label: "Private", desc: "Only students you enrol can see it", icon: Lock },
  PUBLIC: { label: "Public", desc: "Any student can find it and join", icon: Globe },
}

/** Sits beside Publish: who can see this course once it is published. */
export function CourseVisibilityButton({
  visibility,
  onChange,
  disabled,
}: {
  visibility: CourseVisibility
  onChange: (next: CourseVisibility) => void
  disabled?: boolean
}) {
  const current = OPTIONS[visibility]
  const Icon = current.icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled} aria-label={`Visibility: ${current.label}`}>
          <Icon className="size-3.5 mr-1.5" /> {current.label} <ChevronDown className="size-3.5 ml-1" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {(Object.keys(OPTIONS) as CourseVisibility[]).map((v) => {
          const { label, desc, icon: OptionIcon } = OPTIONS[v]
          return (
            <DropdownMenuItem key={v} onSelect={() => v !== visibility && onChange(v)} className="items-start gap-2">
              <OptionIcon className="size-4 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
              {v === visibility && <Check className="size-4 mt-0.5 text-primary shrink-0" />}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
