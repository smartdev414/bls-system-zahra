"use client"

import { useState } from "react"
import { Download, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useFetch } from "@/hooks/use-fetch"
import { hoursLabel, receptiveCsv, type ReceptiveEntry, type ReceptiveTotals } from "@/lib/receptive-log"
import { ReceptiveEntryList, ReceptiveTotalsRow } from "@/components/receptive-log/entry-list"

const SHOW_FIRST = 10

/** A student's receptive log as their teacher (or staff) sees it: read-only, with a CSV download. */
export function StudentReceptiveCard({ studentId, studentName }: { studentId: string; studentName: string }) {
  const { data, loading } = useFetch<{ entries: ReceptiveEntry[]; totals: ReceptiveTotals }>(
    `/api/tutor/students/${studentId}/receptive-log`,
    { errorMessage: "Could not load the receptive log" },
  )
  const [showAll, setShowAll] = useState(false)

  function download() {
    if (!data) return
    // BOM so Excel reads the accents and dashes as UTF-8.
    const blob = new Blob(["﻿" + receptiveCsv(data.entries)], { type: "text/csv;charset=utf-8" })
    const a = document.createElement("a")
    a.href = URL.createObjectURL(blob)
    a.download = `Receptive log - ${studentName}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const entries = data?.entries ?? []
  const shown = showAll ? entries : entries.slice(0, SHOW_FIRST)

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm flex items-center justify-between gap-2 flex-wrap">
          <span>
            Receptive log
            <span className="block text-[11px] font-normal text-muted-foreground mt-0.5">
              Signing they watched or took part in outside class, as logged by the student
            </span>
          </span>
          {entries.length > 0 && (
            <Button variant="outline" size="sm" onClick={download}>
              <Download className="size-3.5" /> Download CSV
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {loading && !data ? (
          <div className="flex justify-center py-6"><Loader2 className="size-6 animate-spin text-primary" /></div>
        ) : !data || entries.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Nothing logged yet.</p>
        ) : (
          <>
            <ReceptiveTotalsRow totals={data.totals} />
            <ReceptiveEntryList entries={shown} />
            {entries.length > SHOW_FIRST && (
              <Button variant="ghost" size="sm" className="self-center" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${entries.length} entries (${hoursLabel(data.totals.totalMinutes)})`}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
