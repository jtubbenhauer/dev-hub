"use client"

import { useEditorTypeSetting } from "@/hooks/use-settings"
import { CodeEditor } from "@/components/editor/code-editor"
import { MonacoEditor } from "@/components/editor/monaco-editor"

interface EditorSwitcherProps {
  content: string
  language: string
  onChange: (content: string) => void
  onSave?: () => void
  workspaceId?: string
  filePath?: string
}

export function EditorSwitcher(props: EditorSwitcherProps) {
  const { editorType } = useEditorTypeSetting()

  if (editorType === "monaco") {
    return <MonacoEditor {...props} />
  }

  return <CodeEditor {...props} />
}
