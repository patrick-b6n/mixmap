import { PictureInPicture2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import { clickThrough, overlayVisible, setClickThrough, toggleOverlay } from "@/app/overlay-window";

/** Main-window toolbar menu for the live overlay (desktop app only). */
export function OverlayMenu() {
  const [visible, setVisible] = useState(false);
  const [through, setThrough] = useState(clickThrough);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (!open) return;
        void overlayVisible().then(setVisible);
        setThrough(clickThrough());
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button>
          <PictureInPicture2 />
          Overlay
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onSelect={() => void toggleOverlay().then(setVisible)}>
          {visible ? "Hide overlay" : "Show overlay"}
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem
          checked={through}
          onCheckedChange={(on) => {
            setThrough(on);
            void setClickThrough(on);
          }}
        >
          Click-through
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
