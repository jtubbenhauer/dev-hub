"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useKeyboardVisible } from "@/hooks/use-keyboard-visible";
import { isNavItemActive, NAV_ITEMS } from "@/components/layout/nav-items";

export function MobileNav() {
  const pathname = usePathname();
  const isKeyboardVisible = useKeyboardVisible();

  if (isKeyboardVisible) return null;

  return (
    <nav className="bg-background fixed right-0 bottom-0 left-0 z-50 flex h-16 items-center justify-around border-t md:hidden">
      {NAV_ITEMS.map((item) => {
        const isActive = isNavItemActive(item.href, pathname);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-1 px-1 py-1 text-[10px] transition-colors",
              isActive ? "text-primary" : "text-muted-foreground",
            )}
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
