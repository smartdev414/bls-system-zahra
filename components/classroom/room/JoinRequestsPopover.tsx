"use client"

import { useRef, useEffect } from "react"
import { UserPlus, Check, XCircle, X } from "lucide-react"
import type { JoinRequest } from "./types"

function JoinRequestRow({
  request,
  disabled,
  onAction,
}: {
  request: JoinRequest
  disabled: boolean
  onAction: (requestId: string, action: "approve" | "reject", message?: string) => void
}) {
  const initials = request.student.name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
  return (
    <div className="px-4 py-3 flex flex-col gap-2">
      <div className="flex items-start gap-2.5">
        <div className="size-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-[11px] font-bold shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-zinc-100 truncate">{request.student.name}</p>
          <p className="text-[10px] text-zinc-500 truncate">{request.student.email}</p>
          {request.message && (
            <p className="mt-1.5 text-[11px] text-zinc-300 bg-zinc-800/60 rounded-md px-2 py-1.5 leading-snug">
              &ldquo;{request.message}&rdquo;
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1.5 justify-end">
        <button
          disabled={disabled}
          onClick={() => onAction(request.id, "reject")}
          className="h-6 px-2 text-[11px] rounded-md border border-zinc-700 text-zinc-300 hover:bg-zinc-800 disabled:opacity-50 flex items-center gap-1"
        >
          <XCircle className="size-3" /> Decline
        </button>
        <button
          disabled={disabled}
          onClick={() => onAction(request.id, "approve")}
          className="h-6 px-2 text-[11px] rounded-md bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 flex items-center gap-1"
        >
          <Check className="size-3" /> Approve
        </button>
      </div>
    </div>
  )
}

export function JoinRequestsPopover({
  requests,
  loading,
  onAction,
  onClose,
}: {
  requests: JoinRequest[]
  loading: boolean
  onAction: (requestId: string, action: "approve" | "reject", message?: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl z-50 flex flex-col"
    >
      <div className="px-4 py-2.5 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
          <UserPlus className="size-3.5 text-amber-400" />
          Join Requests {requests.length > 0 && (
            <span className="text-amber-400">({requests.length})</span>
          )}
        </span>
        <button
          onClick={onClose}
          className="text-zinc-500 hover:text-zinc-200 transition-colors"
          aria-label="Close"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {requests.length === 0 ? (
          <div className="py-10 px-4 text-center text-xs text-zinc-500">
            No pending requests.
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {requests.map((r) => (
              <JoinRequestRow key={r.id} request={r} disabled={loading} onAction={onAction} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
