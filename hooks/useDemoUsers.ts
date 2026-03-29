import { useEffect, useRef, useCallback } from 'react';
import { User } from '../constants/types';

const ROUTE_TEMPLATES: Array<{
  id:      string;
  name:    string;
  avatar:  string;
  speed:   number;
  offsets: Array<{ dlat: number; dlng: number }>;
}> = [
  {
    id: 'demo_1', name: 'Marek', avatar: '🚗', speed: 45,
    offsets: [
      { dlat:  0.003, dlng:  0.002 },
      { dlat:  0.005, dlng:  0.005 },
      { dlat:  0.007, dlng:  0.003 },
      { dlat:  0.006, dlng: -0.001 },
      { dlat:  0.004, dlng: -0.003 },
      { dlat:  0.002, dlng: -0.001 },
      { dlat:  0.003, dlng:  0.002 },
    ],
  },
  {
    id: 'demo_2', name: 'Kasia', avatar: '🚙', speed: 32,
    offsets: [
      { dlat: -0.002, dlng:  0.004 },
      { dlat: -0.001, dlng:  0.007 },
      { dlat:  0.001, dlng:  0.008 },
      { dlat:  0.002, dlng:  0.006 },
      { dlat:  0.001, dlng:  0.003 },
      { dlat: -0.001, dlng:  0.002 },
      { dlat: -0.002, dlng:  0.004 },
    ],
  },
  {
    id: 'demo_3', name: 'Tomek', avatar: '🏎️', speed: 58,
    offsets: [
      { dlat:  0.006, dlng: -0.004 },
      { dlat:  0.008, dlng: -0.002 },
      { dlat:  0.010, dlng:  0.001 },
      { dlat:  0.009, dlng:  0.004 },
      { dlat:  0.007, dlng:  0.005 },
      { dlat:  0.005, dlng:  0.002 },
      { dlat:  0.006, dlng: -0.004 },
    ],
  },
  {
    id: 'demo_4', name: 'Ania', avatar: '🚕', speed: 28,
    offsets: [
      { dlat: -0.004, dlng: -0.003 },
      { dlat: -0.003, dlng: -0.001 },
      { dlat: -0.001, dlng:  0.001 },
      { dlat: -0.002, dlng:  0.003 },
      { dlat: -0.004, dlng:  0.002 },
      { dlat: -0.005, dlng: -0.001 },
      { dlat: -0.004, dlng: -0.003 },
    ],
  },
  {
    id: 'demo_5', name: 'Piotrek', avatar: '🚐', speed: 40,
    offsets: [
      { dlat:  0.001, dlng: -0.006 },
      { dlat:  0.003, dlng: -0.008 },
      { dlat:  0.005, dlng: -0.007 },
      { dlat:  0.006, dlng: -0.005 },
      { dlat:  0.004, dlng: -0.003 },
      { dlat:  0.002, dlng: -0.004 },
      { dlat:  0.001, dlng: -0.006 },
    ],
  },
];

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R    = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a    =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface DemoUserState {
  segmentIndex:    number;
  segmentProgress: number;
}

function buildRoutes(userLat: number, userLng: number) {
  return ROUTE_TEMPLATES.map(t => ({
    id:     t.id,
    name:   t.name,
    avatar: t.avatar,
    speed:  t.speed,
    points: t.offsets.map(o => ({
      latitude:  userLat + o.dlat,
      longitude: userLng + o.dlng,
    })),
  }));
}

export function useDemoUsers(
  enabled:  boolean,
  onUpdate: (users: User[]) => void,
  userLat?: number,
  userLng?: number,
  tickMs    = 100,
) {
  const onUpdateRef = useRef(onUpdate);
  useEffect(() => { onUpdateRef.current = onUpdate; }, [onUpdate]);

  const routesRef = useRef(buildRoutes(userLat ?? 0, userLng ?? 0));
  const statesRef = useRef<DemoUserState[]>(
    ROUTE_TEMPLATES.map((_, i) => ({
      segmentIndex:    i % 5,
      segmentProgress: i * 0.17,
    })),
  );
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // ── FIX: natychmiastowe czyszczenie gdy disabled ──────────
  useEffect(() => {
    if (!enabled) {
      stop();
      // Wyczyść natychmiast — nie czekaj na tick
      onUpdateRef.current([]);
      return;
    }

    if (userLat == null || userLng == null) return;

    routesRef.current = buildRoutes(userLat, userLng);
    statesRef.current = ROUTE_TEMPLATES.map((_, i) => ({
      segmentIndex:    i % (ROUTE_TEMPLATES[0].offsets.length - 1),
      segmentProgress: (i * 0.19) % 1,
    }));

    timerRef.current = setInterval(() => {
      const routes = routesRef.current;
      const states = statesRef.current;
      const dtS    = tickMs / 1000;

      const users: User[] = routes.map((route, i) => {
        const state  = states[i];
        const points = route.points;
        const maxSeg = points.length - 1;

        const segA = points[state.segmentIndex];
        const segB = points[(state.segmentIndex + 1) % points.length];

        const segLenM      = haversineM(segA.latitude, segA.longitude, segB.latitude, segB.longitude);
        const speedMs      = (route.speed * 1000) / 3600;
        const progressStep = segLenM > 0 ? (speedMs * dtS) / segLenM : 0.01;

        state.segmentProgress += progressStep;
        if (state.segmentProgress >= 1) {
          state.segmentProgress -= 1;
          state.segmentIndex     = (state.segmentIndex + 1) % maxSeg;
        }

        const curA = points[state.segmentIndex];
        const curB = points[(state.segmentIndex + 1) % points.length];

        return {
          id:        route.id,
          name:      route.name,
          avatar:    route.avatar,
          latitude:  lerp(curA.latitude,  curB.latitude,  state.segmentProgress),
          longitude: lerp(curA.longitude, curB.longitude, state.segmentProgress),
          status:    'Online',
          isFriend:  false,
        };
      });

      onUpdateRef.current(users);
    }, tickMs);

    return stop;
  }, [enabled, userLat, userLng, tickMs, stop]);

  useEffect(() => () => stop(), [stop]);
}