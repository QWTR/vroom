import { apiRequest } from './api/client';

export type LiveLocationPacket = {
  lat?: number;
  lng?: number;
  rawLat?: number;
  rawLng?: number;
  accuracyM?: number | null;
  heading?: number | null;
  speedMps?: number | null;
  shareLocation?: boolean;
  fixAt?: number;
  fixId?: string;
  fixAgeMs?: number;
  source?: string;
  protocolVersion?: number;
  [key: string]: unknown;
};

type AcceptedPacket = LiveLocationPacket & { sentAt: number; clientSequence: number };

let lastAccepted: AcceptedPacket | null = null;
let lastSequence = Date.now() * 1000;
let inFlight: Promise<unknown> | null = null;
let pending: { packet: LiveLocationPacket; force: boolean } | null = null;

function distanceMeters(a: LiveLocationPacket, b: LiveLocationPacket): number {
  if (![a.lat, a.lng, b.lat, b.lng].every(Number.isFinite)) return Number.POSITIVE_INFINITY;
  const rad = Math.PI / 180;
  const dLat = (Number(b.lat) - Number(a.lat)) * rad;
  const dLng = (Number(b.lng) - Number(a.lng)) * rad;
  const x = Math.sin(dLat / 2) ** 2
    + Math.cos(Number(a.lat) * rad) * Math.cos(Number(b.lat) * rad) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function headingDelta(a?: number | null, b?: number | null): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const delta = Math.abs(Number(a) - Number(b)) % 360;
  return Math.min(delta, 360 - delta);
}

function motionTier(speed?: number | null): 'idle' | 'moving' {
  return Number(speed) >= 1 ? 'moving' : 'idle';
}

function significant(packet: LiveLocationPacket, force: boolean): boolean {
  if (force || !lastAccepted) return true;
  if (packet.shareLocation !== undefined && packet.shareLocation !== lastAccepted.shareLocation) return true;
  if (packet.shareLocation === false && packet.lat == null) return false;
  const now = Date.now();
  const tier = motionTier(packet.speedMps);
  const heartbeatMs = tier === 'moving' ? 20_000 : 25_000;
  if (now - lastAccepted.sentAt >= heartbeatMs) return true;
  if (packet.fixId && packet.fixId === lastAccepted.fixId) return false;
  const minimumDistance = tier === 'moving' ? 12 : 25;
  if (distanceMeters(lastAccepted, packet) >= minimumDistance) return true;
  if (motionTier(lastAccepted.speedMps) !== tier) return true;
  return headingDelta(lastAccepted.heading, packet.heading) >= 18;
}

export function prepareLiveLocationPacket(
  input: LiveLocationPacket,
  options: { force?: boolean } = {},
): (LiveLocationPacket & { clientSequence: number }) | null {
  const packet = { protocolVersion: 2, ...input };
  if (!significant(packet, Boolean(options.force))) return null;
  lastSequence = Math.max(lastSequence + 1, Date.now() * 1000);
  const accepted = { ...packet, clientSequence: lastSequence };
  lastAccepted = { ...accepted, sentAt: Date.now() };
  return accepted;
}

async function flush(packet: LiveLocationPacket, force: boolean): Promise<unknown> {
  const prepared = prepareLiveLocationPacket(packet, { force });
  if (!prepared) return { accepted: false, reason: 'client_deduplicated' };
  return apiRequest('/live/location', {
    method: 'POST',
    body: prepared,
    priority: 'critical',
    timeoutMs: 5_000,
  });
}

export function sendLiveLocation(input: LiveLocationPacket, options: { force?: boolean } = {}): Promise<unknown> {
  if (inFlight) {
    pending = { packet: input, force: Boolean(options.force) };
    return inFlight;
  }
  inFlight = flush(input, Boolean(options.force)).finally(async () => {
    inFlight = null;
    const next = pending;
    pending = null;
    if (next) await sendLiveLocation(next.packet, { force: next.force });
  });
  return inFlight;
}

export function resetLiveLocationBroker(): void {
  lastAccepted = null;
  pending = null;
}
