"use client";

import dynamic from "next/dynamic";
import { useEditorTypeSetting } from "@/hooks/use-settings";
import { CodeEditor } from "@/components/editor/code-editor";

const MonacoEditor = dynamic(
  () => import("@/components/editor/monaco-editor").then((m) => m.MonacoEditor),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
  },
);

const NeovimEditor = dynamic(
  () => import("@/components/editor/neovim-editor").then((m) => m.NeovimEditor),
  {
    ssr: false,
    loading: () => <div className="h-full w-full animate-pulse bg-muted" />,
  },
);

interface EditorSwitcherProps {
  content: string;
  language: string;
  onChange: (content: string) => void;
  onSave?: () => void;
  workspaceId?: string;
  filePath?: string;
  autoFocus?: boolean;
}

export function EditorSwitcher(props: EditorSwitcherProps) {
  const { editorType } = useEditorTypeSetting();

  if (editorType === "neovim") {
    return <NeovimEditor {...props} />;
  }

  if (editorType === "monaco") {
    return <MonacoEditor {...props} />;
  }

  return <CodeEditor {...props} />;
}
