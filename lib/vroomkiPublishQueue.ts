import * as FileSystem from 'expo-file-system/legacy';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Toast from 'react-native-toast-message';
import { API_URL } from '../constants/config';
import { prepareUploadImages } from './prepareUploadImages';
import { resolveVroomkiSoundTrackIds, setVroomkiFocusPostId } from './vroomkiTypes';
import type { VroomkiDraft } from './vroomkiTypes';
import type { VroomkiPost } from '../app/Community/community/communityShared';

const VROOMKI_FREE_VIDEO_MAX_BYTES = 250 * 1024 * 1024;
const LAST_PUBLISHED_POST_KEY = 'vroomki_last_published_post_id';

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
let lastSuccessEvent: Extract<PublishEvent, { type: 'success' }> | null = null;
const queue: Array<{
  payload: VroomkiBackgroundPublishPayload;
  isPremium: boolean;
  isAdmin: boolean;
}> = [];

async function getToken() {
  return (await AsyncStorage.getItem('userToken')) ?? (await AsyncStorage.getItem('token'));
}

async function getCurrentUserId() {
  const raw = await AsyncStorage.getItem('user');
  if (!raw) return null;
  try {
    const user = JSON.parse(raw);
    const id = Number(user.userId ?? user.id);
    return Number.isFinite(id) ? id : null;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecoverableUploadError(message: string) {
  const normalized = message.toLowerCase();
  return normalized.includes('connection abort') ||
    normalized.includes('network request failed') ||
    normalized.includes('timeout') ||
    normalized.includes('cancelled') ||
    normalized.includes('canceled');
}

async function findNewestOwnVroomkiSince(startedAt: number): Promise<VroomkiPost | null> {
  const token = await getToken();
  const userId = await getCurrentUserId();
  if (!token || !userId) return null;

  const res = await fetch(`${API_URL}/api/vroomki/user/${userId}?limit=8`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;

  const body = await res.json().catch(() => null);
  const posts = (body?.posts ?? []) as VroomkiPost[];
  const minCreatedAt = startedAt - 2 * 60 * 1000;
  return posts.find((post) => {
    const createdAt = new Date(post.createdAt).getTime();
    return Number.isFinite(createdAt) &&
      createdAt >= minCreatedAt &&
      (post.videos?.length ?? 0) > 0;
  }) ?? null;
}

async function recoverPublishedPostAfterConnectionAbort(startedAt: number): Promise<VroomkiPost | null> {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    await sleep(attempt === 1 ? 4000 : 5000);
    try {
      const post = await findNewestOwnVroomkiSince(startedAt);
      if (post) {
        console.info('[vroomkiPublish] recovered post after connection abort', {
          postId: post.id,
          attempt,
        });
        return post;
      }
    } catch (e) {
      console.warn('[vroomkiPublish] recovery poll failed', {
        attempt,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return null;
}

async function canUseLocalNotifications() {
  try {
    const current = await Notifications.getPermissionsAsync();
    if (current.granted || current.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return true;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted || requested.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
  } catch {
    return false;
  }
}

async function showPublishNotification(
  title: string,
  body: string,
  postId?: number,
  type: 'vroomki_publish_status' | 'vroomki_published' | 'vroomki_publish_failed' = postId
    ? 'vroomki_published'
    : 'vroomki_publish_status',
) {
  try {
    const allowed = await canUseLocalNotifications();
    if (!allowed) return;
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        body,
        sound: 'default',
        data: postId ? { type, vroomkiPostId: postId } : { type },
        android: {
          channelId: 'vroomki_publish',
          priority: 'max',
          smallIcon: 'notification_icon',
          color: '#e33835',
        } as any,
      },
      trigger: null,
    });
  } catch (e) {
    console.warn('[vroomkiPublish] local notification failed', e);
  }
}

function emit(event: PublishEvent) {
  if (event.type === 'success') lastSuccessEvent = event;
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
    const maxBytes = (isAdmin || isPremium) ? null : VROOMKI_FREE_VIDEO_MAX_BYTES;
    if (maxBytes !== null && fileSize > maxBytes) {
      throw new Error('Maksymalny rozmiar filmu VROOMKI bez Premium to 250MB');
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

    console.info('[vroomkiPublish] upload finished', {
      status: result.status,
      bodyBytes: result.body?.length ?? 0,
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
    const jobStartedAt = Date.now();
    let progressTick = 0;
    const progressTimer = setInterval(() => {
      progressTick += 1;
      Toast.show({
        type: 'info',
        text1: 'Publikujemy VROOMKĘ...',
        text2: progressTick === 1
          ? 'Film jest wysyłany i kompresowany na serwerze'
          : 'Duże 4K może potrwać chwilę, nie zamykaj aplikacji',
        visibilityTime: 9000,
      });
    }, 25_000);

    try {
      console.info('[vroomkiPublish] job started', {
        hasVideo: !!job.payload.draft.video,
        photosCount: job.payload.draft.photos.length,
      });
      Toast.show({
        type: 'info',
        text1: 'Publikujemy VROOMKĘ...',
        text2: job.payload.draft.video ? 'Upload i kompresja działają w tle' : 'Dodajemy do feedu',
        visibilityTime: 9000,
      });
      void showPublishNotification(
        'Publikujemy VROOMKĘ',
        job.payload.draft.video ? 'Film jest wysyłany i kompresowany' : 'Dodajemy ją do feedu',
      );
      const post = await publishOne(job.payload, job.isPremium, job.isAdmin);
      console.info('[vroomkiPublish] job success', { postId: post.id });
      setVroomkiFocusPostId(post.id);
      await AsyncStorage.setItem(LAST_PUBLISHED_POST_KEY, String(post.id));
      Toast.show({
        type: 'success',
        text1: 'VROOMKA opublikowana!',
        text2: 'Otwieramy ją w feedzie',
        visibilityTime: 7000,
      });
      void showPublishNotification('VROOMKA opublikowana', 'Dotknij, żeby ją otworzyć', post.id);
      emit({ type: 'success', post });
    } catch (e: any) {
      const message = e?.message ?? 'Nie udało się opublikować';
      console.warn('[vroomkiPublish] job error', { message });

      if (job.payload.draft.video && isRecoverableUploadError(message)) {
        Toast.show({
          type: 'info',
          text1: 'Sprawdzamy publikację...',
          text2: 'Serwer może jeszcze kończyć kompresję filmu',
          visibilityTime: 9000,
        });
        void showPublishNotification(
          'Sprawdzamy VROOMKĘ',
          'Połączenie się zerwało, ale serwer może jeszcze ją dodawać',
        );

        const recoveredPost = await recoverPublishedPostAfterConnectionAbort(jobStartedAt);
        if (recoveredPost) {
          setVroomkiFocusPostId(recoveredPost.id);
          await AsyncStorage.setItem(LAST_PUBLISHED_POST_KEY, String(recoveredPost.id));
          Toast.show({
            type: 'success',
            text1: 'VROOMKA opublikowana!',
            text2: 'Otwieramy ją w feedzie',
            visibilityTime: 7000,
          });
          void showPublishNotification('VROOMKA opublikowana', 'Dotknij, żeby ją otworzyć', recoveredPost.id);
          emit({ type: 'success', post: recoveredPost });
          continue;
        }
      }

      Toast.show({ type: 'error', text1: 'Publikacja nieudana', text2: message, visibilityTime: 8000 });
      void showPublishNotification('Publikacja nieudana', message, undefined, 'vroomki_publish_failed');
      emit({ type: 'error', message });
    } finally {
      clearInterval(progressTimer);
    }
  }

  running = false;
}

export function subscribeVroomkiPublish(listener: PublishListener) {
  listeners.add(listener);
  if (lastSuccessEvent) {
    setTimeout(() => {
      if (listeners.has(listener) && lastSuccessEvent) listener(lastSuccessEvent);
    }, 0);
  }
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
