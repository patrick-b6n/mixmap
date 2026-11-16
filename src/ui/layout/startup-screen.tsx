import { Placeholder } from "@/ui/components/Placeholder";

/** While the database opens. */
export function StartupLoadingScreen() {
  return <Placeholder className="flex h-full items-center justify-center">Loading…</Placeholder>;
}

/** The app could not start (no Tauri host, or mixmap.db could not be opened). */
export function StartupErrorScreen({ error }: { error: string }) {
  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center"
      role="alert"
    >
      <div className="font-medium">mixmap could not start</div>
      <div className="max-w-140 text-xs [overflow-wrap:anywhere] text-muted-foreground">
        {error}
      </div>
    </div>
  );
}
