import { Asset } from 'expo-asset';
import { createAudioPlayer } from 'expo-audio';
import type { RadioCueName, RadioEffectsConfig } from '../types/radio';

const activePlayers = new Set<ReturnType<typeof createAudioPlayer>>();
const cachedUrls = new Map<string, string>();
const pendingDownloads = new Map<string, Promise<void>>();

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
  try {
    const player = createAudioPlayer(source, { keepAudioSessionActive: true, updateInterval: 1_000 });
    activePlayers.add(player);
    player.volume = sound ? Math.max(0, Math.min(1, Number(sound.volume) || 0)) : 1;
    player.play();
    if (soundUrl && !cachedSource) cacheRadioCue(soundUrl);
    setTimeout(() => {
      activePlayers.delete(player);
      try { player.remove(); } catch {}
    }, 4_000);
  } catch (error) {
    console.warn('[VROOM_CB_CUE]', name, error);
  }
}
