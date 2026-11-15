"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Eye, Loader2 } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useFetch } from "@/hooks/use-fetch"
import { netJson } from "@/lib/net-fetch"
import { totalsOf, type ReceptiveEntry, type ReceptiveInput, type ReceptiveTotals } from "@/lib/receptive-log"
import { ReceptiveEntryForm } from "@/components/receptive-log/entry-form"
import { ReceptiveEntryList, ReceptiveTotalsRow } from "@/components/receptive-log/entry-list"

type LogData = { entries: ReceptiveEntry[]; totals: ReceptiveTotals }

const byNewest = (a: ReceptiveEntry, b: ReceptiveEntry) => b.date.localeCompare(a.date)

/**
 * The student's receptive log: time spent outside class watching signing —
 * TV with signing, Deaf events, meeting Deaf people. Their teachers can see it.
 */
export default function ReceptiveLogPage() {
  const { data, loading, mutate } = useFetch<LogData>("/api/student/receptive-log", {
    errorMessage: "Could not load your receptive log",
  })
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<ReceptiveEntry | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  // Keep the list and the totals in step without reloading.
  const setEntries = (fn: (list: ReceptiveEntry[]) => ReceptiveEntry[]) =>
    mutate((d) => {
      const entries = fn(d?.entries ?? []).sort(byNewest)
      return { entries, totals: totalsOf(entries) }
    })

  async function add(input: ReceptiveInput) {
    setAdding(true)
    try {
      const { entry } = await netJson<{ entry: ReceptiveEntry }>(
        "/api/student/receptive-log",
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
        { retries: 0 },
      )
      setEntries((list) => [entry, ...list])
      toast.success("Added to your log")
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that")
      return false
    } finally {
      setAdding(false)
    }
  }

  async function saveEdit(input: ReceptiveInput) {
    if (!editing) return false
    setSavingEdit(true)
    try {
      const { entry } = await netJson<{ entry: ReceptiveEntry }>(
        `/api/student/receptive-log/${editing.id}`,
        { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) },
        { retries: 0 },
      )
      setEntries((list) => list.map((e) => (e.id === entry.id ? entry : e)))
      setEditing(null)
      toast.success("Saved")
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that")
      return false
    } finally {
      setSavingEdit(false)
    }
  }

  async function remove(entry: ReceptiveEntry) {
    if (!window.confirm(`Delete "${entry.title}" from your log?`)) return
    setBusyId(entry.id)
    try {
      await netJson(`/api/student/receptive-log/${entry.id}`, { method: "DELETE" }, { retries: 0 })
      setEntries((list) => list.filter((e) => e.id !== entry.id))
      toast.success("Deleted")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete that")
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <Eye className="size-6 text-primary" />
          Receptive log
        </h1>
        <p className="text-muted-foreground mt-1">
          Log the time you spend outside class watching signing: TV with signing, BSL films, Deaf events, meeting Deaf people.
          Your teachers can see this log.
        </p>
      </div>

      {data && <ReceptiveTotalsRow totals={data.totals} />}

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-6 items-start">
        <Card className="shadow-sm lg:sticky lg:top-20">
          <CardHeader><CardTitle className="text-base">Add to your log</CardTitle></CardHeader>
          <CardContent>
            <ReceptiveEntryForm saving={adding} submitLabel="Add" onSubmit={add} />
          </CardContent>
        </Card>

        <div className="min-w-0">
          {loading && !data ? (
            <div className="flex justify-center py-12"><Loader2 className="size-8 animate-spin text-primary" /></div>
          ) : !data?.entries.length ? (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">
              Nothing logged yet. Add your first entry: what you watched or who you met, and for how long.
            </CardContent></Card>
          ) : (
            <ReceptiveEntryList entries={data.entries} onEdit={setEditing} onDelete={remove} busyId={busyId} />
          )}
        </div>
      </div>

      <Dialog open={!!editing} onOpenChange={(open) => !open && !savingEdit && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit entry</DialogTitle>
            <DialogDescription>Change any detail and save.</DialogDescription>
          </DialogHeader>
          {editing && (
            <ReceptiveEntryForm
              key={editing.id} initial={editing} saving={savingEdit} submitLabel="Save"
              onSubmit={saveEdit} onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
