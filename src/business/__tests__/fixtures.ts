import type { Track } from "../model";

/** A rekordbox track for tests. */
export const track = (id: string, artist: string, title: string, length = 300): Track => ({
  album: "",
  analysisPath: null,
  artist,
  artworkPath: null,
  bpm: 128,
  comment: "",
  filePath: "",
  genre: "",
  id,
  key: "8A",
  length,
  rating: 0,
  title,
});
