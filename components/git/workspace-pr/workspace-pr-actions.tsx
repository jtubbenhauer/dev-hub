"use client";

import { useState, type ReactNode } from "react";
import { GitMerge, Loader2, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePullRequestAction } from "@/hooks/use-branch-pull-request";
import {
  getMergeReadiness,
  MERGE_METHOD_LABELS,
  type BranchPullRequest,
  type PullRequestMergeMethod,
  type RepositoryMergeSettings,
} from "@/lib/github/branch-pull-request";
import type { PullRequestActionType } from "@/lib/github/pull-request-actions";
import { cn } from "@/lib/utils";

export interface WorkspacePrActionsProps {
  owner: string;
  repo: string;
  branch: string;
  pullRequest: BranchPullRequest;
  repository: RepositoryMergeSettings;
}

type OpenConfirmation = "merge" | "enable-auto-merge" | "close" | null;

const SMALL_BUTTON_CLASS = "h-7 text-xs";

function ActionIcon({
  isPending,
  icon: Icon,
}: {
  isPending: boolean;
  icon?: LucideIcon;
}) {
  if (isPending) return <Loader2 className="size-3 animate-spin" />;
  if (!Icon) return null;
  return <Icon className="size-3" />;
}

function ConfirmationBox({ children }: { children: ReactNode }) {
  return (
    <div className="bg-muted/40 flex flex-col gap-2 rounded-md border p-2">
      {children}
    </div>
  );
}

function MergeMethodPicker({
  allowedMethods,
  selectedMethod,
  onSelect,
}: {
  allowedMethods: readonly PullRequestMergeMethod[];
  selectedMethod: PullRequestMergeMethod;
  onSelect: (method: PullRequestMergeMethod) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Merge method"
      className="bg-background flex flex-wrap gap-0.5 rounded-md border p-0.5"
    >
      {allowedMethods.map((method) => {
        const isSelected = method === selectedMethod;
        return (
          <button
            key={method}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(method)}
            className={cn(
              "flex-1 rounded-sm px-2 py-1 text-[11px] whitespace-nowrap transition-colors",
              isSelected
                ? "bg-accent text-accent-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {MERGE_METHOD_LABELS[method]}
          </button>
        );
      })}
    </div>
  );
}

export function WorkspacePrActions({
  owner,
  repo,
  branch,
  pullRequest,
  repository,
}: WorkspacePrActionsProps) {
  const mutation = usePullRequestAction({ owner, repo, branch, pullRequest });
  const [openConfirmation, setOpenConfirmation] =
    useState<OpenConfirmation>(null);
  const [mergeMethod, setMergeMethod] = useState<PullRequestMergeMethod>(
    repository.defaultMergeMethod,
  );

  const isPending = mutation.isPending;
  const pendingType: PullRequestActionType | null = isPending
    ? (mutation.variables?.type ?? null)
    : null;
  const closeConfirmation = () => setOpenConfirmation(null);
  const openMethodConfirmation = (kind: "merge" | "enable-auto-merge") => {
    setMergeMethod(repository.defaultMergeMethod);
    setOpenConfirmation(kind);
  };

  if (pullRequest.state === "MERGED") return null;

  if (pullRequest.state === "CLOSED") {
    if (!pullRequest.viewerCanReopen) return null;
    return (
      <Button
        size="sm"
        variant="outline"
        className={SMALL_BUTTON_CLASS}
        disabled={isPending}
        onClick={() => mutation.mutate({ type: "reopen" })}
      >
        <ActionIcon isPending={pendingType === "reopen"} />
        Reopen
      </Button>
    );
  }

  const readiness = getMergeReadiness(pullRequest, repository.viewerPermission);
  const canMerge =
    readiness.canMerge && repository.allowedMergeMethods.length > 0;
  const canDisableAutoMerge =
    pullRequest.autoMerge !== null && pullRequest.viewerCanDisableAutoMerge;
  const canEnableAutoMerge =
    !canDisableAutoMerge && pullRequest.viewerCanEnableAutoMerge;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            className={cn(
              SMALL_BUTTON_CLASS,
              "bg-green-600 text-white hover:bg-green-700",
            )}
            disabled={!canMerge || isPending}
            aria-expanded={openConfirmation === "merge"}
            onClick={() => openMethodConfirmation("merge")}
          >
            <ActionIcon isPending={pendingType === "merge"} icon={GitMerge} />
            Merge
          </Button>
          {canDisableAutoMerge && (
            <Button
              size="sm"
              variant="outline"
              className={SMALL_BUTTON_CLASS}
              disabled={isPending}
              onClick={() => mutation.mutate({ type: "disable-auto-merge" })}
            >
              <ActionIcon isPending={pendingType === "disable-auto-merge"} />
              Disable auto-merge
            </Button>
          )}
          {canEnableAutoMerge && (
            <Button
              size="sm"
              variant="outline"
              className={SMALL_BUTTON_CLASS}
              disabled={isPending}
              aria-expanded={openConfirmation === "enable-auto-merge"}
              onClick={() => openMethodConfirmation("enable-auto-merge")}
            >
              <ActionIcon isPending={pendingType === "enable-auto-merge"} />
              Enable auto-merge
            </Button>
          )}
        </div>
        <p className="text-muted-foreground text-[11px]">{readiness.message}</p>
      </div>

      {(openConfirmation === "merge" ||
        openConfirmation === "enable-auto-merge") && (
        <ConfirmationBox>
          <MergeMethodPicker
            allowedMethods={repository.allowedMergeMethods}
            selectedMethod={mergeMethod}
            onSelect={setMergeMethod}
          />
          {openConfirmation === "enable-auto-merge" && (
            <p className="text-muted-foreground text-[11px]">
              GitHub merges it automatically once all requirements are met.
            </p>
          )}
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className={SMALL_BUTTON_CLASS}
              onClick={closeConfirmation}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className={cn(
                SMALL_BUTTON_CLASS,
                "bg-green-600 text-white hover:bg-green-700",
              )}
              disabled={isPending}
              onClick={() =>
                mutation.mutate(
                  { type: openConfirmation, mergeMethod },
                  { onSuccess: closeConfirmation },
                )
              }
            >
              <ActionIcon isPending={pendingType === openConfirmation} />
              {openConfirmation === "merge"
                ? "Confirm merge"
                : "Confirm auto-merge"}
            </Button>
          </div>
        </ConfirmationBox>
      )}

      <div className="flex flex-wrap gap-1.5">
        {pullRequest.viewerCanUpdate && (
          <Button
            size="sm"
            variant="outline"
            className={SMALL_BUTTON_CLASS}
            disabled={isPending}
            onClick={() =>
              mutation.mutate({
                type: pullRequest.isDraft
                  ? "mark-ready-for-review"
                  : "convert-to-draft",
              })
            }
          >
            <ActionIcon
              isPending={
                pendingType === "mark-ready-for-review" ||
                pendingType === "convert-to-draft"
              }
            />
            {pullRequest.isDraft ? "Ready for review" : "Convert to draft"}
          </Button>
        )}
        {pullRequest.viewerCanUpdateBranch && (
          <Button
            size="sm"
            variant="outline"
            className={SMALL_BUTTON_CLASS}
            disabled={isPending}
            title="Merge the latest base branch into this branch"
            onClick={() => mutation.mutate({ type: "update-branch" })}
          >
            <ActionIcon isPending={pendingType === "update-branch"} />
            Update branch
          </Button>
        )}
        {pullRequest.viewerCanClose && (
          <Button
            size="sm"
            variant="outline"
            className={SMALL_BUTTON_CLASS}
            disabled={isPending}
            aria-expanded={openConfirmation === "close"}
            onClick={() => setOpenConfirmation("close")}
          >
            <ActionIcon isPending={pendingType === "close"} />
            Close
          </Button>
        )}
      </div>

      {openConfirmation === "close" && (
        <ConfirmationBox>
          <p className="text-xs">
            Close pull request #{pullRequest.number} without merging?
          </p>
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className={SMALL_BUTTON_CLASS}
              onClick={closeConfirmation}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className={SMALL_BUTTON_CLASS}
              disabled={isPending}
              onClick={() =>
                mutation.mutate(
                  { type: "close" },
                  { onSuccess: closeConfirmation },
                )
              }
            >
              <ActionIcon isPending={pendingType === "close"} />
              Close pull request
            </Button>
          </div>
        </ConfirmationBox>
      )}
    </div>
  );
}
