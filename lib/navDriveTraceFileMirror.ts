/**
 * Lustrzany zapis logów jazdy na dysk telefonu (bez kabla).
 * Po jeździe: podłącz USB → scripts/adb-pull-nav-logs.ps1
 *
 * Ścieżki adb pull (Android):
 *   /sdcard/Download/vroom_nav_drive.log
 *   /sdcard/Android/media/com.lexuuw.vroom.app/vroom_nav_drive.log
 */
import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import type { VroomGpsLogEntry } from './vroomGpsLog';

export const NAV_TRACE_FILE_NAME = 'vroom_nav_drive.log';

/** Ścieżki do `adb pull` (bez run-as, release OK). */
export const NAV_TRACE_ADB_PULL_PATHS = [
  `/sdcard/Download/${NAV_TRACE_FILE_NAME}`,
  `/sdcard/Android/media/com.lexuuw.vroom.app/${NAV_TRACE_FILE_NAME}`,
] as const;

const DOC_PATH = `${FileSystem.documentDirectory}${NAV_TRACE_FILE_NAME}`;
const ANDROID_DOWNLOAD = `file:///storage/emulated/0/Download/${NAV_TRACE_FILE_NAME}`;
const ANDROID_MEDIA =
  `file:///storage/emulated/0/Android/media/com.lexuuw.vroom.app/${NAV_TRACE_FILE_NAME}`;

let writeQueue: Promise<void> = Promise.resolve();

function formatEntry(e: VroomGpsLogEntry): string {
  const iso = new Date(e.t).toISOString();
  let pl = '{}';
  try {
    pl = JSON.stringify(e.payload ?? {});
  } catch {
    pl = '{"serializeError":true}';
  }
  return `${iso} [${e.tag}] ${pl}\n`;
}

function mirrorTargets(): string[] {
  const paths = [DOC_PATH];
  if (Platform.OS === 'android') {
    paths.push(ANDROID_DOWNLOAD, ANDROID_MEDIA);
  }
  return paths;
}

async function appendLineToPath(path: string, line: string): Promise<void> {
  await FileSystem.writeAsStringAsync(path, line, {
    encoding: FileSystem.EncodingType.UTF8,
    append: true,
  });
}

function queueMirrorWrite(line: string): void {
  writeQueue = writeQueue
    .then(async () => {
      for (const path of mirrorTargets()) {
        try {
          await appendLineToPath(path, line);
        } catch {
          // Best-effort — Download/media mogą wymagać uprawnień na starszych API.
        }
      }
    })
    .catch(() => {});
}

export function mirrorNavTraceEntries(entries: VroomGpsLogEntry[]): void {
  if (entries.length === 0) return;
  const chunk = entries.map(formatEntry).join('');
  queueMirrorWrite(chunk);
}

export function mirrorNavTraceLine(tag: string, payload?: Record<string, unknown>): void {
  mirrorNavTraceEntries([{ t: Date.now(), tag, payload }]);
}

async function writeHeaderToAll(header: string): Promise<void> {
  for (const path of mirrorTargets()) {
    try {
      await FileSystem.writeAsStringAsync(path, header, {
        encoding: FileSystem.EncodingType.UTF8,
      });
    } catch {
      // ignore
    }
  }
}

/** Nowa sesja jazdy — czyści pliki mirror (SQLite zostaje). */
export async function resetNavTraceMirrorForDrivingStart(extra?: Record<string, unknown>): Promise<void> {
  const header = [
    '=== VROOM NAV DRIVE LOG (ADB pull) ===',
    `sessionStart: ${new Date().toISOString()}`,
    `platform: ${Platform.OS}`,
    extra ? `meta: ${JSON.stringify(extra)}` : '',
    '===',
    '',
  ]
    .filter(Boolean)
    .join('\n');
  await writeQueue;
  writeQueue = Promise.resolve();
  await writeHeaderToAll(`${header}\n`);
}

export async function finalizeNavTraceMirrorOnDrivingEnd(extra?: Record<string, unknown>): Promise<void> {
  mirrorNavTraceLine('NAV_TRACE_SESSION', {
    event: 'driving_end_mirror',
    at: Date.now(),
    ...extra,
  });
  await writeQueue;
}
