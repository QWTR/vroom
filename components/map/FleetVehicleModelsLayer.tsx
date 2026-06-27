import React, { memo } from 'react';
import Mapbox from '@rnmapbox/maps';
import Animated from 'react-native-reanimated';
import { buildVehicleModelLayerStyle } from '../../lib/vehicleModelMeta';

const ReanimatedShapeSource = Animated.createAnimatedComponent(Mapbox.ShapeSource);

const FLEET_MODEL_LAYER_STYLE = buildVehicleModelLayerStyle(['get', 'modelKey']);

type Props = {
  animatedShapeProps: { shape?: string };
  visible?: boolean;
  minZoomLevel?: number;
};

function FleetVehicleModelsLayerInner({
  animatedShapeProps,
  visible = true,
  minZoomLevel = 0,
}: Props) {
  if (!visible) return null;

  return (
    <ReanimatedShapeSource
      id="fleet-vehicle-models-src"
      animatedProps={animatedShapeProps as never}
    >
      <Mapbox.ModelLayer
        id="fleet-vehicle-models-layer"
        minZoomLevel={minZoomLevel}
        style={FLEET_MODEL_LAYER_STYLE}
      />
    </ReanimatedShapeSource>
  );
}

export const FleetVehicleModelsLayer = memo(FleetVehicleModelsLayerInner);
