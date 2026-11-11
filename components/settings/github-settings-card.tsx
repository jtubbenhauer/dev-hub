"use client";

import { useState, useEffect, useCallback } from "react";
import { Loader2, ExternalLink, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  useGitHubSettings,
  useSettingsMutation,
  SETTINGS_KEYS,
} from "@/hooks/use-settings";

export function GitHubSettingsCard() {
  const { apiToken, isLoading: isLoadingSettings } = useGitHubSettings();
  const mutation = useSettingsMutation();

  const [localToken, setLocalToken] = useState("");
  const [connectedLogin, setConnectedLogin] = useState<string | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoadingSettings) {
      setLocalToken(apiToken ?? "");
    }
  }, [apiToken, isLoadingSettings]);

  const handleConnect = useCallback(async () => {
    const trimmedToken = localToken.trim();
    if (!trimmedToken) {
      setConnectionError("Please enter a personal access token");
      return;
    }

    setIsConnecting(true);
    setConnectionError(null);
    setConnectedLogin(null);

    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: SETTINGS_KEYS.GITHUB_API_TOKEN,
          value: trimmedToken,
        }),
      });

      const res = await fetch("/api/github/user");
      if (!res.ok) {
        setConnectionError("Invalid token or connection failed");
        return;
      }

      const userData = (await res.json()) as {
        login: string;
        name: string | null;
      };
      setConnectedLogin(userData.name ?? userData.login);
      toast.success(`Connected as ${userData.name ?? userData.login}`);
    } catch {
      setConnectionError("Failed to connect to GitHub");
    } finally {
      setIsConnecting(false);
    }
  }, [localToken]);

  const handleDisconnect = useCallback(() => {
    mutation.mutate(
      { key: SETTINGS_KEYS.GITHUB_API_TOKEN, value: "" },
      {
        onSuccess: () => {
          setLocalToken("");
          setConnectedLogin(null);
          toast.success("GitHub disconnected");
        },
      },
    );
  }, [mutation]);

  if (isLoadingSettings) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  const isAlreadyConfigured = !!apiToken;

  return (
    <Card>
      <CardHeader>
        <CardTitle>GitHub</CardTitle>
        <CardDescription>
          Connect your GitHub account to review pull requests from the Git page.{" "}
          <a
            href="https://github.com/settings/tokens?type=beta"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary inline-flex items-center gap-1 hover:underline"
          >
            Create a fine-grained token
            <ExternalLink className="size-3" />
          </a>{" "}
          with read access to pull requests and contents.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAlreadyConfigured && !connectedLogin && (
          <div className="flex items-center gap-2 text-sm text-green-600">
            <CheckCircle2 className="size-4" />
            GitHub is connected
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="github-token">Personal access token</Label>
          <div className="flex gap-2">
            <Input
              id="github-token"
              type="password"
              value={localToken}
              onChange={(e) => {
                setLocalToken(e.target.value);
                setConnectionError(null);
              }}
              placeholder="github_pat_••••••••"
              className="font-mono text-sm"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleConnect}
              disabled={isConnecting || !localToken.trim()}
            >
              {isConnecting ? (
                <>
                  <Loader2 className="size-3 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect"
              )}
            </Button>
            {isAlreadyConfigured && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={handleDisconnect}
                disabled={mutation.isPending}
              >
                Disconnect
              </Button>
            )}
          </div>
          {connectionError && (
            <p className="text-destructive flex items-center gap-1.5 text-xs">
              <XCircle className="size-3" />
              {connectionError}
            </p>
          )}
          {connectedLogin && (
            <p className="flex items-center gap-1.5 text-xs text-green-600">
              <CheckCircle2 className="size-3" />
              Connected as {connectedLogin}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
