import { useQuery } from "@tanstack/react-query";
import { SlidersHorizontal } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { useAppServices } from "@/app/app-services";
import {
  ANALYSIS_LAYERS,
  type AnalysisLayer,
  type AnalysisLayers,
  barLines,
  DEFAULT_LAYERS,
  formatTime,
  loopBeats,
  parseLayers,
  stripDurationMs,
  timeTicks,
} from "@/business/analysis";
import type { Beat, Cue, Phrase, Track, Waveform } from "@/business/model";
import { Button } from "@/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/ui/components/ui/dropdown-menu";
import { errorMessage } from "@/ui/errors";
import { m } from "@/paraglide/messages.js";
import { queryKeys } from "../queries";

// Vertical layout of the strip (px): hot cue flags, waveform, phrases, time axis.
const STRIP_HEIGHT = 96;
const WAVE_TOP = 14;
const WAVE_H = 52;
const PHRASE_TOP = 67;
const PHRASE_H = 10;
const AXIS_TOP = 79;
/** Narrower phrases show their name only as a tooltip. */
const MIN_PHRASE_LABEL_PX = 32;
/** Room kept free for the length label at the end of the axis. */
const LENGTH_LABEL_PX = 40;

const LAYERS_KEY = "mixmap.analysisLayers";

// Stable empty arrays, so the canvas doesn't redraw on every render.
const NO_BEATS: Beat[] = [];
const NO_CUES: Cue[] = [];

function loadLayers(): AnalysisLayers {
  try {
    return parseLayers(localStorage.getItem(LAYERS_KEY));
  } catch {
    return DEFAULT_LAYERS;
  }
}

function saveLayers(layers: AnalysisLayers): void {
  try {
    localStorage.setItem(LAYERS_KEY, JSON.stringify(layers));
  } catch {
    // Storage unavailable: layers just aren't remembered.
  }
}

const LAYER_LABELS: Record<AnalysisLayer, () => string> = {
  beatGrid: m.analysis_layer_beat_grid,
  hotCues: m.analysis_layer_hot_cues,
  length: m.analysis_layer_length,
  loops: m.analysis_layer_loops,
  memoryCues: m.analysis_layer_memory_cues,
  phrases: m.analysis_layer_phrases,
  timeAxis: m.analysis_layer_time_axis,
  waveform: m.analysis_layer_waveform,
};

function phraseLabel(p: Phrase): string {
  switch (p.kind) {
    case "bridge":
      return m.analysis_phrase_bridge();
    case "chorus":
      return m.analysis_phrase_chorus();
    case "down":
      return m.analysis_phrase_down();
    case "intro":
      return m.analysis_phrase_intro();
    case "outro":
      return m.analysis_phrase_outro();
    case "up":
      return m.analysis_phrase_up();
    case "verse":
      return m.analysis_phrase_verse({ number: p.number ?? 1 });
  }
}

function cueColor(cue: Cue): string {
  if (cue.color !== null) return `var(--cue-${cue.color})`;
  return cue.hotCue ? "var(--cue-hot)" : "var(--cue-memory)";
}

function cueTitle(cue: Cue, bpm: number): string {
  const time = formatTime(cue.startMs);
  // The comment is rekordbox data, not a message.
  const parts: string[] = [
    cue.hotCue ? m.analysis_hot_cue({ letter: cue.hotCue, time }) : m.analysis_memory_cue({ time }),
  ];
  if (cue.endMs !== null) {
    const range = { end: formatTime(cue.endMs), start: time };
    const beats = loopBeats(cue, bpm);
    parts.push(
      beats === null ? m.analysis_loop_no_bpm(range) : m.analysis_loop({ ...range, count: beats }),
    );
  }
  if (cue.comment) parts.push(cue.comment);
  return parts.join(" · ");
}

/** Width of an element in CSS pixels, kept up to date. */
function useWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return Math.floor(width);
}

/**
 * Overview of the selected track above the table: rekordbox's waveform with hot cues,
 * memory cues, loops, beat grid, phrases and a time axis. Each layer can be switched off.
 */
export function AnalysisStrip({ track, version }: { track?: Track; version: number }) {
  const [layers, setLayers] = useState(loadLayers);
  useEffect(() => saveLayers(layers), [layers]);
  const plotRef = useRef<HTMLDivElement>(null);
  const width = useWidth(plotRef);
  return (
    <div
      aria-label={m.analysis_region()}
      className="flex bg-card select-none"
      role="region"
      style={{ height: STRIP_HEIGHT }}
    >
      <div className="relative min-w-0 flex-1 overflow-hidden" ref={plotRef}>
        {track ? (
          <Plot layers={layers} track={track} version={version} width={width} />
        ) : (
          <Message>{m.analysis_none_selected()}</Message>
        )}
      </div>
      <div className="flex w-8 flex-none justify-center pt-1">
        <LayerMenu
          layers={layers}
          onToggle={(layer, on) => setLayers((l) => ({ ...l, [layer]: on }))}
        />
      </div>
    </div>
  );
}

function Message({
  children,
  height = STRIP_HEIGHT,
  top = 0,
}: {
  children: ReactNode;
  height?: number;
  top?: number;
}) {
  return (
    <div
      className="absolute inset-x-0 flex items-center justify-center text-muted-foreground"
      style={{ height, top }}
    >
      {children}
    </div>
  );
}

function Plot({
  layers,
  track,
  version,
  width,
}: {
  layers: AnalysisLayers;
  track: Track;
  version: number;
  width: number;
}) {
  const { backend } = useAppServices();
  const query = useQuery({
    queryFn: () => backend.trackAnalysis(track.id),
    queryKey: [...queryKeys.trackAnalysis, track.id, version],
  });
  const analysis = query.data?.analysis ?? null;
  const cues = query.data?.cues ?? NO_CUES;
  const beats = analysis?.beats ?? NO_BEATS;
  const duration = stripDurationMs(track.length, beats);
  if (duration <= 0) return null;
  const pct = (ms: number) => `${(Math.min(Math.max(ms, 0), duration) / duration) * 100}%`;
  const px = (ms: number) => (ms / duration) * width;

  let notice: string | undefined;
  if (query.isError) notice = m.analysis_failed({ error: errorMessage(query.error) });
  else if (query.isSuccess && !analysis) notice = m.analysis_unavailable();

  const loops = cues.filter((c) => c.endMs !== null);
  const hotCues = cues.filter((c) => c.hotCue !== null);
  const memoryCues = cues.filter((c) => c.hotCue === null);
  const ticks = layers.timeAxis
    ? timeTicks(duration, width).filter(
        (t) => !layers.length || px(duration - t) >= LENGTH_LABEL_PX,
      )
    : [];

  return (
    <>
      {(layers.waveform || layers.beatGrid) && (
        <WaveCanvas
          beats={layers.beatGrid ? beats : NO_BEATS}
          duration={duration}
          // The waveform covers the audio, which may end before the beat grid does.
          waveWidth={Math.round(px(track.length * 1000))}
          waveform={layers.waveform ? (analysis?.waveform ?? null) : null}
          width={width}
        />
      )}
      {notice && (
        <Message height={WAVE_H} top={WAVE_TOP}>
          <span className="truncate px-2" title={notice}>
            {notice}
          </span>
        </Message>
      )}
      {layers.loops &&
        loops.map((c, i) => (
          <div
            className="absolute"
            key={`loop-${i}`}
            style={{
              background: "var(--cue-loop)",
              height: WAVE_H,
              left: pct(c.startMs),
              opacity: c.hotCue ? 0.3 : 0.15,
              top: WAVE_TOP,
              width: pct((c.endMs ?? c.startMs) - c.startMs),
            }}
            title={cueTitle(c, track.bpm)}
          />
        ))}
      {layers.memoryCues &&
        memoryCues.map((c, i) => (
          <div
            className="absolute -translate-x-1/2"
            key={`mem-${i}`}
            style={{
              borderBottom: `7px solid ${cueColor(c)}`,
              borderLeft: "5px solid transparent",
              borderRight: "5px solid transparent",
              left: pct(c.startMs),
              opacity: c.endMs === null ? 1 : 0.7,
              top: WAVE_TOP + WAVE_H - 7,
            }}
            title={cueTitle(c, track.bpm)}
          />
        ))}
      {layers.hotCues &&
        hotCues.map((c, i) => (
          <div
            className="absolute top-0"
            key={`hot-${i}`}
            style={{ left: pct(c.startMs) }}
            title={cueTitle(c, track.bpm)}
          >
            <div
              className="px-1 text-[10px] leading-[14px] font-bold text-black"
              style={{ background: cueColor(c), height: WAVE_TOP }}
            >
              {c.hotCue}
            </div>
            <div className="w-px" style={{ background: cueColor(c), height: WAVE_H }} />
          </div>
        ))}
      {layers.phrases &&
        (analysis?.phrases ?? []).map((p, i) => (
          <div
            className="absolute overflow-hidden border-r border-card px-0.5 text-[9px] leading-[10px] whitespace-nowrap text-white"
            key={`phrase-${i}`}
            style={{
              background: `var(--phrase-${p.kind})`,
              height: PHRASE_H,
              left: pct(p.startMs),
              top: PHRASE_TOP,
              width: pct(p.endMs - p.startMs),
            }}
            title={m.analysis_phrase_range({
              end: formatTime(p.endMs),
              name: phraseLabel(p),
              start: formatTime(p.startMs),
            })}
          >
            {px(p.endMs - p.startMs) >= MIN_PHRASE_LABEL_PX && phraseLabel(p)}
          </div>
        ))}
      {ticks.map((t) => (
        <div
          className="absolute -translate-x-1/2 text-[10px] leading-[16px] text-muted-foreground"
          key={`tick-${t}`}
          style={{ left: pct(t), top: AXIS_TOP }}
        >
          {formatTime(t)}
        </div>
      ))}
      {layers.length && (
        <div
          className="absolute right-1 text-[10px] leading-[16px] text-muted-foreground"
          style={{ top: AXIS_TOP }}
          title={m.analysis_length({ time: formatTime(track.length * 1000) })}
        >
          {formatTime(track.length * 1000)}
        </div>
      )}
    </>
  );
}

/** Waveform and beat grid, drawn on a canvas the width of the strip. */
function WaveCanvas({
  beats,
  duration,
  waveWidth,
  waveform,
  width,
}: {
  beats: Beat[];
  duration: number;
  /** Pixels the waveform spans (the audio's length). */
  waveWidth: number;
  waveform: Waveform | null;
  width: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(WAVE_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, WAVE_H);
    const style = getComputedStyle(canvas);
    const color = (name: string) => style.getPropertyValue(name).trim();
    if (waveform) drawWaveform(ctx, waveform, Math.min(waveWidth, width), color);
    for (const line of barLines(beats, duration, width)) {
      ctx.fillStyle = color(line.strong ? "--grid-strong" : "--grid-bar");
      ctx.fillRect(Math.round((line.timeMs / duration) * width), 0, 1, WAVE_H);
    }
  }, [beats, duration, waveWidth, waveform, width]);
  return (
    <canvas
      className="absolute left-0"
      ref={ref}
      style={{ height: WAVE_H, top: WAVE_TOP, width }}
    />
  );
}

/** Mirrored around the middle; three bands drawn low, mid, high on top of each other. */
function drawWaveform(
  ctx: CanvasRenderingContext2D,
  waveform: Waveform,
  width: number,
  color: (name: string) => string,
) {
  const bands = waveform.kind === "threeBand" ? 3 : 1;
  const { values } = waveform;
  const columns = Math.floor(values.length / bands);
  if (columns === 0) return;
  const max = waveform.kind === "mono" ? 31 : values.reduce((a, b) => Math.max(a, b), 1);
  const fills =
    waveform.kind === "mono"
      ? [color("--wave-mono")]
      : [color("--wave-low"), color("--wave-mid"), color("--wave-high")];
  const middle = WAVE_H / 2;
  for (let band = 0; band < bands; band++) {
    ctx.fillStyle = fills[band] ?? "";
    for (let x = 0; x < width; x++) {
      // The loudest column under this pixel.
      const from = Math.floor((x * columns) / width);
      const to = Math.max(from + 1, Math.floor(((x + 1) * columns) / width));
      let v = 0;
      for (let i = from; i < to && i < columns; i++) v = Math.max(v, values[i * bands + band] ?? 0);
      const h = (v / max) * middle;
      if (h > 0) ctx.fillRect(x, middle - h, 1, h * 2);
    }
  }
}

function LayerMenu({
  layers,
  onToggle,
}: {
  layers: AnalysisLayers;
  onToggle: (layer: AnalysisLayer, on: boolean) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label={m.analysis_layers()}
            size="icon-compact"
            title={m.analysis_layers()}
            variant="ghost"
          />
        }
      >
        <SlidersHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ANALYSIS_LAYERS.map((layer) => (
          <DropdownMenuCheckboxItem
            checked={layers[layer]}
            key={layer}
            onCheckedChange={(checked) => onToggle(layer, checked === true)}
          >
            {LAYER_LABELS[layer]()}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
