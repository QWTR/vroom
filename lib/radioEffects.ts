import { createAudioPlayer, preload } from 'expo-audio';
import type { RadioCueName, RadioEffectsConfig } from '../types/radio';

const activePlayers = new Set<ReturnType<typeof createAudioPlayer>>();
const preloadedUrls = new Set<string>();

export function preloadRadioCues(config?: RadioEffectsConfig | null) {
  if (!config?.enabled) return;
  Object.values(config.sounds).forEach((sound) => {
    if (!sound.enabled || !sound.url || preloadedUrls.has(sound.url)) return;
    preloadedUrls.add(sound.url);
    void preload(sound.url, { preferredForwardBufferDuration: 1 }).catch(() => preloadedUrls.delete(sound.url));
  });
}

export function playRadioCue(name: RadioCueName, config?: RadioEffectsConfig | null) {
  const sound = config?.sounds?.[name];
  if (!config?.enabled || !sound?.enabled || !sound.url || sound.preset === 'none') return;
  try {
    const player = createAudioPlayer(sound.url, { downloadFirst: true, keepAudioSessionActive: true, updateInterval: 1_000 });
    activePlayers.add(player);
    player.volume = Math.max(0, Math.min(1, Number(sound.volume) || 0));
    player.play();
    setTimeout(() => {
      activePlayers.delete(player);
      try { player.remove(); } catch {}
    }, 4_000);
  } catch (error) {
    console.warn('[VROOM_CB_CUE]', name, error);
  }
}
