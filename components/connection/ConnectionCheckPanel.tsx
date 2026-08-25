"use client"

/**
 * "Will this work from my workplace?" — the page a student on an NHS, police,
 * council or school network opens before their first class.
 *
 * It runs the real classroom connection, tells them in plain English what
 * happened, and then does something about it: applies the network mode that
 * works, or hands them a report and a requirements link precise enough for an
 * IT ticket. Everything below the verdict exists to make that ticket succeed
 * first time — a student who has to go back to IT twice usually misses a term.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  CheckCircle2, XCircle, AlertTriangle, Loader2, MinusCircle, Circle,
  ShieldCheck, Copy, RefreshCw, ExternalLink, ChevronDown, Wifi,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  runConnectivityCheck, initialResults, buildItReport,
  type CheckResult, type CheckState, type CheckRun,
} from "@/lib/connectivity-check"
import {
  NETWORK_MODE_DESCRIPTIONS, NETWORK_MODE_LABELS, NETWORK_MODES,
  readNetworkMode, writeNetworkMode, type NetworkMode,
} from "@/lib/network-mode"

type Config = {
  appHost: string | null
  storageHost: string | null
  livekitConfigured: boolean
  pusherConfigured: boolean
}

// ─── Row ──────────────────────────────────────────────────────────────────────

const STATE_ICON: Record<CheckState, React.ReactNode> = {
  pending: <Circle className="size-4 text-muted-foreground/40" />,
  running: <Loader2 className="size-4 animate-spin text-primary" />,
  pass:    <CheckCircle2 className="size-4 text-emerald-600" />,
  warn:    <AlertTriangle className="size-4 text-amber-600" />,
  fail:    <XCircle className="size-4 text-destructive" />,
  skipped: <MinusCircle className="size-4 text-muted-foreground/50" />,
}

function CheckRow({ result }: { result: CheckResult }) {
  const [open, setOpen] = useState(false)
  const hasDetail = result.detail.length > 0

  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-colors",
        result.state === "fail" && result.essential && "border-destructive/40 bg-destructive/5",
        result.state === "warn" && "border-amber-300/60 bg-amber-50/50 dark:bg-amber-950/20",
      )}
    >
      <div className="flex items-start gap-3 p-3.5">
        <span className="mt-0.5 shrink-0">{STATE_ICON[result.state]}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold">{result.title}</p>
            {result.state === "fail" && !result.essential && (
              <Badge variant="outline" className="text-[10px]">Not needed for class</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{result.summary}</p>
        </div>
        {hasDetail && (
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="shrink-0"
          >
            Details
            <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
          </Button>
        )}
      </div>
      {open && hasDetail && (
        <pre className="mx-3.5 mb-3.5 max-h-64 overflow-auto rounded-lg bg-muted/60 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
          {result.detail.join("\n")}
        </pre>
      )}
    </div>
  )
}

// ─── Mode picker ──────────────────────────────────────────────────────────────

function ModePicker({
  mode, onChange, recommended,
}: {
  mode: NetworkMode
  onChange: (m: NetworkMode) => void
  recommended: NetworkMode | null
}) {
  return (
    <div className="flex flex-col gap-2">
      {NETWORK_MODES.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onChange(m)}
          className={cn(
            "flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
            mode === m ? "border-primary bg-primary/5" : "hover:bg-muted/50",
          )}
        >
          <span
            className={cn(
              "mt-0.5 size-4 shrink-0 rounded-full border-2 transition-colors",
              mode === m ? "border-primary bg-primary" : "border-muted-foreground/40",
            )}
          />
          <span className="min-w-0">
            <span className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold">{NETWORK_MODE_LABELS[m]}</span>
              {recommended === m && (
                <Badge className="text-[10px]">Recommended for this network</Badge>
              )}
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {NETWORK_MODE_DESCRIPTIONS[m]}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function ConnectionCheckPanel() {
  const [config, setConfig] = useState<Config | null>(null)
  const [results, setResults] = useState<CheckResult[]>(initialResults)
  const [run, setRun] = useState<CheckRun | null>(null)
  const [running, setRunning] = useState(false)
  const [mode, setMode] = useState<NetworkMode>("standard")
  const startedRef = useRef(false)

  useEffect(() => { setMode(readNetworkMode()) }, [])

  useEffect(() => {
    let cancelled = false
    fetch("/api/connectivity", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((c: Config | null) => { if (!cancelled && c) setConfig(c) })
      .catch(() => { /* the platform check will report this properly */ })
    return () => { cancelled = true }
  }, [])

  const start = useCallback(async () => {
    if (running) return
    setRunning(true)
    setRun(null)
    setResults(initialResults())
    try {
      const outcome = await runConnectivityCheck(
        {
          storageHost:       config?.storageHost ?? null,
          livekitConfigured: config?.livekitConfigured ?? true,
          pusherConfigured:  config?.pusherConfigured ?? false,
        },
        setResults,
      )
      setRun(outcome)
      setResults(outcome.results)
    } finally {
      setRunning(false)
    }
  }, [config, running])

  // Start automatically once, as soon as the endpoint inventory has loaded.
  // Someone who opened this page is already having trouble; making them press
  // a button first is friction for no gain.
  useEffect(() => {
    if (config && !startedRef.current) {
      startedRef.current = true
      void start()
    }
  }, [config, start])

  const applyMode = (m: NetworkMode) => {
    setMode(m)
    writeNetworkMode(m)
    toast.success(`${NETWORK_MODE_LABELS[m]} saved for this computer`)
  }

  const [showReport, setShowReport] = useState(false)

  const copyReport = async () => {
    if (!run) return
    const text = buildItReport(run, {
      appHost: config?.appHost ?? null,
      userAgent: navigator.userAgent,
    })
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Report copied — paste it into your IT ticket")
    } catch {
      // Clipboard access is itself sometimes blocked by policy on these
      // machines, so always leave a path that needs no permission.
      toast.error("Couldn't copy automatically — the report is shown below to copy by hand")
      setShowReport(true)
    }
  }

  const verdictTone =
    run?.verdict.recommendedMode === null ? "fail"
      : run?.verdict.recommendedMode === "standard" ? "pass"
        : "warn"

  return (
    <div className="flex flex-col gap-6">
      {/* ── Verdict ── */}
      <div
        className={cn(
          "rounded-2xl border p-5",
          !run && "bg-muted/40",
          run && verdictTone === "pass" && "border-emerald-300 bg-emerald-50/60 dark:bg-emerald-950/20",
          run && verdictTone === "warn" && "border-amber-300 bg-amber-50/60 dark:bg-amber-950/20",
          run && verdictTone === "fail" && "border-destructive/40 bg-destructive/5",
        )}
      >
        <div className="flex items-start gap-4">
          <span className="mt-0.5 shrink-0">
            {running
              ? <Loader2 className="size-6 animate-spin text-primary" />
              : run
                ? verdictTone === "pass" ? <CheckCircle2 className="size-6 text-emerald-600" />
                  : verdictTone === "warn" ? <AlertTriangle className="size-6 text-amber-600" />
                    : <XCircle className="size-6 text-destructive" />
                : <Wifi className="size-6 text-muted-foreground" />}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-black leading-tight">
              {running ? "Testing your connection…" : run ? run.verdict.headline : "Ready to test"}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {running
                ? "This makes a real connection to the classroom servers, so it takes up to a minute."
                : run
                  ? run.verdict.explanation
                  : "We'll connect to the classroom exactly the way a live class does, then tell you what your network allows."}
            </p>

            {run?.verdict.recommendedMode && run.verdict.recommendedMode !== mode && (
              <Button className="mt-3" onClick={() => applyMode(run.verdict.recommendedMode!)}>
                <ShieldCheck />
                Switch to {NETWORK_MODE_LABELS[run.verdict.recommendedMode]}
              </Button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={start} disabled={running} className="shrink-0">
            <RefreshCw className={cn(running && "animate-spin")} />
            {run ? "Test again" : "Test now"}
          </Button>
        </div>
      </div>

      {/* ── Individual checks ── */}
      <div className="flex flex-col gap-2">
        {results.map((r) => <CheckRow key={r.id} result={r} />)}
      </div>

      {/* ── Mode ── */}
      <div className="rounded-2xl border p-5">
        <h3 className="text-sm font-black">How this computer connects</h3>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          Saved for this computer only. Your own laptop at home keeps its own setting.
        </p>
        <ModePicker mode={mode} onChange={applyMode} recommended={run?.verdict.recommendedMode ?? null} />
      </div>

      {/* ── For IT ── */}
      <div className="rounded-2xl border p-5">
        <h3 className="text-sm font-black">Need your IT team to allow something?</h3>
        <p className="text-xs text-muted-foreground mt-1 mb-4">
          Send them the requirements page — it lists the exact hosts, ports and reasons, and needs no login.
          Attach the test report so they can see what failed here.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/it-requirements" target="_blank">
              <ExternalLink />
              Open the IT requirements page
            </Link>
          </Button>
          <Button variant="outline" onClick={copyReport} disabled={!run}>
            <Copy />
            Copy test report
          </Button>
          {run && (
            <Button variant="ghost" onClick={() => setShowReport((v) => !v)}>
              {showReport ? "Hide report" : "Show report"}
            </Button>
          )}
        </div>
        {showReport && run && (
          <pre className="mt-4 max-h-80 overflow-auto rounded-lg bg-muted/60 p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
            {buildItReport(run, { appHost: config?.appHost ?? null, userAgent: navigator.userAgent })}
          </pre>
        )}
      </div>
    </div>
  )
}
