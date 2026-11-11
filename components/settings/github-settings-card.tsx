"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  TriangleAlert,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fetchGitHubAuthStatus,
  useGitHubAuthStatus,
} from "@/hooks/use-github-auth-status";
import {
  SETTINGS_KEYS,
  useGitHubSettings,
  useSettingsMutation,
} from "@/hooks/use-settings";
import {
  GITHUB_AUTH_STATUS_QUERY_KEY,
  type GitHubAuthStatus,
} from "@/lib/github/github-auth-status";
import { cn } from "@/lib/utils";

// Fine-grained tokens can't read check runs, so the link prefills a classic
// token with the repo scope.
const CLASSIC_TOKEN_URL =
  "https://github.com/settings/tokens/new?scopes=repo&description=dev-hub";

type StatusTone = "ok" | "warning" | "error";

const STATUS_TONES: Record<
  StatusTone,
  { icon: LucideIcon; className: string }
> = {
  ok: { icon: CheckCircle2, className: "text-green-600" },
  warning: { icon: TriangleAlert, className: "text-amber-600" },
  error: { icon: XCircle, className: "text-destructive" },
};

function StatusLine({
  tone,
  children,
}: {
  tone: StatusTone;
  children: ReactNode;
}) {
  const { icon: Icon, className } = STATUS_TONES[tone];
  return (
    <p className={cn("flex items-start gap-1.5 text-sm", className)}>
      <Icon className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function GhLoginCommand() {
  return (
    <code className="bg-muted rounded px-1 font-mono text-xs">
      gh auth login
    </code>
  );
}

function ActiveLoginStatus({ status }: { status: GitHubAuthStatus }) {
  switch (status.activeSource) {
    case "gh":
      return status.ghLogin ? (
        <StatusLine tone="ok">
          Signed in with the GitHub CLI as {status.ghLogin}
        </StatusLine>
      ) : (
        <StatusLine tone="error">
          GitHub rejected the GitHub CLI login. Run <GhLoginCommand /> again on
          the machine running dev-hub.
        </StatusLine>
      );
    case "settings":
      return status.savedTokenLogin ? (
        <StatusLine tone="ok">
          Using the saved token for {status.savedTokenLogin}
        </StatusLine>
      ) : (
        <StatusLine tone="error">GitHub rejected the saved token.</StatusLine>
      );
    case null:
      return (
        <StatusLine tone="warning">
          Not connected. Run <GhLoginCommand /> on the machine running dev-hub,
          or save a token below.
        </StatusLine>
      );
    default: {
      const unhandledSource: never = status.activeSource;
      throw new Error(`Unhandled GitHub login source: ${unhandledSource}`);
    }
  }
}

function FallbackTokenNote({ status }: { status: GitHubAuthStatus }) {
  if (status.activeSource !== "gh" || !status.hasSavedToken) return null;
  return status.savedTokenLogin ? (
    <p className="text-muted-foreground text-xs">
      The saved token ({status.savedTokenLogin}) is the fallback.
    </p>
  ) : (
    <p className="text-destructive text-xs">
      GitHub rejects the saved fallback token.
    </p>
  );
}

export function GitHubSettingsCard() {
  const { apiToken, isLoading: isLoadingSettings } = useGitHubSettings();
  const authStatus = useGitHubAuthStatus();
  const mutation = useSettingsMutation();
  const queryClient = useQueryClient();

  const [localToken, setLocalToken] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoadingSettings) {
      setLocalToken(apiToken ?? "");
    }
  }, [apiToken, isLoadingSettings]);

  async function handleSave() {
    const trimmedToken = localToken.trim();
    if (!trimmedToken) {
      setTokenError("Enter a personal access token");
      return;
    }
    setIsSaving(true);
    setTokenError(null);
    try {
      // useSettingsMutation shows a failed save itself.
      const isSaved = await mutation
        .mutateAsync({
          key: SETTINGS_KEYS.GITHUB_API_TOKEN,
          value: trimmedToken,
        })
        .then(
          () => true,
          () => false,
        );
      if (!isSaved) return;
      // Check the saved token itself: the GitHub CLI login may be the one
      // dev-hub is using.
      const status = await queryClient.fetchQuery({
        queryKey: GITHUB_AUTH_STATUS_QUERY_KEY,
        queryFn: fetchGitHubAuthStatus,
        staleTime: 0,
      });
      if (status.savedTokenLogin) {
        toast.success(`Token saved for ${status.savedTokenLogin}`);
      } else {
        setTokenError("GitHub rejected this token");
      }
    } catch (error) {
      setTokenError(
        error instanceof Error ? error.message : "Couldn't check the token",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function handleRemove() {
    mutation.mutate(
      { key: SETTINGS_KEYS.GITHUB_API_TOKEN, value: "" },
      {
        onSuccess: () => {
          setLocalToken("");
          setTokenError(null);
          void queryClient.invalidateQueries({
            queryKey: GITHUB_AUTH_STATUS_QUERY_KEY,
          });
          toast.success("Saved token removed");
        },
      },
    );
  }

  if (isLoadingSettings) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  const status = authStatus.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitHub</CardTitle>
        <CardDescription>
          dev-hub signs in to GitHub with the GitHub CLI on the machine it runs
          on: run <GhLoginCommand /> there once. A token saved below is used
          only when there is no GitHub CLI login.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {status ? (
          <ActiveLoginStatus status={status} />
        ) : authStatus.isError ? (
          <StatusLine tone="error">
            Couldn&apos;t check the GitHub login: {authStatus.error.message}
          </StatusLine>
        ) : (
          <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
            <Loader2 className="size-4 animate-spin" />
            Checking the GitHub login…
          </p>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="github-token">Fallback personal access token</Label>
          <div className="flex gap-2">
            <Input
              id="github-token"
              type="password"
              value={localToken}
              onChange={(event) => {
                setLocalToken(event.target.value);
                setTokenError(null);
              }}
              placeholder="ghp_••••••••"
              className="font-mono text-sm"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSave}
              disabled={isSaving || !localToken.trim()}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
            {apiToken && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={handleRemove}
                disabled={mutation.isPending}
              >
                Remove
              </Button>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            <a
              href={CLASSIC_TOKEN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary inline-flex items-center gap-1 hover:underline"
            >
              Create a classic token
              <ExternalLink className="size-3" />
            </a>{" "}
            with the repo scope. Fine-grained tokens can&apos;t read check runs.
          </p>
          {status && !tokenError && <FallbackTokenNote status={status} />}
          {tokenError && (
            <p className="text-destructive flex items-center gap-1.5 text-xs">
              <XCircle className="size-3" />
              {tokenError}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
