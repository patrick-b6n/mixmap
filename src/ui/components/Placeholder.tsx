import type { ReactNode } from "react";
import { cn } from "@/ui/lib/utils";

/** Dim hint text for empty states ("Select a track", "No playlists", …). */
export function Placeholder({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("p-3 text-muted-foreground", className)}>{children}</div>;
}
