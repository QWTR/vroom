export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    const raw = path || '';
    const vroomkiSoundApp = raw.match(/vroom:\/\/vroomki\/sound\?id=(\d+)/i);
    if (vroomkiSoundApp) {
      return `/Community/vroomki/sound/${vroomkiSoundApp[1]}`;
    }
    const vroomkiApp = raw.match(/vroom:\/\/vroomki\?id=(\d+)/i);
    if (vroomkiApp) {
      return `/Community/vroomki?vroomkiId=${vroomkiApp[1]}`;
    }
    const vroomkiSoundWeb = raw.match(/v-room\.app\/vroomki\/sound\/(\d+)/i);
    if (vroomkiSoundWeb) {
      return `/Community/vroomki/sound/${vroomkiSoundWeb[1]}`;
    }
    const vroomkiWeb = raw.match(/v-room\.app\/vroomki\/(\d+)/i);
    if (vroomkiWeb) {
      return `/Community/vroomki?vroomkiId=${vroomkiWeb[1]}`;
    }
    const vroomkiPath = raw.match(/\/vroomki\/(\d+)/i);
    if (vroomkiPath) {
      return `/Community/vroomki?vroomkiId=${vroomkiPath[1]}`;
    }
  } catch {
    // fall through
  }
  return path;
}
