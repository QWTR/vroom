import React, { memo } from 'react';
import Mapbox from '@rnmapbox/maps';
import Animated from 'react-native-reanimated';
import { buildVehicleModelLayerStyle } from '../../lib/vehicleModelMeta';

const ReanimatedShapeSource = Animated.createAnimatedComponent(Mapbox.ShapeSource);

const FLEET_MODEL_LAYER_STYLE = buildVehicleModelLayerStyle(['get', 'modelKey']);

type Props = {
  animatedShapeProps: { shape?: string };
  visible?: boolean;
};

function FleetVehicleModelsLayerInner({
  animatedShapeProps,
  visible = true,
}: Props) {
  if (!visible) return null;

  return (
    <ReanimatedShapeSource
      id="fleet-vehicle-models-src"
      animatedProps={animatedShapeProps}
    >
      <Mapbox.ModelLayer
        id="fleet-vehicle-models-layer"
        minZoomLevel={10}
        style={FLEET_MODEL_LAYER_STYLE}
      />
    </ReanimatedShapeSource>
  );
}

export const FleetVehicleModelsLayer = memo(FleetVehicleModelsLayerInner);
