import { memo, type ComponentProps } from "react";
import { EditorSwitcher } from "@/components/editor/editor-switcher";
import { useEditorStore } from "@/stores/editor-store";

// Several editors can be mounted at once (workbench file tabs), so a reveal
// stays pending until the editor showing its file and workspace handles it.
export const FilesActiveEditor = memo(function FilesActiveEditor(
  props: Omit<ComponentProps<typeof EditorSwitcher>, "content">,
) {
  const { filePath, workspaceId } = props;
  const content = useEditorStore(
    (state) =>
      state.openFiles.find((file) => file.path === filePath)?.content ?? "",
  );
  const revealRequest = useEditorStore((state) => {
    const reveal = state.pendingReveal;
    return reveal !== null &&
      reveal.path === filePath &&
      reveal.workspaceId === workspaceId
      ? reveal
      : null;
  });
  const clearReveal = useEditorStore((state) => state.clearReveal);
  return (
    <EditorSwitcher
      {...props}
      content={content}
      revealRequest={revealRequest}
      onRevealHandled={clearReveal}
    />
  );
});
