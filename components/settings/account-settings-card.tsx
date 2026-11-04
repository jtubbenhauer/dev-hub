"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function AccountSettingsCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>
          End your Dev Hub session on this device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          variant="outline"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          Log out
        </Button>
      </CardContent>
    </Card>
  );
}
