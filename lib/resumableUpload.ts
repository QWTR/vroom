import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { API_URL } from '../constants/config';
import { apiRequest } from './api/client';
import { getAuthTokenCached } from './api/authTokenMemory';

type UploadSession = { uploadId: string; assetId: string; offset: number; chunkSize: number; expiresAt: string };
type UploadedEntity = { id: string; status: string; url: string };
type UploadComplete = { status: 'accepted' | 'completed'; jobId?: string; entity: UploadedEntity };
type UploadJob = {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress?: number;
  result?: { asset?: UploadedEntity } | null;
  error?: string | null;
};

const STORAGE_PREFIX = '@vroom/resumable-upload:v1:';

function storageKey(uri: string, size: number): string {
  let hash = 2166136261;
  const source = `${uri}:${size}`;
  for (let i = 0; i < source.length; i += 1) hash = Math.imul(hash ^ source.charCodeAt(i), 16777619);
  return `${STORAGE_PREFIX}${(hash >>> 0).toString(16)}`;
}

function decodeBase64(value: string): Uint8Array {
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function waitForFinalizedUpload(jobId: string): Promise<UploadedEntity> {
  const deadline = Date.now() + 2 * 60_000;
  while (Date.now() < deadline) {
    const job = await apiRequest<UploadJob>(`/v2/jobs/${encodeURIComponent(jobId)}`, {
      priority: 'background',
    });
    if (job.status === 'completed' && job.result?.asset) return job.result.asset;
    if (job.status === 'failed') throw new Error(job.error || 'Serwer nie zakończył przygotowania pliku');
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error('Przygotowanie pliku trwa zbyt długo — można je wznowić');
}

async function remoteOffset(uploadId: string): Promise<number | null> {
  const token = await getAuthTokenCached();
  if (!token) throw new Error('Brak aktywnej sesji');
  const response = await fetch(`${API_URL}/api/v2/media/uploads/${uploadId}`, {
    method: 'HEAD', headers: { Authorization: `Bearer ${token}` },
  });
  if (response.status === 404 || response.status === 409) return null;
  if (!response.ok) throw new Error(`Nie udało się wznowić uploadu (${response.status})`);
  return Number(response.headers.get('Upload-Offset')) || 0;
}

export async function uploadFileResumable(input: {
  uri: string;
  fileName: string;
  mimeType: string;
  onProgress?: (progress: number) => void;
}): Promise<UploadComplete['entity']> {
  const info = await FileSystem.getInfoAsync(input.uri, { size: true } as any);
  const size = Number((info as any)?.size || 0);
  if (!info.exists || !size) throw new Error('Nie znaleziono pliku do wysłania');
  const key = storageKey(input.uri, size);
  const operationStorageKey = `${key}:operation`;
  let session: UploadSession | null = null;
  const stored = await AsyncStorage.getItem(key);
  if (stored) {
    try { session = JSON.parse(stored); } catch { session = null; }
  }
  if (session) {
    const offset = await remoteOffset(session.uploadId).catch(() => null);
    if (offset == null) session = null;
    else session.offset = offset;
  }
  if (!session) {
    let uploadOperationId = await AsyncStorage.getItem(operationStorageKey);
    if (!uploadOperationId) {
      uploadOperationId = `upload-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      await AsyncStorage.setItem(operationStorageKey, uploadOperationId);
    }
    session = await apiRequest<UploadSession>('/v2/media/uploads', {
      method: 'POST',
      body: { fileName: input.fileName, mimeType: input.mimeType, sizeBytes: size },
      idempotencyKey: uploadOperationId,
      priority: 'mutation',
    });
    await AsyncStorage.setItem(key, JSON.stringify(session));
  }
  const token = await getAuthTokenCached();
  if (!token) throw new Error('Brak aktywnej sesji');
  let offset = session.offset;
  while (offset < size) {
    const length = Math.min(session.chunkSize, size - offset);
    const encoded = await FileSystem.readAsStringAsync(input.uri, {
      encoding: FileSystem.EncodingType.Base64,
      position: offset,
      length,
    });
    const response = await fetch(`${API_URL}/api/v2/media/uploads/${session.uploadId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': String(offset),
      },
      body: decodeBase64(encoded) as any,
    });
    if (response.status === 409) {
      const corrected = Number(response.headers.get('Upload-Offset'));
      if (!Number.isSafeInteger(corrected)) throw new Error('Serwer odrzucił offset uploadu');
      offset = corrected;
      continue;
    }
    if (!response.ok) throw new Error(`Wysyłanie pliku przerwane (${response.status})`);
    offset = Number(response.headers.get('Upload-Offset')) || offset + length;
    session.offset = offset;
    await AsyncStorage.setItem(key, JSON.stringify(session));
    input.onProgress?.(Math.min(1, offset / size));
  }
  const completed = await apiRequest<UploadComplete>(`/v2/media/uploads/${session.uploadId}/complete`, {
    method: 'POST',
    idempotencyKey: session.uploadId,
    priority: 'mutation',
  });
  const entity = completed.status === 'accepted' && completed.jobId
    ? await waitForFinalizedUpload(completed.jobId)
    : completed.entity;
  await AsyncStorage.multiRemove([key, operationStorageKey]);
  return entity;
}
