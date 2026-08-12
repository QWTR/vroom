import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { InventoryScreen } from '../../components/inventory/InventoryScreen';

export default function InventoryRoute() {
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  return <InventoryScreen userId={typeof userId === 'string' && userId ? userId : undefined} />;
}
