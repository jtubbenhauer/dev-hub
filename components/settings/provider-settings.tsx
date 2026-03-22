"use client";

import { useState, useCallback } from "react";
import {
  Loader2,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Terminal,
  Pencil,
} from "lucide-react";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  useWorkspaceProviders,
  useSettingsMutation,
  SETTINGS_KEYS,
} from "@/hooks/use-settings";
import type { WorkspaceProvider, ProviderBehaviour } from "@/types";
import { DEFAULT_PROVIDER_BEHAVIOUR } from "@/types";

type ProviderTypePreset = "always-on" | "auto-suspend" | "custom";

const AUTO_SUSPEND_BEHAVIOUR: ProviderBehaviour = {
  inactiveHealthIntervalMs: 0,
  activeHealthIntervalMs: 30_000,
  gitStatusIntervalMs: 10_000,
  sseWhenInactive: false,
  branchPollWhenInactive: false,
  supportsAutoSuspend: true,
  resumeTimeSeconds: 5,
};

function getProviderType(behaviour?: ProviderBehaviour): ProviderTypePreset {
  if (!behaviour) return "always-on";

  const isAlwaysOn =
    behaviour.inactiveHealthIntervalMs ===
      DEFAULT_PROVIDER_BEHAVIOUR.inactiveHealthIntervalMs &&
    behaviour.activeHealthIntervalMs ===
      DEFAULT_PROVIDER_BEHAVIOUR.activeHealthIntervalMs &&
    behaviour.gitStatusIntervalMs ===
      DEFAULT_PROVIDER_BEHAVIOUR.gitStatusIntervalMs &&
    behaviour.sseWhenInactive === DEFAULT_PROVIDER_BEHAVIOUR.sseWhenInactive &&
    behaviour.branchPollWhenInactive ===
      DEFAULT_PROVIDER_BEHAVIOUR.branchPollWhenInactive &&
    behaviour.supportsAutoSuspend ===
      DEFAULT_PROVIDER_BEHAVIOUR.supportsAutoSuspend &&
    behaviour.resumeTimeSeconds ===
      DEFAULT_PROVIDER_BEHAVIOUR.resumeTimeSeconds;

  if (isAlwaysOn) return "always-on";

  const isAutoSuspend =
    behaviour.inactiveHealthIntervalMs ===
      AUTO_SUSPEND_BEHAVIOUR.inactiveHealthIntervalMs &&
    behaviour.activeHealthIntervalMs ===
      AUTO_SUSPEND_BEHAVIOUR.activeHealthIntervalMs &&
    behaviour.gitStatusIntervalMs ===
      AUTO_SUSPEND_BEHAVIOUR.gitStatusIntervalMs &&
    behaviour.sseWhenInactive === AUTO_SUSPEND_BEHAVIOUR.sseWhenInactive &&
    behaviour.branchPollWhenInactive ===
      AUTO_SUSPEND_BEHAVIOUR.branchPollWhenInactive &&
    behaviour.supportsAutoSuspend ===
      AUTO_SUSPEND_BEHAVIOUR.supportsAutoSuspend &&
    behaviour.resumeTimeSeconds === AUTO_SUSPEND_BEHAVIOUR.resumeTimeSeconds;

  if (isAutoSuspend) return "auto-suspend";

  return "custom";
}

interface ProviderFormState {
  name: string;
  binaryPath: string;
  createCommand: string;
  destroyCommand: string;
  statusCommand: string;
  shellCommand: string;
  startCommand: string;
  providerType: ProviderTypePreset;
  behaviour: ProviderBehaviour;
}

const EMPTY_FORM: ProviderFormState = {
  name: "",
  binaryPath: "",
  createCommand: "{binary} create --repo {repo} --branch {branch}",
  destroyCommand: "{binary} destroy --id {id}",
  statusCommand: "{binary} status --id {id}",
  shellCommand: "",
  startCommand: "{binary} start {name} --provider fly --json",
  providerType: "always-on",
  behaviour: DEFAULT_PROVIDER_BEHAVIOUR,
};

export function ProviderSettings() {
  const { providers, isLoading } = useWorkspaceProviders();
  const mutation = useSettingsMutation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(
    null,
  );
  const [form, setForm] = useState<ProviderFormState>(EMPTY_FORM);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "found" | "not-found"
  >("idle");

  const openAddDialog = useCallback(() => {
    setEditingProviderId(null);
    setForm(EMPTY_FORM);
    setTestStatus("idle");
    setDialogOpen(true);
  }, []);

  const openEditDialog = useCallback((provider: WorkspaceProvider) => {
    setEditingProviderId(provider.id);
    const providerType = getProviderType(provider.behaviour);
    setForm({
      name: provider.name,
      binaryPath: provider.binaryPath,
      createCommand: provider.commands.create,
      destroyCommand: provider.commands.destroy,
      statusCommand: provider.commands.status,
      shellCommand: provider.commands.shell ?? "",
      startCommand: provider.commands.start ?? "",
      providerType,
      behaviour: provider.behaviour ?? DEFAULT_PROVIDER_BEHAVIOUR,
    });
    setTestStatus("idle");
    setDialogOpen(true);
  }, []);

  const handleTest = useCallback(async () => {
    if (!form.binaryPath.trim()) return;
    setTestStatus("testing");
    try {
      const res = await fetch("/api/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ binaryPath: form.binaryPath.trim() }),
      });
      const data = (await res.json()) as { ok?: boolean };
      setTestStatus(data.ok ? "found" : "not-found");
    } catch {
      setTestStatus("not-found");
    }
  }, [form.binaryPath]);

  const handleSave = useCallback(() => {
    const trimmedName = form.name.trim();
    const trimmedBinary = form.binaryPath.trim();
    if (!trimmedName || !trimmedBinary) {
      toast.error("Name and binary path are required");
      return;
    }

    const shellCmd = form.shellCommand.trim() || undefined;
    const newProvider: WorkspaceProvider = {
      id: editingProviderId ?? crypto.randomUUID(),
      name: trimmedName,
      binaryPath: trimmedBinary,
      commands: {
        create: form.createCommand.trim() || EMPTY_FORM.createCommand,
        destroy: form.destroyCommand.trim() || EMPTY_FORM.destroyCommand,
        status: form.statusCommand.trim() || EMPTY_FORM.statusCommand,
        ...(shellCmd ? { shell: shellCmd } : {}),
        ...(form.startCommand.trim()
          ? { start: form.startCommand.trim() }
          : {}),
      },
      behaviour:
        form.providerType === "always-on"
          ? DEFAULT_PROVIDER_BEHAVIOUR
          : form.providerType === "auto-suspend"
            ? AUTO_SUSPEND_BEHAVIOUR
            : form.behaviour,
    };

    const updatedProviders = editingProviderId
      ? providers.map((p) => (p.id === editingProviderId ? newProvider : p))
      : [...providers, newProvider];

    mutation.mutate(
      { key: SETTINGS_KEYS.WORKSPACE_PROVIDERS, value: updatedProviders },
      {
        onSuccess: () => {
          setDialogOpen(false);
          toast.success(
            editingProviderId
              ? `Updated provider "${trimmedName}"`
              : `Added provider "${trimmedName}"`,
          );
        },
      },
    );
  }, [form, editingProviderId, providers, mutation]);

  const handleDelete = useCallback(
    (providerId: string) => {
      const provider = providers.find((p) => p.id === providerId);
      const updatedProviders = providers.filter((p) => p.id !== providerId);
      mutation.mutate(
        { key: SETTINGS_KEYS.WORKSPACE_PROVIDERS, value: updatedProviders },
        {
          onSuccess: () => {
            toast.success(`Removed provider "${provider?.name}"`);
          },
        },
      );
    },
    [providers, mutation],
  );

  const updateField = useCallback(
    <K extends keyof ProviderFormState>(
      field: K,
      value: ProviderFormState[K],
    ) => {
      setForm((prev) => ({ ...prev, [field]: value }));
      if (field === "binaryPath") setTestStatus("idle");
    },
    [],
  );

  const updateProviderType = useCallback((type: ProviderTypePreset) => {
    setForm((prev) => {
      let newBehaviour = prev.behaviour;
      if (type === "always-on") newBehaviour = DEFAULT_PROVIDER_BEHAVIOUR;
      else if (type === "auto-suspend") newBehaviour = AUTO_SUSPEND_BEHAVIOUR;

      return {
        ...prev,
        providerType: type,
        behaviour: newBehaviour,
      };
    });
  }, []);

  const updateBehaviourField = useCallback(
    <K extends keyof ProviderBehaviour>(
      field: K,
      value: ProviderBehaviour[K],
    ) => {
      setForm((prev) => ({
        ...prev,
        behaviour: {
          ...prev.behaviour,
          [field]: value,
        },
      }));
    },
    [],
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="text-muted-foreground size-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Workspace Providers</CardTitle>
              <CardDescription>
                Register external CLI tools that can create and manage remote
                workspaces (e.g. rig-cli for container-based development).
              </CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={openAddDialog}>
              <Plus className="mr-1.5 size-4" />
              Add Provider
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {providers.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <Terminal className="text-muted-foreground size-10" />
              <p className="text-muted-foreground text-sm">
                No providers registered. Add a CLI provider to create remote
                workspaces automatically.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {providers.map((provider) => (
                <div
                  key={provider.id}
                  className="flex items-center justify-between rounded-md border px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Terminal className="text-muted-foreground size-4 shrink-0" />
                      <span className="text-sm font-medium">
                        {provider.name}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 truncate font-mono text-xs">
                      {provider.binaryPath}
                    </p>
                  </div>
                  <div className="ml-3 flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      onClick={() => openEditDialog(provider)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive hover:text-destructive size-8"
                      onClick={() => handleDelete(provider.id)}
                      disabled={mutation.isPending}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>
              {editingProviderId ? "Edit Provider" : "Add Provider"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="provider-name">Name</Label>
              <Input
                id="provider-name"
                value={form.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="rig-cli"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="provider-binary">Binary Path</Label>
              <div className="flex gap-2">
                <Input
                  id="provider-binary"
                  value={form.binaryPath}
                  onChange={(e) => updateField("binaryPath", e.target.value)}
                  placeholder="/usr/local/bin/rig"
                  className="font-mono text-sm"
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={handleTest}
                  disabled={!form.binaryPath.trim() || testStatus === "testing"}
                >
                  {testStatus === "testing" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Test"
                  )}
                </Button>
              </div>
              {testStatus === "found" && (
                <p className="flex items-center gap-1 text-xs text-green-500">
                  <CheckCircle2 className="size-3" />
                  Binary found and executable
                </p>
              )}
              {testStatus === "not-found" && (
                <p className="text-destructive flex items-center gap-1 text-xs">
                  <XCircle className="size-3" />
                  Binary not found or not executable
                </p>
              )}
            </div>

            <div className="bg-muted/30 space-y-3 rounded-md border p-3">
              <p className="text-muted-foreground text-xs font-medium">
                Command Templates
              </p>
              <p className="text-muted-foreground text-xs">
                Available placeholders:{" "}
                <code className="text-foreground">{"{binary}"}</code>,{" "}
                <code className="text-foreground">{"{repo}"}</code>,{" "}
                <code className="text-foreground">{"{branch}"}</code>,{" "}
                <code className="text-foreground">{"{name}"}</code>,{" "}
                <code className="text-foreground">{"{id}"}</code>,{" "}
                <code className="text-foreground">{"{context}"}</code>
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="cmd-create" className="text-xs">
                  Create
                </Label>
                <Input
                  id="cmd-create"
                  value={form.createCommand}
                  onChange={(e) => updateField("createCommand", e.target.value)}
                  placeholder="{binary} create --repo {repo} --branch {branch}"
                  className="h-8 font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cmd-destroy" className="text-xs">
                  Destroy
                </Label>
                <Input
                  id="cmd-destroy"
                  value={form.destroyCommand}
                  onChange={(e) =>
                    updateField("destroyCommand", e.target.value)
                  }
                  placeholder="{binary} destroy --id {id}"
                  className="h-8 font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cmd-status" className="text-xs">
                  Status
                </Label>
                <Input
                  id="cmd-status"
                  value={form.statusCommand}
                  onChange={(e) => updateField("statusCommand", e.target.value)}
                  placeholder="{binary} status --id {id}"
                  className="h-8 font-mono text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="cmd-shell" className="text-xs">
                  Shell (optional)
                </Label>
                <Input
                  id="cmd-shell"
                  value={form.shellCommand}
                  onChange={(e) => updateField("shellCommand", e.target.value)}
                  placeholder="{binary} exec --id {id} sh"
                  className="h-8 font-mono text-xs"
                />
                <p className="text-muted-foreground text-xs">
                  Command to open a terminal session. Leave blank to disable
                  terminal access.
                </p>
              </div>

              {form.providerType !== "always-on" && (
                <div className="space-y-1.5">
                  <Label htmlFor="cmd-start" className="text-xs">
                    Start (optional)
                  </Label>
                  <Input
                    id="cmd-start"
                    value={form.startCommand}
                    onChange={(e) =>
                      updateField("startCommand", e.target.value)
                    }
                    placeholder="{binary} start {name} --provider fly --json"
                    className="h-8 font-mono text-xs"
                  />
                  <p className="text-muted-foreground text-xs">
                    Command to resume a suspended workspace. Leave blank to
                    disable auto-resume.
                  </p>
                </div>
              )}
            </div>

            <div className="bg-muted/30 space-y-3 rounded-md border p-3">
              <p className="text-muted-foreground text-xs font-medium">
                Behaviour
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="provider-type" className="text-xs">
                  Provider Type
                </Label>
                <Select
                  value={form.providerType}
                  onValueChange={(val) =>
                    updateProviderType(val as ProviderTypePreset)
                  }
                >
                  <SelectTrigger id="provider-type" className="h-8 text-xs">
                    <SelectValue placeholder="Select provider type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="always-on" className="text-xs">
                      Always-on (Docker)
                    </SelectItem>
                    <SelectItem value="auto-suspend" className="text-xs">
                      Auto-suspend (Fly.io)
                    </SelectItem>
                    <SelectItem value="custom" className="text-xs">
                      Custom
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {form.providerType === "custom" && (
                <div className="mt-2 space-y-3 border-t pt-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="inactive-health" className="text-xs">
                        Inactive health check interval (s)
                      </Label>
                      <Input
                        id="inactive-health"
                        type="number"
                        min="0"
                        value={form.behaviour.inactiveHealthIntervalMs / 1000}
                        onChange={(e) =>
                          updateBehaviourField(
                            "inactiveHealthIntervalMs",
                            Number(e.target.value) * 1000,
                          )
                        }
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="active-health" className="text-xs">
                        Active health check interval (s)
                      </Label>
                      <Input
                        id="active-health"
                        type="number"
                        min="0"
                        value={form.behaviour.activeHealthIntervalMs / 1000}
                        onChange={(e) =>
                          updateBehaviourField(
                            "activeHealthIntervalMs",
                            Number(e.target.value) * 1000,
                          )
                        }
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="git-status" className="text-xs">
                        Git status interval (s)
                      </Label>
                      <Input
                        id="git-status"
                        type="number"
                        min="0"
                        value={form.behaviour.gitStatusIntervalMs / 1000}
                        onChange={(e) =>
                          updateBehaviourField(
                            "gitStatusIntervalMs",
                            Number(e.target.value) * 1000,
                          )
                        }
                        className="h-8 text-xs"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="resume-time" className="text-xs">
                        Resume time (s)
                      </Label>
                      <Input
                        id="resume-time"
                        type="number"
                        min="0"
                        value={form.behaviour.resumeTimeSeconds}
                        onChange={(e) =>
                          updateBehaviourField(
                            "resumeTimeSeconds",
                            Number(e.target.value),
                          )
                        }
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>

                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="sse-inactive"
                        className="cursor-pointer text-xs"
                      >
                        SSE when inactive
                      </Label>
                      <Switch
                        id="sse-inactive"
                        checked={form.behaviour.sseWhenInactive}
                        onCheckedChange={(checked) =>
                          updateBehaviourField("sseWhenInactive", checked)
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="branch-poll"
                        className="cursor-pointer text-xs"
                      >
                        Branch poll when inactive
                      </Label>
                      <Switch
                        id="branch-poll"
                        checked={form.behaviour.branchPollWhenInactive}
                        onCheckedChange={(checked) =>
                          updateBehaviourField(
                            "branchPollWhenInactive",
                            checked,
                          )
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label
                        htmlFor="auto-suspend"
                        className="cursor-pointer text-xs"
                      >
                        Supports auto-suspend
                      </Label>
                      <Switch
                        id="auto-suspend"
                        checked={form.behaviour.supportsAutoSuspend}
                        onCheckedChange={(checked) =>
                          updateBehaviourField("supportsAutoSuspend", checked)
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <Button
              onClick={handleSave}
              disabled={
                mutation.isPending ||
                !form.name.trim() ||
                !form.binaryPath.trim()
              }
              className="w-full"
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Saving...
                </>
              ) : editingProviderId ? (
                "Update Provider"
              ) : (
                "Add Provider"
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
