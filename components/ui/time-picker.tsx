"use client"

import * as React from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

type TimePickerProps = {
  value?: string   // "HH:mm" 24-hour format
  onChange: (time: string) => void
  className?: string
}

const HOURS = Array.from({ length: 24 }, (_, i) =>
  i.toString().padStart(2, "0")
)
const MINUTES = ["00", "15", "30", "45"]

export function TimePicker({ value, onChange, className }: TimePickerProps) {
  const [hour, minute] = value ? value.split(":") : ["", ""]

  function handleHour(h: string) {
    onChange(`${h}:${minute || "00"}`)
  }

  function handleMinute(m: string) {
    onChange(`${hour || "00"}:${m}`)
  }

  return (
    <div className={cn("flex gap-2", className)}>
      <Select value={hour} onValueChange={handleHour}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="HH" />
        </SelectTrigger>
        <SelectContent className="max-h-[200px]">
          {HOURS.map((h) => (
            <SelectItem key={h} value={h}>
              {h}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <span className="flex items-center text-muted-foreground font-medium">:</span>

      <Select value={minute} onValueChange={handleMinute}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="MM" />
        </SelectTrigger>
        <SelectContent>
          {MINUTES.map((m) => (
            <SelectItem key={m} value={m}>
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
