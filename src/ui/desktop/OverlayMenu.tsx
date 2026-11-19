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
import { m } from "@/paraglide/messages.js";

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
      <DropdownMenuTrigger render={<Button />}>
        <PictureInPicture2 />
        {m.overlay_menu()}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => void toggleOverlay().then(setVisible)}>
          {visible ? m.overlay_menu_hide() : m.overlay_menu_show()}
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem
          checked={through}
          onCheckedChange={(on) => {
            setThrough(on);
            void setClickThrough(on);
          }}
        >
          {m.overlay_menu_click_through()}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
