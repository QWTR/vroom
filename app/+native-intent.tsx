export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }) {
  try {
    const raw = path || '';
    const vroomkiApp = raw.match(/vroom:\/\/vroomki\?id=(\d+)/i);
    if (vroomkiApp) {
      return `/Community/vroomki?vroomkiId=${vroomkiApp[1]}`;
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
