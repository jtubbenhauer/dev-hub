import {
  useCallback,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import type {
  DockviewPanelApi,
  IDockviewPanelProps,
  IWatermarkPanelProps,
} from "dockview-react";
import {
  FileCode2,
  MessageSquare,
  TerminalSquare,
  type LucideIcon,
} from "lucide-react";
import { useFilePicker } from "@/components/file-picker/file-picker";
import { Button } from "@/components/ui/button";
import { useWorkbenchPanelFocusTarget } from "@/components/workbench/workbench-panel-focus";
import { WorkbenchPanelFrame } from "@/components/workbench/workbench-panel-frame";
import type { WorkbenchTabParams } from "@/lib/workbench/tab-descriptors";
import { getWorkbenchController } from "@/lib/workbench/workbench-controller-registry";

type LauncherActionId = "terminal" | "chat" | "file";

interface LauncherAction {
  readonly id: LauncherActionId;
  readonly label: string;
  readonly shortcutKey: string;
  readonly icon: LucideIcon;
}

const LAUNCHER_ACTIONS: readonly LauncherAction[] = [
  {
    id: "terminal",
    label: "New terminal",
    shortcutKey: "t",
    icon: TerminalSquare,
  },
  { id: "chat", label: "New chat", shortcutKey: "c", icon: MessageSquare },
  { id: "file", label: "Open file…", shortcutKey: "f", icon: FileCode2 },
];

function assertNever(value: never): never {
  throw new Error(`Unhandled launcher action: ${String(value)}`);
}

function hasModifier(event: KeyboardEvent<HTMLElement>): boolean {
  return event.altKey || event.ctrlKey || event.metaKey;
}

interface WorkbenchLauncherProps {
  // The group new tabs open in; null means the active group (or a new one).
  readonly groupId: string | null;
}

export function WorkbenchLauncher({ groupId }: WorkbenchLauncherProps) {
  const { open: openFilePicker } = useFilePicker();
  const launcherRef = useRef<HTMLDivElement>(null);
  // Its keys only work while it holds the focus, e.g. right after a split.
  const focusLauncher = useCallback(
    () => launcherRef.current?.focus({ preventScroll: true }),
    [],
  );
  useWorkbenchPanelFocusTarget(focusLauncher);

  const runAction = (actionId: LauncherActionId) => {
    switch (actionId) {
      case "terminal":
        getWorkbenchController()?.openNewTerminal({ groupId });
        return;
      case "chat":
        getWorkbenchController()?.openNewChat({ groupId });
        return;
      case "file":
        openFilePicker();
        return;
      default:
        assertNever(actionId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (hasModifier(event) || event.repeat || event.nativeEvent.isComposing) {
      return;
    }
    const action = LAUNCHER_ACTIONS.find(
      (candidate) => candidate.shortcutKey === event.key,
    );
    if (!action) return;
    event.preventDefault();
    runAction(action.id);
  };

  return (
    <div
      ref={launcherRef}
      role="group"
      aria-label="New tab"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="focus-visible:ring-ring/50 flex h-full flex-col items-center justify-center gap-3 rounded-md p-6 outline-none focus-visible:ring-[3px]"
    >
      <p className="text-muted-foreground text-xs">Start a new tab</p>
      <div className="flex w-full max-w-60 flex-col gap-1">
        {LAUNCHER_ACTIONS.map((action) => (
          <Button
            key={action.id}
            type="button"
            variant="ghost"
            size="sm"
            className="justify-start"
            aria-keyshortcuts={action.shortcutKey}
            onClick={() => runAction(action.id)}
          >
            <action.icon className="text-muted-foreground" />
            <span>{action.label}</span>
            <kbd
              aria-hidden
              className="bg-muted text-muted-foreground ml-auto rounded px-1.5 font-mono text-[11px]"
            >
              {action.shortcutKey}
            </kbd>
          </Button>
        ))}
      </div>
    </div>
  );
}

// A panel can be dragged into another group, so its group id is read live.
function usePanelGroupId(api: DockviewPanelApi): string {
  const subscribeToGroupChange = useCallback(
    (onChange: () => void) => {
      const subscription = api.onDidGroupChange(onChange);
      return () => subscription.dispose();
    },
    [api],
  );
  return useSyncExternalStore(subscribeToGroupChange, () => api.group.id);
}

export function LauncherPanel({
  api,
}: IDockviewPanelProps<WorkbenchTabParams>) {
  const groupId = usePanelGroupId(api);
  return (
    <WorkbenchPanelFrame api={api}>
      <WorkbenchLauncher groupId={groupId} />
    </WorkbenchPanelFrame>
  );
}

// dockview shows the watermark in every empty group and when there are no groups.
export function LauncherWatermark({ group }: IWatermarkPanelProps) {
  return <WorkbenchLauncher groupId={group?.id ?? null} />;
}
