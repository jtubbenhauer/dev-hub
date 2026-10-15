import { memo, useEffect, type ComponentProps } from "react";
import { EditorSwitcher } from "@/components/editor/editor-switcher";
import { useEditorStore } from "@/stores/editor-store";

export const FilesActiveEditor = memo(function FilesActiveEditor(
  props: Omit<ComponentProps<typeof EditorSwitcher>, "content">,
) {
  const content = useEditorStore(
    (state) =>
      state.openFiles.find((file) => file.path === props.filePath)?.content ??
      "",
  );
  const pendingReveal = useEditorStore((state) => state.pendingReveal);
  const clearReveal = useEditorStore((state) => state.clearReveal);
  useEffect(() => {
    if (
      pendingReveal &&
      (pendingReveal.path !== props.filePath ||
        pendingReveal.workspaceId !== props.workspaceId)
    ) {
      useEditorStore.getState().clearReveal(pendingReveal.id);
    }
  }, [props.filePath, props.workspaceId, pendingReveal]);
  return (
    <EditorSwitcher
      {...props}
      content={content}
      revealRequest={
        pendingReveal &&
        pendingReveal.path === props.filePath &&
        pendingReveal.workspaceId === props.workspaceId
          ? pendingReveal
          : null
      }
      onRevealHandled={clearReveal}
    />
  );
});
