"use client"

import { Settings, Lock, Eye, EyeOff, UserCheck, GraduationCap, Loader2 } from "lucide-react"
import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Checkbox } from "@/components/ui/checkbox"
import { useFetch, usePutCallback } from "@/hooks/use-fetch"

export default function AdminSettingsPage() {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)

  const { execute: savePassword, loading } = usePutCallback<
    { message: string },
    { currentPassword: string; newPassword: string }
  >("/api/user/password", {
    successMessage: "Password updated",
    errorMessage: "Could not update password",
    onSuccess: () => { setCurrentPassword(""); setNewPassword(""); setConfirmPassword("") },
  })

  return (
    <div className="max-w-2xl flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-black tracking-tight flex items-center gap-2">
          <Settings className="size-6 text-primary" /> Admin Settings
        </h1>
        <p className="text-muted-foreground mt-1">Platform and account configuration.</p>
      </div>

      <SignupApprovalCard />

      <SubscriptionLinkCard />

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="size-4 text-primary" /> Change Password
          </CardTitle>
          <CardDescription>Update your admin account password.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              savePassword({ currentPassword, newPassword })
            }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-1.5">
              <Label>Current Password</Label>
              <div className="relative">
                <Input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required className="pr-10"
                />
                <button type="button" aria-label={showCurrent ? "Hide password" : "Show password"} onClick={() => setShowCurrent((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-md text-muted-foreground hover:text-foreground">
                  {showCurrent ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>New Password</Label>
              <div className="relative">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={8} required className="pr-10"
                />
                <button type="button" aria-label={showNew ? "Hide password" : "Show password"} onClick={() => setShowNew((v) => !v)}
                  className="absolute right-1 top-1/2 -translate-y-1/2 p-2 rounded-md text-muted-foreground hover:text-foreground">
                  {showNew ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Confirm New Password</Label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>
            <Separator />
            <Button
              type="submit"
              className="self-start"
              disabled={loading || !currentPassword || !newPassword || newPassword !== confirmPassword || newPassword.length < 8}
            >
              {loading ? "Updating..." : "Update Password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

type PlatformSettings = { studentApprovalRequired: boolean; subscriptionUrl: string | null }

/** One switch: do students who sign up on their own wait for approval? */
function SignupApprovalCard() {
  const { data, loading, mutate } = useFetch<PlatformSettings>("/api/admin/platform-settings", {
    errorMessage: "Could not load sign-up settings",
  })
  const { execute: save, loading: saving } = usePutCallback<PlatformSettings, Partial<PlatformSettings>>(
    "/api/admin/platform-settings",
    {
      successMessage: (d) => (d.studentApprovalRequired ? "New students now need approval" : "New students get in straight away"),
      errorMessage: "Could not save",
      onSuccess: (d) => mutate(d),
    },
  )
  const required = data?.studentApprovalRequired ?? true

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <UserCheck className="size-4 text-primary" /> New Student Sign-ups
        </CardTitle>
        <CardDescription>
          Keep strangers out: you get a notification for each new student and approve them before they can use the platform.
          Students a tutor invites always get in straight away.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-3">
          <Checkbox
            id="student-approval"
            checked={required}
            disabled={loading || saving || !data}
            onCheckedChange={(v) => save({ studentApprovalRequired: v === true })}
            className="mt-0.5"
          />
          <Label htmlFor="student-approval" className="font-normal leading-snug cursor-pointer">
            New students need my approval before they can use the platform
          </Label>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Where students go once their course has finished and closed: the school's
 * subscription options. They see a "Your course has finished" page with a
 * button to this address.
 */
function SubscriptionLinkCard() {
  const { data, mutate } = useFetch<PlatformSettings>("/api/admin/platform-settings")
  // Remounted with what was saved, so the box starts from it.
  return <SubscriptionLinkForm key={data?.subscriptionUrl ?? ""} data={data} onSaved={mutate} />
}

function SubscriptionLinkForm({ data, onSaved }: {
  data: PlatformSettings | null | undefined
  onSaved: (d: PlatformSettings) => void
}) {
  const loading = !data
  const [url, setUrl] = useState(data?.subscriptionUrl ?? "")
  const { execute: save, loading: saving } = usePutCallback<PlatformSettings, Partial<PlatformSettings>>(
    "/api/admin/platform-settings",
    {
      successMessage: (d) => (d.subscriptionUrl ? "Saved — finished students are sent there" : "Link removed"),
      onSuccess: (d) => onSaved(d),
    },
  )
  const changed = url.trim() !== (data?.subscriptionUrl ?? "")

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GraduationCap className="size-4 text-primary" /> When a Course Finishes
        </CardTitle>
        <CardDescription>
          When a course closes, its students can no longer use the student space. They see &ldquo;Your course has
          finished&rdquo; with a button to your subscription options, so they can carry on learning.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => { e.preventDefault(); void save({ subscriptionUrl: url.trim() || null }) }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="subscription-url">Subscription options page</Label>
            <Input
              id="subscription-url"
              type="text"
              inputMode="url"
              placeholder="e.g. www.yourschool.co.uk/subscriptions"
              value={url}
              disabled={loading || !data}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {data?.subscriptionUrl
                ? <>Students are sent to <a href={data.subscriptionUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline break-all">{data.subscriptionUrl}</a></>
                : "Leave empty and students are asked to get in touch with you instead."}
            </p>
          </div>
          <Button type="submit" className="self-start" disabled={!changed || saving || !data}>
            {saving && <Loader2 className="size-4 mr-1.5 animate-spin" />} Save
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
