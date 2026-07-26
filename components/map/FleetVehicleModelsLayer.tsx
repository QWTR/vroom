import React, { memo, useCallback } from 'react';
import Mapbox from '@rnmapbox/maps';
import Animated from 'react-native-reanimated';
import { buildVehicleModelLayerStyle } from '../../lib/vehicleModelMeta';
import { LIVE_VEHICLE_NAME_STYLE } from '../../lib/liveVehicleLabel';

const ReanimatedShapeSource = Animated.createAnimatedComponent(Mapbox.ShapeSource);

const FLEET_MODEL_LAYER_STYLE = buildVehicleModelLayerStyle(['get', 'modelKey']);

type Props = {
  hotAnimatedShapeProps: { shape?: string };
  coldAnimatedShapeProps: { shape?: string };
  visible?: boolean;
  minZoomLevel?: number;
  onUserPress: (userId: number) => void;
};

function FleetVehicleModelsLayerInner({
  hotAnimatedShapeProps,
  coldAnimatedShapeProps,
  visible = true,
  minZoomLevel = 0,
  onUserPress,
}: Props) {
  const handlePress = useCallback((event: any) => {
    const userId = Number(event.features?.[0]?.properties?.id);
    if (Number.isFinite(userId)) onUserPress(userId);
  }, [onUserPress]);

  if (!visible) return null;

  return (
    <>
      <ReanimatedShapeSource
        id="fleet-hot-vehicle-models-src"
        animatedProps={hotAnimatedShapeProps as never}
        onPress={handlePress}
        hitbox={{ width: 76, height: 76 }}
      >
        <Mapbox.ModelLayer
          id="fleet-hot-vehicle-models-layer"
          minZoomLevel={minZoomLevel}
          style={FLEET_MODEL_LAYER_STYLE}
        />
        <Mapbox.SymbolLayer
          id="fleet-hot-vehicle-names"
          minZoomLevel={minZoomLevel}
          style={LIVE_VEHICLE_NAME_STYLE as never}
        />
      </ReanimatedShapeSource>
      <ReanimatedShapeSource
        id="fleet-cold-vehicle-models-src"
        animatedProps={coldAnimatedShapeProps as never}
        onPress={handlePress}
        hitbox={{ width: 76, height: 76 }}
      >
        <Mapbox.ModelLayer
          id="fleet-cold-vehicle-models-layer"
          minZoomLevel={minZoomLevel}
          style={FLEET_MODEL_LAYER_STYLE}
        />
        <Mapbox.SymbolLayer
          id="fleet-cold-vehicle-names"
          minZoomLevel={minZoomLevel}
          style={LIVE_VEHICLE_NAME_STYLE as never}
        />
      </ReanimatedShapeSource>
    </>
  );
}

export const FleetVehicleModelsLayer = memo(FleetVehicleModelsLayerInner);
