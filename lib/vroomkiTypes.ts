export interface VroomkiTextOverlay {
  id: string;
  text: string;
  x: number;
  y: number;
  scale: number;
  rotation: number;
  color: string;
  fontSize: number;
  bgColor?: string | null;
  strokeColor?: string | null;
  strokeWidth?: number;
}

export interface VroomkiSound {
  id: number | null;
  title: string;
  artist: string;
  coverUrl?: string | null;
  audioUrl?: string | null;
  sourceType: 'spotify' | 'original' | 'audius' | string;
  sourceId: string;
  durationMs?: number | null;
  usageCount?: number;
  spotifyTrackId?: string;
  audiusTrackId?: string;
  deezerTrackId?: string;
  itunesTrackId?: string;
  hasPreview?: boolean;
  isFullTrack?: boolean;
  isPolish?: boolean;
}

export interface VroomkiDraft {
  photos: string[];
  video: string | null;
  overlays: VroomkiTextOverlay[];
  sound: VroomkiSound | null;
  useOriginalAudio: boolean;
  soundStartMs: number;
  photoDurationMs: number;
  clipStartMs: number;
  clipDurationMs: number | null;
  preselectedSoundId?: number | null;
}

export interface VroomkiCreatePayload {
  caption: string;
  photos: string[];
  video: string | null;
  carId: number | null;
  overlays: VroomkiTextOverlay[];
  soundId: number | null;
  spotifyTrackId: string | null;
  audiusTrackId: string | null;
  deezerTrackId: string | null;
  itunesTrackId: string | null;
  useOriginalAudio: boolean;
  soundStartMs: number;
  photoDurationMs: number;
  clipStartMs: number;
  clipDurationMs: number | null;
}

let draftStore: VroomkiDraft | null = null;
let focusPostIdStore: number | null = null;

export function setVroomkiDraft(draft: VroomkiDraft) {
  draftStore = draft;
}

export function setVroomkiFocusPostId(id: number) {
  focusPostIdStore = id;
}

export function consumeVroomkiFocusPostId() {
  const id = focusPostIdStore;
  focusPostIdStore = null;
  return id;
}

export function peekVroomkiDraft() {
  return draftStore;
}

export function consumeVroomkiDraft() {
  const draft = draftStore;
  draftStore = null;
  return draft;
}

export function resolveVroomkiSoundTrackIds(sound: VroomkiSound | null): Record<string, string> {
  if (!sound?.sourceId || sound.id) return {};
  const sourceId = sound.sourceId;
  const out: Record<string, string> = {};
  if (sound.spotifyTrackId || sound.sourceType === 'spotify') out.spotifyTrackId = sound.spotifyTrackId ?? sourceId;
  if (sound.audiusTrackId || sound.sourceType === 'audius') out.audiusTrackId = sound.audiusTrackId ?? sourceId;
  if (sound.deezerTrackId || sound.sourceType === 'deezer') out.deezerTrackId = sound.deezerTrackId ?? sourceId;
  if (sound.itunesTrackId || sound.sourceType === 'itunes') out.itunesTrackId = sound.itunesTrackId ?? sourceId;
  return out;
}

export const VROOMKI_TEXT_COLORS = ['#ffffff', '#000000', '#e33835', '#ffd700', '#00e5ff', '#9b59ff'];
