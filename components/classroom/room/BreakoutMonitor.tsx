"use client"

import { useMemo, useState } from "react"
import {
  useParticipants,
  useTracks,
  VideoTrack,
  AudioTrack,
  isTrackReference,
} from "@livekit/components-react"
import { Track } from "livekit-client"
import { X, Eye, LogIn, LogOut, Focus, Minimize2, Mic, MicOff, Users2, Bell, TimerReset, AudioLines } from "lucide-react"
import { cn } from "@/lib/utils"
import { participantBaseId } from "@/lib/participant-identity"
import type { BreakoutGroup } from "./types"
import { BreakoutCountdown } from "./BreakoutCountdown"
import { useSpeechBySpeaker, type SpokenLine } from "./useSpeechBySpeaker"

/** A student counts as "talking" if they were captioned this recently. */
const SPOKE_RECENTLY_MS = 15_000

/**
 * What a group has said aloud, newest last. Students are meant to sign, so any
 * line here is worth the tutor's attention — which is why it is shown at all.
 */
function SpokenStrip({ lines }: { lines: SpokenLine[] }) {
  if (lines.length === 0) return null
  return (
    <div className="rounded-lg bg-amber-500/10 border border-amber-500/25 px-2.5 py-1.5 flex flex-col gap-0.5" aria-live="polite">
      <p className="flex items-center gap-1 text-[0.625rem] font-bold uppercase tracking-wide text-amber-300/90">
        <AudioLines className="size-3" /> Heard in this group
      </p>
      {lines.map((l) => (
        <p key={`${l.identity}:${l.id}`} className="text-xs leading-snug text-zinc-100">
          <span className="font-semibold text-amber-200 mr-1">{l.name}:</span>
          <span className={cn(!l.final && "italic opacity-80")}>{l.text}</span>
        </p>
      ))}
    </div>
  )
}

export function BreakoutMonitor({
  groups,
  visitingGroupId,
  onVisit,
  onClose,
  onNudgeGroup,
  onExtend,
  endsAt,
  closing,
}: {
  groups: BreakoutGroup[]
  visitingGroupId: string | null
  onVisit: (groupId: string | null) => void
  onClose: () => void
  onNudgeGroup: (groupId: string) => void
  /** Push the deadline out by N minutes without recreating the rooms. */
  onExtend: (minutes: number) => void
  endsAt: number | null
  /** True once the wrap-up countdown back to the main room has started. */
  closing: boolean
}) {
  const participants = useParticipants()
  const camTracks    = useTracks([Track.Source.Camera])
  const micTracks    = useTracks([Track.Source.Microphone], { onlySubscribed: true })

  const [focusedIdentity, setFocusedIdentity] = useState<string | null>(null)
  const { bySpeaker, now } = useSpeechBySpeaker()

  // Group membership is stored as stable user ids so it survives reconnects —
  // index live participants the same way to look them up.
  const participantByBaseId = useMemo(
    () => new Map(participants.map((p) => [participantBaseId(p.identity), p])),
    [participants]
  )
  const participantById = useMemo(
    () => new Map(participants.map((p) => [p.identity, p])),
    [participants]
  )
  const trackByIdentity = useMemo(() => {
    const map = new Map<string, (typeof camTracks)[number]>()
    for (const t of camTracks) {
      if (isTrackReference(t)) map.set(t.participant.identity, t)
    }
    return map
  }, [camTracks])

  const focusedParticipant = focusedIdentity ? participantById.get(focusedIdentity) : null
  const focusedTrack       = focusedIdentity ? trackByIdentity.get(focusedIdentity) : undefined
  // While focused, play the student's mic even though the main AudioRenderer
  // is muted (tutor isn't "visiting" their group). Monitor-only listening.
  const focusedMic = focusedIdentity
    ? micTracks.find((t) => t.participant.identity === focusedIdentity && isTrackReference(t))
    : undefined

  return (
    <div className="fixed inset-0 z-[85] bg-zinc-950/98 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="size-4 text-emerald-400 shrink-0" />
          <h2 className="text-sm font-bold text-white truncate">
            {focusedParticipant
              ? `Observing ${focusedParticipant.name ?? focusedIdentity}`
              : "Breakout monitor — observe every group"}
          </h2>
          {!focusedParticipant && (
            <span className="hidden md:inline text-[0.6875rem] text-zinc-500 ml-1">
              · tiles are silent — anything said aloud is captioned under the group. Click a student to listen. Click &ldquo;Visit&rdquo; to speak to their group.
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <BreakoutCountdown endsAt={endsAt} closing={closing} />
          <div className="flex items-center gap-1">
            <TimerReset className="size-3.5 text-zinc-500" />
            {[5, 10].map((n) => (
              <button
                key={n}
                onClick={() => onExtend(n)}
                className="px-2 h-7 rounded-lg text-[0.6875rem] font-semibold bg-zinc-800 hover:bg-sky-600 hover:text-white text-zinc-200 transition-colors"
                title={`Add ${n} more minutes — groups stay exactly as they are`}
              >
                +{n} min
              </button>
            ))}
          </div>
          {focusedParticipant && (
            <button
              onClick={() => setFocusedIdentity(null)}
              className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            >
              <Minimize2 className="size-3.5" /> Back to grid
            </button>
          )}
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-2.5 h-8 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
            aria-label="Close monitor"
          >
            <X className="size-3.5" /> Close monitor
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4">
        {focusedParticipant ? (
          <div className="h-full flex flex-col items-center justify-center">
            <div className="relative w-full max-w-5xl aspect-video bg-zinc-900 rounded-2xl overflow-hidden shadow-2xl border border-zinc-800">
              {focusedTrack ? (
                <VideoTrack trackRef={focusedTrack} className="w-full h-full object-contain" />
              ) : (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600">
                  <div className="size-24 rounded-full bg-primary/10 flex items-center justify-center text-primary text-4xl font-bold">
                    {(focusedParticipant.name ?? focusedIdentity ?? "?")[0]?.toUpperCase()}
                  </div>
                  <span className="text-sm">
                    {focusedParticipant.name ?? focusedIdentity} · Camera off
                  </span>
                </div>
              )}
              <div className="absolute bottom-3 left-3 bg-black/70 backdrop-blur-sm text-white text-xs px-3 py-1.5 rounded-full flex items-center gap-2">
                <span className="font-medium">{focusedParticipant.name ?? focusedIdentity}</span>
                {focusedParticipant.isMicrophoneEnabled ? (
                  <Mic className="size-3 text-emerald-400" />
                ) : (
                  <MicOff className="size-3 text-zinc-500" />
                )}
                <span className="ml-1 text-[0.625rem] text-zinc-400">· you&rsquo;re listening silently</span>
              </div>
              {focusedMic && isTrackReference(focusedMic) && (
                <AudioTrack trackRef={focusedMic} />
              )}
            </div>
            {focusedIdentity && (bySpeaker.get(focusedIdentity)?.length ?? 0) > 0 && (
              <div className="w-full max-w-5xl mt-3">
                <SpokenStrip lines={bySpeaker.get(focusedIdentity) ?? []} />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.length === 0 && (
              <p className="text-center text-sm text-zinc-500 py-10">
                No breakout groups yet — open the Breakouts panel to create some.
              </p>
            )}

            {groups.map((g) => {
              const isVisiting = visitingGroupId === g.id
              const members = g.memberIds
                .map((baseId) => {
                  const participant = participantByBaseId.get(baseId)
                  return {
                    identity: participant?.identity ?? baseId,
                    participant,
                    trackRef: participant ? trackByIdentity.get(participant.identity) : undefined,
                  }
                })
                .filter((m) => !!m.participant)
              // Everything this group said aloud, in order — last few lines only.
              const groupSpeech = members
                .flatMap((m) => bySpeaker.get(m.identity) ?? [])
                .sort((a, b) => a.at - b.at)
                .slice(-4)

              return (
                <section key={g.id} className="flex flex-col gap-2">
                  <header className="flex items-center gap-2">
                    <Users2 className={cn(
                      "size-4",
                      isVisiting ? "text-emerald-400" : "text-zinc-400"
                    )} />
                    <h3 className="text-sm font-bold text-white">{g.name}</h3>
                    <span className="text-[0.6875rem] text-zinc-500">
                      · {members.length} student{members.length !== 1 ? "s" : ""}
                    </span>
                    {isVisiting && (
                      <span className="inline-flex items-center gap-1 text-[0.625rem] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40">
                        <span className="relative flex size-1.5">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                          <span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" />
                        </span>
                        You&rsquo;re in this group
                      </span>
                    )}
                    <div className="ml-auto flex items-center gap-1.5">
                      <button
                        onClick={() => onNudgeGroup(g.id)}
                        disabled={members.length === 0}
                        className="flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[0.6875rem] font-semibold bg-zinc-800 hover:bg-amber-500/25 hover:text-amber-300 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Flash a short attention alert on this group's screens"
                      >
                        <Bell className="size-3" /> Nudge
                      </button>
                      {isVisiting ? (
                        <button
                          onClick={() => onVisit(null)}
                          className="flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[0.6875rem] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
                        >
                          <LogOut className="size-3" /> Leave group
                        </button>
                      ) : (
                        <button
                          onClick={() => onVisit(g.id)}
                          disabled={members.length === 0}
                          className="flex items-center gap-1.5 px-2.5 h-7 rounded-lg text-[0.6875rem] font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 disabled:opacity-40 disabled:cursor-not-allowed"
                          title="Enter this group — your audio goes to them and you hear theirs"
                        >
                          <LogIn className="size-3" /> Visit group
                        </button>
                      )}
                    </div>
                  </header>

                  {members.length === 0 ? (
                    <p className="text-xs text-zinc-600 italic px-1">No one assigned yet.</p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
                      {members.map((m) => {
                        const displayName = m.participant?.name ?? m.identity
                        const micOn = !!m.participant?.isMicrophoneEnabled
                        const camOn = !!m.trackRef
                        const lastSpoke = bySpeaker.get(m.identity)?.at(-1)?.at ?? 0
                        const talking = now - lastSpoke <= SPOKE_RECENTLY_MS

                        return (
                          <button
                            key={m.identity}
                            onClick={() => setFocusedIdentity(m.identity)}
                            className={cn(
                              "relative rounded-lg overflow-hidden aspect-video bg-zinc-800 border border-zinc-700 hover:border-primary transition-colors group",
                              isVisiting && "ring-1 ring-emerald-500/30",
                              talking && "border-amber-400 ring-2 ring-amber-400/50",
                            )}
                            title={`Focus on ${displayName}`}
                          >
                            {camOn && m.trackRef ? (
                              <VideoTrack trackRef={m.trackRef} className="w-full h-full object-cover" />
                            ) : (
                              <div className="flex flex-col items-center justify-center h-full gap-1 text-zinc-500">
                                <div className="size-8 rounded-full bg-primary/15 text-primary font-bold flex items-center justify-center">
                                  {displayName[0]?.toUpperCase()}
                                </div>
                                <span className="text-[0.625rem]">camera off</span>
                              </div>
                            )}

                            <div className="absolute bottom-0 inset-x-0 bg-linear-to-t from-black/80 to-transparent px-1.5 pb-0.5 flex items-center gap-1">
                              <p className="flex-1 text-[0.625rem] text-white truncate font-medium text-left">
                                {displayName}
                              </p>
                              {micOn ? (
                                <Mic className="size-3 text-emerald-400 shrink-0" />
                              ) : (
                                <MicOff className="size-3 text-zinc-500 shrink-0" />
                              )}
                            </div>

                            {talking && (
                              <div className="absolute top-1 left-1 flex items-center gap-1 rounded-md bg-amber-500/90 px-1.5 py-0.5 text-[0.625rem] font-bold text-black">
                                <AudioLines className="size-3" /> Talking
                              </div>
                            )}

                            <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 rounded-md p-1">
                              <Focus className="size-3 text-white" />
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  <SpokenStrip lines={groupSpeech} />
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
