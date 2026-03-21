"use client";

import { useEffect } from "react";
import { AlertOctagon, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Page error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertOctagon className="text-destructive size-5" />
            <CardTitle>Something went wrong</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">
            An unexpected error occurred while loading this page.
          </p>
          {error.digest && (
            <p className="text-muted-foreground mt-2 font-mono text-xs">
              Error ID: {error.digest}
            </p>
          )}
        </CardContent>
        <CardFooter>
          <Button onClick={reset} variant="outline" size="sm">
            <RotateCcw className="size-4" />
            Try again
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
