import { useEffect, useRef } from 'react';
import { NativeModules } from 'react-native';

export function useCarPlayNavigationSync({
  isNavigating,
  currentStep,
  distToTurnM,
  routeInfo,
  routeSteps,
}: {
  isNavigating: boolean;
  currentStep: number;
  distToTurnM: number | null;
  routeInfo: any;
  routeSteps: any[];
}) {
  const lastSyncTime = useRef(0);

  useEffect(() => {
    if (!NativeModules.RNCarPlay || !isNavigating || !routeInfo) {
      return;
    }

    try {
      const { CarPlay } = require('react-native-carplay');
      
      if (!CarPlay.connected) return;

      const now = Date.now();
      if (now - lastSyncTime.current < 1000) return;
      lastSyncTime.current = now;

      const distanceRemaining = routeInfo.distance;
      const timeRemaining = routeInfo.duration;

      CarPlay.bridge.updateTravelEstimatesNavigationSession(
        'VroomMap',
        0,
        {
          distanceUnits: distanceRemaining >= 1000 ? 'kilometers' : 'meters',
          distanceRemaining: distanceRemaining >= 1000 ? distanceRemaining / 1000 : distanceRemaining,
          timeRemaining: timeRemaining,
        }
      );

      if (routeSteps && routeSteps.length > currentStep) {
        const step = routeSteps[currentStep];
        
        let maneuverType = 0; 
        const modifier = step?.maneuver?.modifier;
        const type = step?.maneuver?.type;

        if (modifier?.includes('left')) maneuverType = 2;
        if (modifier?.includes('right')) maneuverType = 7;
        if (modifier === 'slight left') maneuverType = 1;
        if (modifier === 'slight right') maneuverType = 8;
        if (modifier === 'sharp left') maneuverType = 3;
        if (modifier === 'sharp right') maneuverType = 6;
        if (modifier === 'uturn') maneuverType = 5;
        if (type === 'depart') maneuverType = 9;
        if (type === 'arrive') maneuverType = 39;

        CarPlay.bridge.updateManeuversNavigationSession('VroomMap', [
          {
            maneuverType,
            instructionVariants: [step?.maneuver?.instruction || 'Jedź prosto'],
            initialTravelEstimates: {
              distanceUnits: (distToTurnM || 0) >= 1000 ? 'kilometers' : 'meters',
              distanceRemaining: (distToTurnM || 0) >= 1000 ? (distToTurnM || 0) / 1000 : (distToTurnM || 0),
              timeRemaining: step.duration || 0,
            }
          }
        ]);
      }

    } catch (err) {
      console.warn('Błąd podczas synchronizacji nawigacji z CarPlay:', err);
    }
  }, [isNavigating, currentStep, distToTurnM, routeInfo, routeSteps]);
}
