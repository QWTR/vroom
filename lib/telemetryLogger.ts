import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';

const TELEMETRY_FILE_NAME = 'vroom_telemetry.log';
const TELEMETRY_FILE_PATH = `${FileSystem.documentDirectory}${TELEMETRY_FILE_NAME}`;
const ANDROID_PUBLIC_TELEMETRY_PATH = 'file:///storage/emulated/0/Download/vroom_telemetry.log';
const ANDROID_APP_MEDIA_TELEMETRY_PATH = 'file:///storage/emulated/0/Android/media/com.lexuuw.vroom.app/vroom_telemetry.log';

let writeQueue: Promise<void> = Promise.resolve();

function safeJson(data: unknown): string {
  try {
    return JSON.stringify(data ?? {});
  } catch {
    return JSON.stringify({ serializeError: true });
  }
}

export function getTelemetryPath(): string {
  return TELEMETRY_FILE_PATH;
}

export function logTelemetry(tag: string, data?: unknown): Promise<void> {
  const ts = new Date().toISOString();
  const json = safeJson(data);
  const line = `${ts} | ${tag} | ${json}\n`;
  // Fallback channel for release builds: readable later via adb logcat -d
  try {
    console.log(`[VROOM-TEL] ${ts} | ${tag} | ${json}`);
  } catch {
    // no-op
  }
  writeQueue = writeQueue
    .then(async () => {
      await FileSystem.writeAsStringAsync(TELEMETRY_FILE_PATH, line, {
        encoding: FileSystem.EncodingType.UTF8,
        append: true,
      });
      if (Platform.OS === 'android') {
        // Best-effort mirror for ADB pull on non-debuggable builds.
        await FileSystem.writeAsStringAsync(ANDROID_PUBLIC_TELEMETRY_PATH, line, {
          encoding: FileSystem.EncodingType.UTF8,
          append: true,
        }).catch(() => {});
        await FileSystem.writeAsStringAsync(ANDROID_APP_MEDIA_TELEMETRY_PATH, line, {
          encoding: FileSystem.EncodingType.UTF8,
          append: true,
        }).catch(() => {});
      }
    })
    .catch(() => {
      // Intentionally ignore telemetry failures.
    });
  return writeQueue;
}

export async function clearTelemetry(): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(
      TELEMETRY_FILE_PATH,
      `=== TELEMETRY SESSION START ${new Date().toISOString()} ===\n`,
      { encoding: FileSystem.EncodingType.UTF8 },
    );
  } catch {
    // Intentionally ignore telemetry failures.
  }
  if (Platform.OS === 'android') {
    await FileSystem.writeAsStringAsync(
      ANDROID_PUBLIC_TELEMETRY_PATH,
      `=== TELEMETRY SESSION START ${new Date().toISOString()} ===\n`,
      { encoding: FileSystem.EncodingType.UTF8 },
    ).catch(() => {});
    await FileSystem.writeAsStringAsync(
      ANDROID_APP_MEDIA_TELEMETRY_PATH,
      `=== TELEMETRY SESSION START ${new Date().toISOString()} ===\n`,
      { encoding: FileSystem.EncodingType.UTF8 },
    ).catch(() => {});
  }
}
