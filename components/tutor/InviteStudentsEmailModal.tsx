"use client"

import { useState, useRef, KeyboardEvent, ClipboardEvent } from "react"
import { UserPlus, Send, Loader2, Clock, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { useFetch } from "@/hooks/use-fetch"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

type InviteRecord = {
  id: string
  email: string
  status: "PENDING" | "ACCEPTED" | "EXPIRED"
  createdAt: string
  expiresAt: string
}

const statusColor: Record<string, string> = {
  PENDING:  "bg-amber-100 text-amber-700 border-amber-200",
  ACCEPTED: "bg-emerald-100 text-emerald-700 border-emerald-200",
  EXPIRED:  "bg-muted text-muted-foreground border-border",
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function InviteStudentsEmailModal({ onClose }: { onClose: () => void }) {
  const [emails, setEmails] = useState<string[]>([])
  const [inputValue, setInputValue] = useState("")
  const [sending, setSending] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { data, loading, refetch } = useFetch<{ invites: InviteRecord[] }>("/api/tutor/invites", {
    errorMessage: "Could not load invitations",
  })

  const invites = data?.invites ?? []

  function commitInput(raw: string) {
    const parts = raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
    const valid: string[] = []
    const invalid: string[] = []
    for (const p of parts) {
      if (isValidEmail(p) && !emails.includes(p)) valid.push(p)
      else if (p) invalid.push(p)
    }
    if (valid.length) setEmails((prev) => [...prev, ...valid])
    if (invalid.length) toast.error(`Invalid or duplicate: ${invalid.join(", ")}`)
    setInputValue("")
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (["Enter", ",", ";", " ", "Tab"].includes(e.key)) {
      e.preventDefault()
      if (inputValue.trim()) commitInput(inputValue)
    } else if (e.key === "Backspace" && !inputValue && emails.length) {
      setEmails((prev) => prev.slice(0, -1))
    }
  }

  function handlePaste(e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault()
    commitInput(e.clipboardData.getData("text"))
  }

  function removeEmail(email: string) {
    setEmails((prev) => prev.filter((e) => e !== email))
  }

  async function handleSend() {
    const all = [...emails]
    if (inputValue.trim()) {
      if (isValidEmail(inputValue)) {
        all.push(inputValue.trim())
        setInputValue("")
      } else {
        toast.error("Fix the email address before sending")
        return
      }
    }

    if (all.length === 0) {
      toast.error("Add at least one email address")
      return
    }

    setSending(true)
    try {
      const res = await fetch("/api/tutor/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: all }),
      })
      const result = await res.json()
      if (!res.ok) { toast.error(result.message ?? "Failed to send invites"); return }

      const sentCount = result.sent?.length ?? 0
      const skippedCount = result.skipped?.length ?? 0
      if (sentCount > 0) toast.success(`${sentCount} invitation${sentCount !== 1 ? "s" : ""} sent`)
      if (skippedCount > 0) toast.info(`${skippedCount} email${skippedCount !== 1 ? "s" : ""} skipped (already have accounts)`)
      setEmails([])
      setInputValue("")
      refetch()
    } catch {
      toast.error("Something went wrong")
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="size-4 text-primary" /> Invite Students by Email
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            Enter email addresses to send invitation links. Students will create a student account and be linked to you.
          </p>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {/* Tag input */}
          <div
            className={cn(
              "min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
              "flex flex-wrap gap-1.5 cursor-text focus-within:ring-1 focus-within:ring-ring"
            )}
            onClick={() => inputRef.current?.focus()}
          >
            {emails.map((email) => (
              <span
                key={email}
                className="inline-flex items-center gap-1 rounded bg-primary/10 text-primary text-xs font-medium px-1.5 py-0.5"
              >
                {email}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeEmail(email) }}
                  className="rounded-sm opacity-60 hover:opacity-100 cursor-pointer transition-opacity"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={() => { if (inputValue.trim()) commitInput(inputValue) }}
              placeholder={emails.length === 0 ? "alice@example.com, bob@example.com…" : ""}
              className="flex-1 min-w-[180px] bg-transparent outline-none placeholder:text-muted-foreground text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">Press <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">Enter</kbd>, <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">,</kbd> or <kbd className="px-1 py-0.5 rounded bg-muted text-[10px] font-mono">Space</kbd> to add each address.</p>
          <Button onClick={handleSend} disabled={sending || (emails.length === 0 && !inputValue.trim())} className="gap-1.5">
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {sending ? "Sending…" : `Send Invitation${emails.length > 1 ? `s (${emails.length})` : ""}`}
          </Button>
        </div>

        <Separator />

        <div>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
            <Clock className="size-3.5 text-muted-foreground" /> Sent Invitations
          </h4>
          {loading ? (
            <div className="flex justify-center py-4"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div>
          ) : invites.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No invitations sent yet.</p>
          ) : (
            <div className="flex flex-col gap-1 max-h-52 overflow-y-auto pr-1">
              {invites.map((inv) => (
                <div key={inv.id} className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{inv.email}</p>
                    <p className="text-xs text-muted-foreground">
                      Sent {new Date(inv.createdAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}
                      {" · "}Expires {new Date(inv.expiresAt).toLocaleDateString("en-GB", { dateStyle: "medium" })}
                    </p>
                  </div>
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${statusColor[inv.status]}`}>
                    {inv.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
