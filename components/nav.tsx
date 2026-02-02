"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Settings } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav() {
  const pathname = usePathname();

  // Don't show nav on watch page
  if (pathname.startsWith("/watch")) {
    return null;
  }

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-sm border-b border-zinc-800">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center h-14">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 mr-8">
            <div className="h-8 w-8 bg-red-600 rounded-lg flex items-center justify-center text-lg">
              🛸
            </div>
            <span className="font-bold text-lg hidden sm:block">Spaceflix</span>
          </Link>

          {/* Nav items */}
          <div className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors",
                    isActive
                      ? "bg-zinc-800 text-white"
                      : "text-zinc-400 hover:text-white hover:bg-zinc-800/50"
                  )}
                >
                  <item.icon className="h-4 w-4" />
                  <span className="hidden sm:block">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
