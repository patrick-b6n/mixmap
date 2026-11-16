import { ArrowDown, Star, Trash2, X } from "lucide-react";
import { type KeyboardEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Link } from "../db/links";
import type { LinkUpdate } from "./useLinkActions";

type Props = {
  /** Display names of the endpoints. */
  fromLabel: string;
  link: Link;
  onDelete: () => void;
  onUpdate: (update: LinkUpdate) => void;
  toLabel: string;
};

/** Right panel for a selected link: comment, rating, tags, delete. */
export function LinkEditor({ fromLabel, link, onDelete, onUpdate, toLabel }: Props) {
  // Local drafts, re-initialized when another link is selected.
  const id = `${link.from}\u0001${link.to}`;
  const [draftFor, setDraftFor] = useState(id);
  const [comment, setComment] = useState(link.comment);
  const [tagDraft, setTagDraft] = useState("");
  if (draftFor !== id) {
    setDraftFor(id);
    setComment(link.comment);
    setTagDraft("");
  }

  const saveComment = () => {
    if (comment !== link.comment) onUpdate({ comment });
  };

  const addTag = () => {
    const t = tagDraft.trim();
    // Computed from the stored tags, so quick successive edits don't overwrite each other.
    if (t) onUpdate((cur) => ({ tags: [...cur.tags, t] }));
    setTagDraft("");
  };

  const onTagKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag();
    }
    if (e.key === "Backspace" && !tagDraft && link.tags.length) onUpdate((cur) => ({ tags: cur.tags.slice(0, -1) }));
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div>
        <div className="text-[11px] tracking-wider text-muted-foreground uppercase">Link</div>
        <div className="mt-1 font-semibold [overflow-wrap:anywhere]">{fromLabel}</div>
        <ArrowDown className="my-0.5 size-3.5 text-muted-foreground" />
        <div className="font-semibold [overflow-wrap:anywhere]">{toLabel}</div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Comment</span>
        <textarea
          className="min-h-20 resize-y rounded-sm border border-input bg-transparent px-1.5 py-1 outline-none focus-visible:border-ring"
          onBlur={saveComment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="How do you mix these? (e.g. long filter blend over the breakdown)"
          value={comment}
        />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground">Rating</span>
        <div aria-label="Rating" className="flex gap-0.5" role="radiogroup">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              aria-checked={link.rating === n}
              aria-label={`${n} star${n > 1 ? "s" : ""}`}
              className="rounded-sm p-0.5 outline-none focus-visible:outline-1 focus-visible:outline-ring"
              key={n}
              // Clicking the current rating clears it.
              onClick={() => onUpdate({ rating: link.rating === n ? null : n })}
              role="radio"
              title={link.rating === n ? "Clear rating" : `${n} of 5`}
            >
              <Star
                className={cn("size-4", (link.rating ?? 0) >= n ? "fill-rating text-rating" : "text-muted-foreground")}
              />
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground">Tags</span>
        <div className="flex flex-wrap gap-1">
          {link.tags.map((t) => (
            <span className="flex items-center gap-0.5 rounded-sm bg-muted py-0.5 pr-0.5 pl-1.5 text-[12px]" key={t}>
              {t}
              <button
                aria-label={`Remove tag ${t}`}
                className="rounded-sm text-muted-foreground hover:text-foreground"
                onClick={() => onUpdate((cur) => ({ tags: cur.tags.filter((x) => x !== t) }))}
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
        <Input
          aria-label="Add tag"
          onBlur={addTag}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={onTagKey}
          placeholder="Add tag, press Enter"
          value={tagDraft}
        />
      </div>

      <Button className="self-start text-destructive hover:border-destructive" onClick={onDelete}>
        <Trash2 />
        Delete link
      </Button>
    </div>
  );
}
