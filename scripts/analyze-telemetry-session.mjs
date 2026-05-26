#!/usr/bin/env node
/**
 * Analyze map telemetry JSONL for Gemini reports.
 * Usage: node scripts/analyze-telemetry-session.mjs <path-to.jsonl>
 */
import fs from 'fs';
import readline from 'readline';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node analyze-telemetry-session.mjs <file.jsonl>');
  process.exit(1);
}

const stats = {
  total: 0,
  platforms: {},
  driveTags: {},
  speedPipe: [],
  speedEmitSpike: [],
  speedUnderReport: [],
  speedAbruptGhost: [],
  speedHold: [],
  workletFeed: [],
  workletInstant: [],
  workletBigJump: [],
  snapFail: [],
  markerHeartbeatStuck: [],
  v10Instant: [],
  v10Cruise: [],
  v10Chase: [],
  stallRecovery: [],
  dtMsHigh: [],
};

function getTag(row) {
  if (row.type === 'drive_log') return row.payload?.tag ?? row.payload?.data?.tag;
  return row.type;
}

function getData(row) {
  if (row.type === 'drive_log') return row.payload?.data ?? row.payload ?? {};
  return row.payload ?? {};
}

function pushLimited(arr, item, max = 5000) {
  if (arr.length < max) arr.push(item);
}

const rl = readline.createInterface({
  input: fs.createReadStream(file, { encoding: 'utf8' }),
  crlfDelay: true,
});

for await (const line of rl) {
  if (!line.trim()) continue;
  let row;
  try {
    row = JSON.parse(line);
  } catch {
    continue;
  }
  stats.total++;
  const plat = row.payload?.platform ?? row.platform ?? 'unknown';
  stats.platforms[plat] = (stats.platforms[plat] || 0) + 1;

  const tag = getTag(row);
  const data = getData(row);
  const at = row.clientAt ?? row.serverAt ?? '';
  const isDriving = row.payload?.isDriving ?? data?.isDriving;

  if (row.type === 'drive_log' && tag) {
    stats.driveTags[tag] = (stats.driveTags[tag] || 0) + 1;
  }

  if (tag === 'SPEED_PIPE') {
    const e = {
      at,
      rawGpsKmh: data.rawGpsKmh,
      sanitizedKmh: data.sanitizedKmh,
      motionKmh: data.motionKmh,
      sustainedKmh: data.sustainedKmh,
      netMoveM: data.netMoveM,
      dtMs: data.dtMs,
      holdActive: data.holdActive,
      isDriving,
    };
    pushLimited(stats.speedPipe, e);
    if (
      data.rawGpsKmh != null && data.rawGpsKmh >= 15
      && (data.sanitizedKmh === 0 || data.sanitizedKmh == null)
    ) {
      pushLimited(stats.speedPipe, { ...e, anomaly: 'raw_high_sanitized_zero' });
    }
    if (data.dtMs >= 2000) pushLimited(stats.dtMsHigh, e);
  }

  if (tag === 'SPEED_EMIT_SPIKE_BLOCK') {
    pushLimited(stats.speedEmitSpike, { at, ...data });
  }
  if (tag === 'SPEED_ABRUPT_GHOST_REJECT') {
    pushLimited(stats.speedAbruptGhost, { at, ...data });
  }
  if (tag === 'SPEED_UNDER_REPORT') {
    pushLimited(stats.speedUnderReport, { at, ...data });
  }
  if (tag === 'SPEED_HOLD_DOPPLER_OVERRIDE' || tag === 'SPEED_HOLD_MOTION_OVERRIDE') {
    pushLimited(stats.speedHold, { at, tag, ...data });
  }

  if (tag === 'WORKLET_FEED') {
    const e = {
      at,
      source: data.source,
      lat: data.lat,
      lng: data.lng,
      durationMs: data.durationMs,
      speedMs: data.speedMs,
      movedFromLastM: data.movedFromLastM,
      dtSinceLastMs: data.dtSinceLastMs,
      hasHandler: data.hasHandler,
    };
    pushLimited(stats.workletFeed, e);
    if (data.durationMs === 0) pushLimited(stats.workletInstant, e);
    if (data.movedFromLastM != null && data.movedFromLastM >= 12) {
      pushLimited(stats.workletBigJump, e);
    }
    if (data.source?.includes('instant')) pushLimited(stats.v10Instant, e);
    if (data.source === 'v10_live_cruise') stats.v10Cruise.push(e);
    if (data.source?.includes('chase')) pushLimited(stats.v10Chase, e);
  }

  if (tag === 'SNAP_FAIL_HELD_ANCHOR') {
    pushLimited(stats.snapFail, { at, ...data });
  }

  if (tag === 'MARKER_HEARTBEAT' && data.stuck === true) {
    pushLimited(stats.markerHeartbeatStuck, {
      at,
      stuckMs: data.stuckMs,
      lat: data.lat,
      lng: data.lng,
    });
  }

  if (tag?.includes('STALL') || tag === 'WORKLET_STALL' || tag === 'MARKER_STUCK_RECOVERY') {
    pushLimited(stats.stallRecovery, { at, tag, ...data });
  }
}

// Dedupe speed anomalies
const speedAnomalies = stats.speedPipe.filter((e) => e.anomaly === 'raw_high_sanitized_zero');

function summarize(arr, key) {
  return arr.slice(0, 8);
}

function countBy(arr, fn) {
  const m = {};
  for (const x of arr) {
    const k = fn(x);
    m[k] = (m[k] || 0) + 1;
  }
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

function stuckSpans(stuckEvents) {
  if (!stuckEvents.length) return [];
  return stuckEvents.map((e) => ({ at: e.at, stuckMs: e.stuckMs }));
}

const speedZeroWhileMoving = stats.speedPipe.filter(
  (e) => !e.anomaly && e.rawGpsKmh >= 15 && e.sanitizedKmh === 0,
);

const driveLogCount = Object.values(stats.driveTags).reduce((a, b) => a + b, 0);
const drivingGpsFix = stats.total > 0 ? stats.total : 0; // rough; gps_fix counted in total only
const sessionQuality =
  driveLogCount < 20
    ? 'UNUSABLE — brak drive_log (WORKLET_FEED, MARKER_*, SPEED_*). Eksportuj PO jeździe z włączoną jazdą; plik musi mieć tysiące linii.'
    : driveLogCount < 200
      ? 'WEAK — mało zdarzeń, diagnoza ograniczona'
      : 'OK';

const report = {
  file,
  totalLines: stats.total,
  sessionQuality,
  driveLogEventCount: driveLogCount,
  platforms: stats.platforms,
  topDriveTags: Object.entries(stats.driveTags).sort((a, b) => b[1] - a[1]).slice(0, 35),
  speed: {
    speedPipeCount: stats.speedPipe.length,
    rawHighSanitizedZero: speedZeroWhileMoving.length,
    sampleZeroWhileMoving: speedZeroWhileMoving.slice(0, 12),
    speedEmitSpikeBlockCount: stats.speedEmitSpike.length,
    spikeReasons: countBy(stats.speedEmitSpike, (e) => e.reason ?? 'unknown'),
    sampleSpikeBlocks: summarize(stats.speedEmitSpike),
    speedAbruptGhostCount: stats.speedAbruptGhost.length,
    sampleAbruptGhost: summarize(stats.speedAbruptGhost),
    speedUnderReportCount: stats.speedUnderReport.length,
    holdOverrideCount: stats.speedHold.length,
    dtMsOver2sCount: stats.dtMsHigh.length,
    sampleDtMsHigh: summarize(stats.dtMsHigh),
    holdActiveWithZero: stats.speedPipe.filter((e) => e.holdActive && e.sanitizedKmh === 0 && e.rawGpsKmh >= 15).length,
  },
  worklet: {
    feedCount: stats.workletFeed.length,
    durationMsZeroCount: stats.workletInstant.length,
    movedFromLastM12PlusCount: stats.workletBigJump.length,
    sourceBreakdown: countBy(stats.workletFeed, (e) => e.source ?? 'unknown').slice(0, 15),
    sampleBigJumps: stats.workletBigJump.slice(0, 15),
    sampleInstant: stats.workletInstant.slice(0, 12),
    instantSourceBreakdown: countBy(stats.workletInstant, (e) => e.source ?? 'unknown'),
  },
  snap: {
    snapFailHeldCount: stats.snapFail.length,
    sampleSnapFail: stats.snapFail.slice(0, 12),
    roadPts2: stats.snapFail.filter((e) => e.roadPts === 2).length,
  },
  marker: {
    stuckHeartbeatCount: stats.markerHeartbeatStuck.length,
    stuckSpans: stuckSpans(stats.markerHeartbeatStuck),
    maxStuckMs: Math.max(0, ...stats.markerHeartbeatStuck.map((e) => e.stuckMs ?? 0)),
  },
  stall: {
    count: stats.stallRecovery.length,
    tags: countBy(stats.stallRecovery, (e) => e.tag),
    samples: stats.stallRecovery.slice(0, 10),
  },
};

console.log(JSON.stringify(report, null, 2));
