"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { VscodeIcon } from "@/components/ui/vscode-icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useExternalEditorSetting } from "@/hooks/use-settings";
import {
  EDITOR_FLAVOR_LABELS,
  isValidSshTarget,
  resolveVscodeTarget,
} from "@/lib/vscode";
import type { Workspace } from "@/types";

export function VscodeTargetEditor({ workspace }: { workspace: Workspace }) {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [sshTarget, setSshTarget] = useState(workspace.sshTarget ?? "");
  const [sshPath, setSshPath] = useState(workspace.sshPath ?? "");
  const { externalEditor } = useExternalEditorSetting();

  const editorLabel = EDITOR_FLAVOR_LABELS[externalEditor];
  const trimmedTarget = sshTarget.trim();
  const hasInvalidTarget =
    trimmedTarget.length > 0 && !isValidSshTarget(trimmedTarget);

  const preview = resolveVscodeTarget(
    {
      path: workspace.path,
      backend: workspace.backend,
      sshTarget: trimmedTarget || null,
      sshPath: sshPath.trim() || null,
    },
    externalEditor,
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/workspaces/${workspace.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sshTarget: trimmedTarget,
          sshPath: sshPath.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to save");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["workspaces"] });
      toast.success(`${editorLabel} target saved`);
      setIsOpen(false);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        if (open) {
          setSshTarget(workspace.sshTarget ?? "");
          setSshPath(workspace.sshPath ?? "");
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          title={`${editorLabel} target`}
          onClick={(event) => event.stopPropagation()}
        >
          <VscodeIcon className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-96"
        align="end"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-medium">Open in {editorLabel}</p>
            <p className="text-muted-foreground text-xs">
              Derived from your SSH config. Override only if it resolved
              incorrectly.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`ssh-target-${workspace.id}`} className="text-xs">
              SSH target
            </Label>
            <Input
              id={`ssh-target-${workspace.id}`}
              value={sshTarget}
              onChange={(e) => setSshTarget(e.target.value)}
              placeholder="my-ssh-config-alias"
              className="font-mono text-xs"
            />
            {hasInvalidTarget && (
              <p className="text-destructive text-xs">
                Not a valid SSH host or alias
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`ssh-path-${workspace.id}`} className="text-xs">
              Remote path (optional)
            </Label>
            <Input
              id={`ssh-path-${workspace.id}`}
              value={sshPath}
              onChange={(e) => setSshPath(e.target.value)}
              placeholder={workspace.path}
              className="font-mono text-xs"
            />
          </div>

          <div className="bg-muted/30 rounded-md border px-2 py-1.5">
            <p className="text-muted-foreground mb-0.5 text-xs">Opens</p>
            <p className="font-mono text-xs break-all">
              {preview.kind === "unconfigured" ? preview.reason : preview.uri}
            </p>
          </div>

          <Button
            size="sm"
            className="w-full"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending || hasInvalidTarget}
          >
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
