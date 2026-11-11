"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Loader2, MessageSquarePlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useFetch } from "@/hooks/use-fetch"
import { cn } from "@/lib/utils"

type SignRequest = {
  id: string
  word: string
  context: string
  status: "OPEN" | "ADDED" | "DECLINED"
  /** The admin is researching the word before adding it. */
  held?: boolean
  createdAt: string
}

const STATUS: Record<SignRequest["status"], { label: string; className: string }> = {
  OPEN: { label: "Waiting", className: "bg-amber-50 text-amber-700 border-amber-200" },
  ADDED: { label: "Added", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  DECLINED: { label: "Not added", className: "bg-muted text-muted-foreground" },
}
const HELD = { label: "Looking into it", className: "bg-sky-50 text-sky-700 border-sky-200" }

/**
 * A student asks for a word that isn't in the dictionary, with an example of
 * how they'd use it. The admin films it and the student gets an email.
 */
export function RequestSignDialog({ initialWord, onClose, onShowSign }: {
  initialWord: string
  onClose: () => void
  /** Search the dictionary for a word that turned out to be there already. */
  onShowSign: (word: string) => void
}) {
  const [word, setWord] = useState(initialWord)
  const [context, setContext] = useState("")
  const [sending, setSending] = useState(false)
  const { data } = useFetch<{ requests: SignRequest[] }>("/api/dictionary/requests")
  const requests = data?.requests ?? []

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!word.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch("/api/dictionary/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word, context }),
      })
      const body = await res.json().catch(() => ({})) as { message?: string; word?: string }
      if (res.status === 409 && body.word) {
        toast.info(body.message ?? "That sign is already in the dictionary")
        onShowSign(body.word)
        return
      }
      if (!res.ok) throw new Error(body.message ?? "Could not send your request")
      toast.success("Request sent — we'll email you when the sign is added")
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not send your request")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquarePlus className="size-5 text-primary" /> Ask for a new sign
          </DialogTitle>
          <DialogDescription>
            Tell us the word you want to learn. We&apos;ll film it and email you when it&apos;s in the dictionary.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="request-word">New sign</Label>
            <Input
              id="request-word"
              value={word}
              onChange={(e) => setWord(e.target.value)}
              placeholder="e.g. Appointment"
              maxLength={60}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="request-context">
              Context <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="request-context"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              placeholder="e.g. At the doctor's: “I have an appointment at 3pm”"
              maxLength={300}
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              An example helps when a word has more than one sign.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={!word.trim() || sending} className="w-full sm:w-auto">
              {sending && <Loader2 className="size-4 mr-1.5 animate-spin" />}
              Send request
            </Button>
          </DialogFooter>
        </form>

        {requests.length > 0 && (
          <div className="border-t pt-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-2">Your requests</p>
            <ul className="space-y-1.5">
              {requests.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 text-sm">
                  {r.status === "ADDED" ? (
                    <button
                      type="button"
                      onClick={() => onShowSign(r.word)}
                      className="truncate font-medium text-primary hover:underline"
                    >
                      {r.word}
                    </button>
                  ) : (
                    <span className="truncate font-medium">{r.word}</span>
                  )}
                  <Badge variant="outline" className={cn("shrink-0 text-[10px]", (r.held ? HELD : STATUS[r.status]).className)}>
                    {(r.held ? HELD : STATUS[r.status]).label}
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
