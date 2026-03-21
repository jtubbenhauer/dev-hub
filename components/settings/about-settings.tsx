"use client";

import { useState, useEffect } from "react";
import { ExternalLink } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";

interface SystemInfo {
  os: string;
  nodeVersion: string;
  gitVersion: string;
}

export function AboutSettings() {
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  useEffect(() => {
    fetch("/api/settings/about")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: SystemInfo | null) => {
        if (data) setSystemInfo(data);
      })
      .catch(() => {});
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>About</CardTitle>
        <CardDescription>Application and system information.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">App version</span>
          <span className="font-mono">0.1.0</span>
        </div>
        {systemInfo && (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">OS</span>
              <span className="font-mono">{systemInfo.os}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Node.js</span>
              <span className="font-mono">{systemInfo.nodeVersion}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Git</span>
              <span className="font-mono">{systemInfo.gitVersion}</span>
            </div>
          </>
        )}
        <div className="pt-2">
          <a
            href="https://github.com/jtubbenhauer/dev-hub"
            target="_blank"
            rel="noopener noreferrer"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ExternalLink className="size-3.5" />
            View on GitHub
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
