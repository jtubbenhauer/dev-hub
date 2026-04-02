"use client";

import { AuthenticatedLayout } from "@/components/layout/authenticated-layout";
import { LensInterface } from "@/components/lens/lens-interface";

export default function LensRoute() {
  return (
    <AuthenticatedLayout>
      <LensInterface />
    </AuthenticatedLayout>
  );
}
