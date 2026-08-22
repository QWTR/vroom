import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Car } from '../constants/profile';
import { apiRequest } from '../lib/api/client';
import { queryClient } from '../lib/query/client';

export function useCars() {
  const [cars, setCars]       = useState<Car[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

      const fetchCars = useCallback(async (userId?: number) => {
      setLoading(true);
      setError(null);
      try {
        let targetId = Number(userId);
        if (!Number.isInteger(targetId) || targetId <= 0) {
          const localRaw = await AsyncStorage.getItem('user');
          const local = localRaw ? JSON.parse(localRaw) : null;
          targetId = Number(local?.userId ?? local?.id);
        }
        if (!Number.isInteger(targetId) || targetId <= 0) throw new Error('Brak userId');
        const data = await queryClient.fetchQuery({
          queryKey: ['profile', targetId, 'cars'],
          queryFn: ({ signal }) => apiRequest<{ items?: Car[] }>(`/v2/profiles/${targetId}/cars?limit=30`, { signal }),
          staleTime: 30_000,
        });
        setCars(data.items ?? []);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }, []);

  const addCar = useCallback(async (data: {
    brand: string;
    specs: string;
    isMain: boolean;
    photos: { uri: string; name: string; type: string }[];
  }) => {
    setLoading(true);
    setError(null);
    try {
      const form  = new FormData();
      form.append('brand',  data.brand);
      form.append('specs',  data.specs);
      form.append('isMain', String(data.isMain));
      data.photos.forEach(photo => {
        form.append('photos', { uri: photo.uri, name: photo.name, type: photo.type } as any);
      });

      const newCar = await apiRequest<Car>('/profile/cars', {
        method:  'POST',
        body: form,
      });
      setCars(prev => [...prev, newCar]);
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteCar = useCallback(async (carId: number) => {
    setLoading(true);
    setError(null);
    try {
      await apiRequest(`/profile/cars/${carId}`, { method: 'DELETE' });
      setCars(prev => prev.filter(c => c.id !== carId));
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const setMainCar = useCallback(async (carId: number) => {
    setLoading(true);
    setError(null);
    try {
      await apiRequest(`/profile/cars/${carId}/main`, { method: 'PATCH' });
      setCars(prev => prev.map(c => ({ ...c, isMain: c.id === carId })));
      await queryClient.invalidateQueries({ queryKey: ['profile'] });
      return true;
    } catch (e: any) {
      setError(e.message);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  return { cars, loading, error, fetchCars, addCar, deleteCar, setMainCar };
}
