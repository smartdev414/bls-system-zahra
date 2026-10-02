"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useEditor, EditorContent } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Underline from "@tiptap/extension-underline"
import TextAlign from "@tiptap/extension-text-align"
import Placeholder from "@tiptap/extension-placeholder"
import Link from "@tiptap/extension-link"
import {
  Bold, Italic, UnderlineIcon, Strikethrough,
  List, ListOrdered, AlignLeft, AlignCenter, AlignRight,
  Heading2, Heading3, Link2, Minus, Sparkles, Loader2, ChevronDown,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DescriptionMode } from "@/lib/description-grammar"

type Props = {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  disabled?: boolean
}

// What the AI menu offers. "fix" only corrects; the others reword.
const AI_MODES: { mode: DescriptionMode; label: string; hint: string; done: string }[] = [
  { mode: "fix", label: "Fix English", hint: "Spelling and grammar only", done: "English corrected" },
  { mode: "natural", label: "Make it natural", hint: "Smooth, fluent wording", done: "Rewritten to sound natural" },
  { mode: "friendly", label: "Make it friendly", hint: "Warm and encouraging", done: "Rewritten in a friendly tone" },
  { mode: "professional", label: "Make it professional", hint: "Polished and courteous", done: "Rewritten in a professional tone" },
]

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      className={cn(
        "size-7 flex items-center justify-center rounded text-sm transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
        disabled && "opacity-40 cursor-not-allowed"
      )}
    >
      {children}
    </button>
  )
}

export function RichTextEditor({ value, onChange, placeholder, disabled }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder: placeholder ?? "Write something…" }),
      Link.configure({ openOnClick: false }),
    ],
    immediatelyRender: false,
    content: value || "",
    editable: !disabled,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML()
      onChange(html === "<p></p>" ? "" : html)
    },
  })

  // The AI menu: the whole description goes to the grammar model and comes
  // back corrected, or reworded in the tone picked, with its formatting kept.
  // It is asked for, never automatic, and the toast offers the way back.
  const [fixing, setFixing] = useState(false)

  async function improve({ mode, done }: (typeof AI_MODES)[number]) {
    if (!editor || fixing || editor.isEmpty) return
    const before = editor.getHTML()
    setFixing(true)
    // Anything typed while the model is reading would be overwritten by its answer.
    editor.setEditable(false)
    try {
      const res = await fetch("/api/tutor/descriptions/correct", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ html: before, mode }),
      })
      const body = await res.json().catch(() => null) as
        { message?: string; available?: boolean; corrected?: string | null; failed?: boolean } | null
      if (editor.isDestroyed) return
      if (!res.ok) {
        toast.error(body?.message ?? "Could not improve the English")
      } else if (body?.available === false) {
        toast.error("The AI writing help is not set up on this server")
      } else if (body?.failed) {
        toast.error("Could not improve the English just now — please try again")
      } else if (!body?.corrected) {
        toast.success(mode === "fix" ? "The English looks good — nothing to correct" : "Nothing to change")
      } else {
        editor.commands.setContent(body.corrected)
        toast.success(done, {
          action: {
            label: "Undo",
            onClick: () => { if (!editor.isDestroyed) editor.commands.setContent(before) },
          },
        })
      }
    } catch {
      toast.error("Could not improve the English just now — please try again")
    } finally {
      if (!editor.isDestroyed) editor.setEditable(!disabled)
      setFixing(false)
    }
  }

  if (!editor) return null

  return (
    <div className={cn("rounded-xl border bg-background overflow-hidden", disabled && "opacity-60 pointer-events-none")}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5 bg-muted/30">
        <ToolbarButton title="Bold" onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")}>
          <Bold className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")}>
          <Italic className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive("underline")}>
          <UnderlineIcon className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive("strike")}>
          <Strikethrough className="size-3.5" />
        </ToolbarButton>

        <div className="w-px h-4 bg-border mx-1" />

        <ToolbarButton title="Heading 2" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive("heading", { level: 2 })}>
          <Heading2 className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Heading 3" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive("heading", { level: 3 })}>
          <Heading3 className="size-3.5" />
        </ToolbarButton>

        <div className="w-px h-4 bg-border mx-1" />

        <ToolbarButton title="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")}>
          <List className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Ordered list" onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")}>
          <ListOrdered className="size-3.5" />
        </ToolbarButton>

        <div className="w-px h-4 bg-border mx-1" />

        <ToolbarButton title="Align left" onClick={() => editor.chain().focus().setTextAlign("left").run()} active={editor.isActive({ textAlign: "left" })}>
          <AlignLeft className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Align center" onClick={() => editor.chain().focus().setTextAlign("center").run()} active={editor.isActive({ textAlign: "center" })}>
          <AlignCenter className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton title="Align right" onClick={() => editor.chain().focus().setTextAlign("right").run()} active={editor.isActive({ textAlign: "right" })}>
          <AlignRight className="size-3.5" />
        </ToolbarButton>

        <div className="w-px h-4 bg-border mx-1" />

        <ToolbarButton title="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <Minus className="size-3.5" />
        </ToolbarButton>
        <ToolbarButton
          title="Add link"
          active={editor.isActive("link")}
          onClick={() => {
            const url = window.prompt("Enter URL", editor.getAttributes("link").href ?? "")
            if (url === null) return
            if (url === "") { editor.chain().focus().unsetLink().run(); return }
            editor.chain().focus().setLink({ href: url }).run()
          }}
        >
          <Link2 className="size-3.5" />
        </ToolbarButton>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Correct or reword the description with AI"
              disabled={fixing}
              className={cn(
                "ml-auto flex items-center gap-1.5 h-7 px-2 rounded text-xs font-medium transition-colors",
                "text-primary hover:bg-primary/10 data-[state=open]:bg-primary/10",
                fixing && "opacity-60 cursor-wait"
              )}
            >
              {fixing ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {fixing ? "Working…" : "Improve English"}
              {!fixing && <ChevronDown className="size-3" />}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {AI_MODES.map((m, i) => (
              <div key={m.mode}>
                {/* The first only corrects; everything below it rewords. */}
                {i === 1 && <DropdownMenuSeparator />}
                <DropdownMenuItem onSelect={() => improve(m)} className="flex-col items-start gap-0">
                  <span className="font-medium">{m.label}</span>
                  <span className="text-xs text-muted-foreground">{m.hint}</span>
                </DropdownMenuItem>
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Editor area */}
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none px-3 py-2.5 h-65 overflow-y-auto focus-within:outline-none [&_.tiptap]:outline-none [&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.tiptap_p.is-editor-empty:first-child::before]:text-muted-foreground [&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none [&_.tiptap_p.is-editor-empty:first-child::before]:float-left [&_.tiptap_p.is-editor-empty:first-child::before]:h-0"
      />
    </div>
  )
}
