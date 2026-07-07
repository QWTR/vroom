import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { API_URL } from '../constants/config';
import { prepareUploadImages } from './prepareUploadImages';
import { resolveVroomkiSoundTrackIds, setVroomkiFocusPostId } from './vroomkiTypes';
import type { VroomkiDraft } from './vroomkiTypes';
import type { VroomkiPost } from '../app/Community/community/communityShared';

const FREE_VIDEO_MAX_BYTES = 20 * 1024 * 1024;
const PREMIUM_VIDEO_MAX_BYTES = 120 * 1024 * 1024;

export type VroomkiBackgroundPublishPayload = {
  caption: string;
  carId: number | null;
  draft: VroomkiDraft;
};

type PublishEvent =
  | { type: 'started' }
  | { type: 'success'; post: VroomkiPost }
  | { type: 'error'; message: string };

type PublishListener = (event: PublishEvent) => void;

const listeners = new Set<PublishListener>();
let running = false;
const queue: Array<{
  payload: VroomkiBackgroundPublishPayload;
  isPremium: boolean;
  isAdmin: boolean;
}> = [];

async function getToken() {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

function emit(event: PublishEvent) {
  listeners.forEach((listener) => {
    try {
      listener(event);
    } catch {
      /* ignore */
    }
  });
}

function buildCommonFields(payload: VroomkiBackgroundPublishPayload) {
  const { draft, caption, carId } = payload;
  const sound = draft.sound;
  const trackIds = sound ? resolveVroomkiSoundTrackIds(sound) : {};

  return {
    caption: caption.trim(),
    overlays: JSON.stringify(draft.overlays ?? []),
    soundStartMs: String(draft.soundStartMs ?? 0),
    photoDurationMs: String(draft.photoDurationMs ?? 3000),
    clipStartMs: String(draft.clipStartMs ?? 0),
    ...(draft.clipDurationMs ? { clipDurationMs: String(draft.clipDurationMs) } : {}),
    ...(carId ? { carId: String(carId) } : {}),
    ...(draft.useOriginalAudio ? { useOriginalAudio: 'true' } : {}),
    ...(sound?.id ? { soundId: String(sound.id) } : {}),
    ...trackIds,
  };
}

async function publishOne(
  payload: VroomkiBackgroundPublishPayload,
  isPremium: boolean,
  isAdmin: boolean,
): Promise<VroomkiPost> {
  const token = await getToken();
  if (!token) throw new Error('Brak tokenu');

  const commonFields = buildCommonFields(payload);
  const { draft } = payload;

  if (draft.video) {
    const info = await FileSystem.getInfoAsync(draft.video, { size: true } as any);
    const fileSize = Number((info as { size?: number }).size ?? 0);
    const maxBytes = isAdmin ? null : isPremium ? PREMIUM_VIDEO_MAX_BYTES : FREE_VIDEO_MAX_BYTES;
    if (maxBytes !== null && fileSize > maxBytes) {
      if (!isPremium && !isAdmin) {
        throw new Error('Odblokuj Premium, aby wysyłać filmy do 120MB');
      }
      throw new Error('Maksymalny rozmiar filmu to 120MB');
    }

    const ext = draft.video.split('.').pop() ?? 'mp4';
    const result = await FileSystem.uploadAsync(`${API_URL}/api/vroomki`, draft.video, {
      httpMethod: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      uploadType: FileSystem.FileSystemUploadType.MULTIPART,
      fieldName: 'video',
      mimeType: `video/${ext}`,
      parameters: commonFields,
      sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
    });

    const body = result.body ? JSON.parse(result.body) : null;
    if (result.status !== 200 && result.status !== 201) {
      throw new Error(body?.error ?? 'Błąd wysyłania filmu');
    }
    return body as VroomkiPost;
  }

  const preparedPhotos = draft.photos.length ? await prepareUploadImages(draft.photos) : [];
  const form = new FormData();
  Object.entries(commonFields).forEach(([key, value]) => form.append(key, value));
  preparedPhotos.forEach((uri, i) => {
    form.append('photos', { uri, name: `vroomki_${i}.jpg`, type: 'image/jpeg' } as any);
  });

  const res = await fetch(`${API_URL}/api/vroomki`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? 'Nie udało się opublikować');
  return body as VroomkiPost;
}

async function drainQueue() {
  if (running) return;
  running = true;

  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) break;

    emit({ type: 'started' });
    try {
      const post = await publishOne(job.payload, job.isPremium, job.isAdmin);
      setVroomkiFocusPostId(post.id);
      Toast.show({
        type: 'success',
        text1: 'VROOMKA opublikowana!',
        text2: 'Już jest w feedzie',
      });
      emit({ type: 'success', post });
    } catch (e: any) {
      const message = e?.message ?? 'Nie udało się opublikować';
      Toast.show({ type: 'error', text1: 'Publikacja nieudana', text2: message });
      emit({ type: 'error', message });
    }
  }

  running = false;
}

export function subscribeVroomkiPublish(listener: PublishListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function enqueueVroomkiPublish(
  payload: VroomkiBackgroundPublishPayload,
  opts: { isPremium?: boolean; isAdmin?: boolean } = {},
) {
  queue.push({
    payload,
    isPremium: !!opts.isPremium,
    isAdmin: !!opts.isAdmin,
  });
  void drainQueue();
}

export function isVroomkiPublishRunning() {
  return running || queue.length > 0;
}
