import { Asset } from 'expo-asset';
import { createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import type { RadioCueName, RadioEffectsConfig } from '../types/radio';

const activePlayers = new Set<ReturnType<typeof createAudioPlayer>>();
const cachedUrls = new Map<string, string>();
const pendingDownloads = new Map<string, Promise<void>>();
const PLAYER_LOAD_TIMEOUT_MS = 1_800;
const PLAYER_RELEASE_DELAY_MS = 8_000;
const AUDIO_SETUP_GRACE_MS = 600;

let audioSetup: Promise<void> | null = null;

function prepareCueAudio(): Promise<void> {
  if (!audioSetup) {
    const setup = (async () => {
      await setAudioModeAsync({
        interruptionMode: 'mixWithOthers',
        playsInSilentMode: true,
      });
      await setIsAudioActiveAsync(true);
    })();
    const tracked = setup.finally(() => {
      if (audioSetup === tracked) audioSetup = null;
    });
    audioSetup = tracked;
  }
  return audioSetup;
}

function releasePlayer(player: ReturnType<typeof createAudioPlayer>) {
  activePlayers.delete(player);
  try { player.remove(); } catch {}
}

function waitUntilLoaded(player: ReturnType<typeof createAudioPlayer>): Promise<boolean> {
  if (player.isLoaded) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let subscription: { remove: () => void } | null = null;
    const finish = (loaded: boolean) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      subscription?.remove();
      resolve(loaded);
    };
    subscription = player.addListener('playbackStatusUpdate', (status) => {
      if (status.isLoaded) finish(true);
    });
    if (player.isLoaded) {
      finish(true);
      return;
    }
    timer = setTimeout(() => finish(player.isLoaded), PLAYER_LOAD_TIMEOUT_MS);
  });
}

async function playLoadedSource(source: string | number, volume: number): Promise<boolean> {
  let player: ReturnType<typeof createAudioPlayer> | null = null;
  try {
    player = createAudioPlayer(source, {
      keepAudioSessionActive: true,
      updateInterval: 100,
    });
    activePlayers.add(player);
    player.volume = volume;
    if (!await waitUntilLoaded(player)) {
      releasePlayer(player);
      return false;
    }
    player.play();
    const playingPlayer = player;
    setTimeout(() => releasePlayer(playingPlayer), PLAYER_RELEASE_DELAY_MS);
    return true;
  } catch (error) {
    if (player) releasePlayer(player);
    console.warn('[VROOM_CUE_PLAYBACK]', error);
    return false;
  }
}

function cacheRadioCue(url: string) {
  if (!url || cachedUrls.has(url) || pendingDownloads.has(url)) return;
  const task = Asset.fromURI(url).downloadAsync()
    .then((asset) => {
      if (asset.localUri) cachedUrls.set(url, asset.localUri);
    })
    .catch((error) => console.warn('[VROOM_CB_CUE_CACHE]', error))
    .finally(() => pendingDownloads.delete(url));
  pendingDownloads.set(url, task);
}

export function preloadRadioCues(config?: RadioEffectsConfig | null) {
  if (!config?.enabled || !config.sounds || typeof config.sounds !== 'object') return;
  Object.values(config.sounds).forEach((sound) => {
    if (!sound?.enabled || !sound.url) return;
    cacheRadioCue(sound.url);
  });
}

export function playRadioCue(name: RadioCueName, config?: RadioEffectsConfig | null, fallbackSource?: number) {
  const sound = config?.sounds?.[name];
  if (config && !config.enabled) return;
  if (sound && (!sound.enabled || !sound.url || sound.preset === 'none')) return;
  const soundUrl = sound?.url;
  const cachedSource = soundUrl ? cachedUrls.get(soundUrl) : undefined;
  const source = soundUrl ? (cachedSource || fallbackSource || soundUrl) : fallbackSource;
  if (!source) return;
  const volume = sound ? Math.max(0, Math.min(1, Number(sound.volume) || 0)) : 1;
  if (soundUrl && !cachedSource) cacheRadioCue(soundUrl);
  const audioReady = prepareCueAudio()
    .catch((error) => console.warn('[VROOM_CUE_AUDIO_SESSION]', error));
  void Promise.race([
    audioReady,
    new Promise<void>((resolve) => setTimeout(resolve, AUDIO_SETUP_GRACE_MS)),
  ])
    .then(async () => {
      const played = await playLoadedSource(source, volume);
      if (!played && fallbackSource) {
        await new Promise((resolve) => setTimeout(resolve, 120));
        await playLoadedSource(fallbackSource, volume);
      }
    })
    .catch((error) => console.warn('[VROOM_CB_CUE]', name, error));
}
