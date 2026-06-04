import * as FileSystem from 'expo-file-system';
import { Platform } from 'react-native';
import { DRIVE_SESSION_TRACE_ENABLED } from './driveLogConfig';

const lastAt: Record<string, number> = {};

export type VroomGpsLogEntry = {
  t: number;
  tag: string;
  payload?: Record<string, unknown>;
};

const listeners = new Set<(entry: VroomGpsLogEntry) => void>();

const DRIVE_SESSION_LOG = 'vroom_drive_session.log';
const DRIVE_SESSION_DOC = `${FileSystem.documentDirectory}${DRIVE_SESSION_LOG}`;
const DRIVE_SESSION_DOWNLOAD = `file:///storage/emulated/0/Download/${DRIVE_SESSION_LOG}`;
const DRIVE_SESSION_MEDIA =
  `file:///storage/emulated/0/Android/media/com.lexuuw.vroom.app/${DRIVE_SESSION_LOG}`;

let fileWriteQueue: Promise<void> = Promise.resolve();
let fileMirrorErrLogged = false;

function queueDriveSessionFileLine(line: string): void {
  fileWriteQueue = fileWriteQueue
    .then(async () => {
      const paths = [DRIVE_SESSION_DOC];
      if (Platform.OS === 'android') {
        paths.push(DRIVE_SESSION_DOWNLOAD, DRIVE_SESSION_MEDIA);
      }
      for (const path of paths) {
        try {
          const info = await FileSystem.getInfoAsync(path);
          if (!info.exists && path !== DRIVE_SESSION_DOC) {
            const parent = path.slice(0, path.lastIndexOf('/'));
            try {
              await FileSystem.makeDirectoryAsync(parent, { intermediates: true });
            } catch {
              // parent may exist
            }
          }
          await FileSystem.writeAsStringAsync(path, line, {
            encoding: FileSystem.EncodingType.UTF8,
            append: info.exists,
          });
        } catch (err) {
          if (!fileMirrorErrLogged && path === DRIVE_SESSION_DOC) {
            fileMirrorErrLogged = true;
            emitVroomTelLogcatLine('DRIVE_TRACE_FILE_ERR', Date.now(), {
              path,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    })
    .catch(() => {});
}

function shouldMirrorDriveSessionFile(tag: string): boolean {
  if (!DRIVE_SESSION_TRACE_ENABLED) return false;
  if (tag.startsWith('DRIVE_TRACE_')) return true;
  if (tag === 'RAW_GPS_TICK' || tag === 'CAM_FOLLOW_PUSH') return true;
  if (tag.startsWith('NAV_TRACE_') || tag.startsWith('GPS_')) return true;
  if (tag === 'BUILD_FINGERPRINT') return true;
  return false;
}

export function subscribeVroomGpsLog(listener: (entry: VroomGpsLogEntry) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function safePayloadJson(t: number, payload: Record<string, unknown> | undefined): string {
  try {
    return JSON.stringify({ t, ...(payload ?? {}) });
  } catch {
    return JSON.stringify({ t, serializeError: true });
  }
}

/** Logcat: adb logcat -d | findstr "VROOM-TEL"  (NIE używaj nawiasów [ ] w findstr!) */
function emitVroomTelLogcatLine(tag: string, t: number, payload: Record<string, unknown> | undefined): void {
  const iso = new Date(t).toISOString();
  const json = safePayloadJson(t, payload);
  const line = `[VROOM-TEL] ${iso} | ${tag} | ${json}`;
  try {
    console.log(line);
  } catch {
    console.log(`[VROOM-TEL] ${iso} | ${tag} | {}`);
  }
  if (shouldMirrorDriveSessionFile(tag)) {
    queueDriveSessionFileLine(`${line}\n`);
  }
}

function emitVroomGpsLog(
  tag: string,
  payload: Record<string, unknown> | undefined,
  throttleMs: number,
): void {
  const now = Date.now();
  if (throttleMs > 0) {
    const last = lastAt[tag] ?? 0;
    if (now - last < throttleMs) return;
    lastAt[tag] = now;
  }
  const entry = { t: now, tag, payload };
  emitVroomTelLogcatLine(tag, now, payload);
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // Log subscribers must never break local diagnostics.
    }
  }
}

export function vroomGpsLog(
  tag: string,
  payload?: Record<string, unknown>,
  throttleMs = 1800,
): void {
  emitVroomGpsLog(tag, payload, throttleMs);
}

export function vroomGpsLogNow(
  tag: string,
  payload?: Record<string, unknown>,
): void {
  emitVroomGpsLog(tag, payload, 0);
}

/** Ping przy starcie — sprawdź: adb logcat -d | findstr DRIVE_TRACE_PING */
export function vroomGpsLogPing(source: string): void {
  vroomGpsLogNow('DRIVE_TRACE_PING', {
    source,
    traceEnabled: DRIVE_SESSION_TRACE_ENABLED,
    platform: Platform.OS,
  });
}

export const DRIVE_SESSION_LOG_ADB_PATHS = [
  `/sdcard/Download/${DRIVE_SESSION_LOG}`,
  `/sdcard/Android/media/com.lexuuw.vroom.app/${DRIVE_SESSION_LOG}`,
] as const;
