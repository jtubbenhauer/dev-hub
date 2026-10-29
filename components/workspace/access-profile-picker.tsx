"use client";

import { Loader2, ShieldCheck, Clock } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { NO_ACCESS_PROFILE_ID } from "@/lib/workspaces/access-profiles";
import type { ProviderAccessOption } from "@/types";

interface AccessProfilePickerProps {
  options: ProviderAccessOption[];
  isLoading: boolean;
  loadError?: string;
  selectedProfileId: string;
  onProfileChange: (profileId: string) => void;
  reason: string;
  onReasonChange: (reason: string) => void;
}

export function AccessProfilePicker({
  options,
  isLoading,
  loadError,
  selectedProfileId,
  onProfileChange,
  reason,
  onReasonChange,
}: AccessProfilePickerProps) {
  const selectedOption = options.find(
    (option) => option.id === selectedProfileId,
  );
  const gate = selectedOption?.gate;

  return (
    <div className="space-y-1.5">
      <Label htmlFor="access-profile-select">Cloud access</Label>
      <Select
        value={selectedProfileId}
        onValueChange={onProfileChange}
        disabled={isLoading}
      >
        <SelectTrigger id="access-profile-select">
          {isLoading ? (
            <span className="text-muted-foreground flex items-center gap-1.5 text-sm">
              <Loader2 className="size-3.5 animate-spin" />
              Loading access profiles...
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_ACCESS_PROFILE_ID}>No cloud access</SelectItem>
          {options.map((option) => (
            <SelectItem
              key={option.id}
              value={option.id}
              disabled={!option.isEligible}
            >
              <span className="flex flex-col">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck className="size-3.5" />
                  {option.label}
                </span>
                {!option.isEligible && option.ineligibleReason && (
                  <span className="text-muted-foreground text-xs">
                    {option.ineligibleReason}
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {loadError && (
        <p className="text-destructive text-xs">
          {loadError}. Workspaces can still be created without cloud access.
        </p>
      )}

      {selectedOption?.description && (
        <p className="text-muted-foreground text-xs">
          {selectedOption.description}
        </p>
      )}

      {(gate || selectedOption?.isReasonRequired) && (
        <div className="space-y-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2">
          {gate && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <Clock className="size-3.5" />
              Access expires after {gate.ttlHours}{" "}
              {gate.ttlHours === 1 ? "hour" : "hours"}.
            </p>
          )}
          {selectedOption?.isReasonRequired && (
            <>
              <Label htmlFor="access-reason" className="text-xs">
                Reason for access
              </Label>
              <Input
                id="access-reason"
                value={reason}
                onChange={(event) => onReasonChange(event.target.value)}
                placeholder="e.g. Investigating the invoice totals report"
                className="text-sm"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
