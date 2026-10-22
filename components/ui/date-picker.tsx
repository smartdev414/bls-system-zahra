"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

type DatePickerProps = {
  value?: Date
  onChange: (date: Date | undefined) => void
  placeholder?: string
  disabled?: (date: Date) => boolean
  className?: string
  /** date-fns format for the chosen date; narrow fields can pass a shorter one. */
  dateFormat?: string
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Pick a date",
  disabled,
  className,
  dateFormat = "PPP",
}: DatePickerProps) {
  // Picking a day is the whole job, so the calendar closes on it.
  const [open, setOpen] = React.useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-full min-w-0 justify-start overflow-hidden text-left font-normal",
            !value && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="mr-2 size-4 shrink-0" />
          <span className="truncate">{value ? format(value, dateFormat) : placeholder}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={value}
          // Open on the month of the chosen date, not on today's.
          defaultMonth={value}
          onSelect={(date) => { onChange(date); if (date) setOpen(false) }}
          disabled={disabled}
          initialFocus
        />
      </PopoverContent>
    </Popover>
  )
}
