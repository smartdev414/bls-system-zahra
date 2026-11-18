"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Check, ChevronLeft, Eye, RotateCcw, Trophy } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ProtectedVideo } from "@/components/ui/protected-video"
import { SignAnswerRecorder } from "@/components/quiz/SignAnswerRecorder"
import type { PracticeSign } from "@/lib/sign-practice"

type Props = {
  signs: PracticeSign[]
  /** "Practise again" — fetches a fresh round. */
  onPlayAgain: () => void
  backHref: string
}

/**
 * Flashcards the other way round, word → sign: the word comes up, the student
 * films themselves signing it, then watches their clip beside the dictionary
 * sign and marks themselves. A card marked "Try again" goes to the back of the
 * pile, as in the flashcards.
 *
 * The student's own revision: the recording never leaves the browser (it is
 * kept as a blob: URL and let go when the card moves on), and nothing is
 * marked or kept on the server.
 */
export function SignItYourself({ signs, onPlayAgain, backHref }: Props) {
  const [pile, setPile] = useState<PracticeSign[]>(signs)
  const [turn, setTurn] = useState(0)
  const [missed, setMissed] = useState<Set<string>>(() => new Set())
  const [videoUrl, setVideoUrl] = useState<string | undefined>()
  const [checking, setChecking] = useState(false)

  // The clip lives in memory only; free it when replaced or when leaving the page.
  const videoRef = useRef<string | undefined>(undefined)
  function setClip(url: string | undefined) {
    if (videoRef.current && videoRef.current !== url) URL.revokeObjectURL(videoRef.current)
    videoRef.current = url
    setVideoUrl(url)
  }
  useEffect(() => () => { if (videoRef.current) URL.revokeObjectURL(videoRef.current) }, [])

  const card = pile[0]
  const done = signs.length - pile.length

  function next(knew: boolean) {
    if (!knew) setMissed(new Set(missed).add(card.id))
    setPile(knew ? pile.slice(1) : [...pile.slice(1), card])
    setClip(undefined)
    setChecking(false)
    setTurn(turn + 1)
  }

  if (!card) {
    const firstTime = signs.length - missed.size
    return (
      <div className="flex flex-col items-center gap-6 py-8 px-4 text-center" aria-live="polite">
        <div className="size-24 rounded-full flex items-center justify-center bg-emerald-100">
          <Trophy className="size-12 text-emerald-600" />
        </div>
        <div>
          <p className="text-3xl font-black">{firstTime} of {signs.length}</p>
          <p className="text-muted-foreground mt-1">matched first time</p>
        </div>
        <Button onClick={onPlayAgain}><RotateCcw className="size-4 mr-1.5" /> Practise again</Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href={backHref}><ChevronLeft className="size-4 mr-1" /> Back to dictionary</Link>
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 py-2 mx-auto w-full max-w-3xl">
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">
          {done} of {signs.length} done{pile.length > 1 ? ` · ${pile.length} to go` : " · last one"}
        </p>
        <Progress value={(done / signs.length) * 100} className="h-1.5" />
      </div>

      <div className="rounded-xl border bg-muted/20 px-4 py-6 text-center">
        <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Sign this word</p>
        <p className="mt-1 text-4xl font-black break-words">{card.answer}</p>
      </div>

      {checking ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">You</p>
              {videoUrl ? (
                <video key={videoUrl} src={videoUrl} autoPlay muted loop playsInline controls className="w-full aspect-video rounded-xl border bg-black object-contain" />
              ) : (
                <div className="w-full aspect-video rounded-xl border border-dashed flex items-center justify-center text-sm text-muted-foreground">Not filmed</div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">The sign</p>
              {card.mediaType === "image" ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={card.imageUrl ?? ""}
                  alt="The sign"
                  className="w-full aspect-video rounded-xl border bg-black object-contain select-none pointer-events-none"
                  draggable={false}
                  onContextMenu={(e) => e.preventDefault()}
                />
              ) : (
                <ProtectedVideo
                  src={card.imageUrl ?? ""}
                  autoPlay muted loop playsInline controls
                  className="w-full aspect-video rounded-xl border bg-black object-contain"
                />
              )}
            </div>
          </div>
          <p className="text-center text-sm text-muted-foreground">Did your signing match?</p>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" className="h-14 text-base font-semibold" onClick={() => next(false)}>
              <RotateCcw className="size-4 mr-1.5" /> Try again later
            </Button>
            <Button className="h-14 text-base font-semibold bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => next(true)}>
              <Check className="size-4 mr-1.5" /> Matched
            </Button>
          </div>
        </>
      ) : (
        <>
          <SignAnswerRecorder
            key={turn}
            lessonId=""
            videoUrl={videoUrl}
            onChange={setClip}
            upload={async (file) => URL.createObjectURL(file)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setChecking(true)} disabled={!videoUrl}>
              <Eye className="size-4 mr-1.5" /> Compare with the sign
            </Button>
            {!videoUrl && (
              <button
                type="button"
                className="text-sm text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => setChecking(true)}
              >
                I don&apos;t know it — show me the sign
              </button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">Your video stays on this device. It isn&apos;t saved or sent to your teacher.</p>
        </>
      )}
    </div>
  )
}
