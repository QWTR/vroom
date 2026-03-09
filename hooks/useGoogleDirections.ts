import { useState, useEffect } from 'react';
import { LocationState } from '../constants/types';
import { decodePolyline } from '../scripts/polyline';

export const useGoogleDirections = (
  origin: LocationState | null,
  destination: LocationState | null,
  apiKey: string,
) => {
  const [route, setRoute] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!origin || !destination) {
      setRoute(null);
      return;
    }

    const fetchRoute = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/directions/json?` +
          `origin=${origin.latitude},${origin.longitude}&` +
          `destination=${destination.latitude},${destination.longitude}&` +
          `key=${apiKey}&mode=driving&language=pl&alternatives=false&overview=full`
        );
        const data = await res.json();

        if (data.routes?.length > 0) {
          const r = data.routes[0];
          const detailed: Array<{ latitude: number; longitude: number }> = [];
          r.legs.forEach((leg: any) =>
            leg.steps.forEach((step: any) =>
              detailed.push(...decodePolyline(step.polyline.points))
            )
          );
          const fallback = decodePolyline(r.overview_polyline.points);
          setRoute({
            points: detailed.length > 0 ? detailed : fallback,
            distance: r.legs[0].distance.text,
            distanceValue: r.legs[0].distance.value,
            duration: Math.round(r.legs[0].duration.value / 60),
            steps: r.legs[0].steps,
          });
        }
      } catch (err) {
        console.log('Directions error:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchRoute();
  }, [origin, destination, apiKey]);

  return { route, loading };
};