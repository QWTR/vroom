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

export function playRadioCue(name: RadioCueName, config?: RadioEffectsConfig | null) {
  const sound = config?.sounds?.[name];
  if (!config?.enabled || !sound?.enabled || !sound.url || sound.preset === 'none') return;
  try {
    const source = cachedUrls.get(sound.url) || sound.url;
    const player = createAudioPlayer(source, { keepAudioSessionActive: true, updateInterval: 1_000 });
    activePlayers.add(player);
    player.volume = Math.max(0, Math.min(1, Number(sound.volume) || 0));
    player.play();
    if (!cachedUrls.has(sound.url)) cacheRadioCue(sound.url);
    setTimeout(() => {
      activePlayers.delete(player);
      try { player.remove(); } catch {}
    }, 4_000);
  } catch (error) {
    console.warn('[VROOM_CB_CUE]', name, error);
  }
}
