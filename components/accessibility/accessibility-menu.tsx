"use client"

import { useState } from "react"
import { useTheme } from "next-themes"
import { ALargeSmall, Check, Eye, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
  applyPrefs,
  DEFAULT_PREFS,
  readPrefs,
  savePrefs,
  TEXT_SIZES,
  type A11yPrefs,
} from "@/lib/accessibility"

/** One row of mutually exclusive choices, e.g. text size or theme. */
function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: React.ReactNode; aria?: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div role="group" aria-label={label} className="space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            aria-pressed={value === o.value}
            aria-label={o.aria}
            onClick={() => onChange(o.value)}
            className={cn(
              "min-h-9 rounded-md border px-1 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              value === o.value
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background hover:bg-muted"
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/** An on/off setting with a short explanation underneath. */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-2.5 rounded-md px-1.5 py-1.5 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border-2",
          checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground"
        )}
      >
        {checked && <Check className="size-3.5" strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  )
}

/**
 * Display settings: theme, text size, contrast, colour-blind friendly colours,
 * reduced motion and underlined links. Works signed in or out.
 */
export function AccessibilityMenu({
  className,
  labelled = false,
}: {
  className?: string
  /** Show "Display settings" text next to the icon (mobile menu, sign-in pages). */
  labelled?: boolean
}) {
  const { theme, setTheme } = useTheme()
  const [prefs, setPrefs] = useState<A11yPrefs>(DEFAULT_PREFS)

  const update = (patch: Partial<A11yPrefs>) => {
    const next = { ...prefs, ...patch }
    setPrefs(next)
    applyPrefs(next)
    savePrefs(next)
  }

  // Usher syndrome narrows vision and makes glare and dim text hard to read:
  // large text, strong contrast and a dark background together help most.
  const lowVisionPreset = () => {
    update({ textSize: 125, highContrast: true, reduceMotion: true, underlineLinks: true })
    setTheme("dark")
  }

  const reset = () => {
    update(DEFAULT_PREFS)
    setTheme("system")
  }

  return (
    // Re-read saved settings on open: localStorage isn't available during
    // server render, and another tab may have changed them.
    <Popover onOpenChange={(open) => open && setPrefs(readPrefs())}>
      <PopoverTrigger asChild>
        {labelled ? (
          <Button variant="outline" className={cn("gap-2", className)}>
            <ALargeSmall className="size-4" />
            Display settings
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Display settings: text size, colours, contrast"
            title="Display settings"
            className={className}
          >
            <ALargeSmall className="size-4" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="max-h-[calc(100dvh-5rem)] w-80 max-w-[calc(100vw-1.5rem)] gap-4 overflow-y-auto p-4"
      >
        <div>
          <p className="text-base font-semibold">Display settings</p>
          <p className="text-xs text-muted-foreground">Saved on this device.</p>
        </div>

        <Button variant="outline" className="h-auto justify-start gap-2 whitespace-normal py-2 text-left" onClick={lowVisionPreset}>
          <Eye className="size-4 shrink-0" />
          <span>
            <span className="block text-sm font-medium">Low vision (e.g. Usher)</span>
            <span className="block text-xs font-normal text-muted-foreground">
              Large text, high contrast, dark theme
            </span>
          </span>
        </Button>

        <Choice
          label="Text size"
          value={prefs.textSize}
          onChange={(textSize) => update({ textSize })}
          options={TEXT_SIZES.map((s) => ({
            value: s,
            aria: `${s}%`,
            label: <span style={{ fontSize: `${0.8 + (s - 100) / 125}rem` }}>A</span>,
          }))}
        />

        <Choice
          label="Theme"
          value={theme ?? "system"}
          onChange={(t) => setTheme(t)}
          options={[
            { value: "system", label: "Auto" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
            { value: "yellow", label: "Yellow", aria: "Yellow (black text on yellow)" },
          ]}
        />

        <Choice
          label="Colours"
          value={prefs.colourVision}
          onChange={(colourVision) => update({ colourVision })}
          options={[
            { value: "standard", label: "Standard" },
            { value: "red-green", label: "Colour-blind safe", aria: "Colour-blind safe (red-green)" },
          ]}
        />

        <div className="-mx-1.5 space-y-0.5">
          <Toggle
            label="High contrast"
            hint="Darker text and stronger borders"
            checked={prefs.highContrast}
            onChange={(highContrast) => update({ highContrast })}
          />
          <Toggle
            label="Underline links"
            hint="Spot links without relying on colour"
            checked={prefs.underlineLinks}
            onChange={(underlineLinks) => update({ underlineLinks })}
          />
          <Toggle
            label="Reduce motion"
            hint="Turn off animations and sliding"
            checked={prefs.reduceMotion}
            onChange={(reduceMotion) => update({ reduceMotion })}
          />
        </div>

        <Button variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={reset}>
          <RotateCcw className="size-3.5" />
          Reset to default
        </Button>
      </PopoverContent>
    </Popover>
  )
}
