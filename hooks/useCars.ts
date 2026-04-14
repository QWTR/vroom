import { useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';
import type { Car } from '../constants/profile';

const getToken = async (): Promise<string | null> => {
  return (
    (await AsyncStorage.getItem('userToken')) ??
    (await AsyncStorage.getItem('token'))
  );
};

export function useCars() {
  const [cars, setCars]       = useState<Car[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

      const fetchCars = useCallback(async (userId?: number) => {
      setLoading(true);
      setError(null);
      try {
        const token   = await getToken();
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        let endpoint: string;

        if (userId) {
          // Publiczny profil — znany userId
          endpoint = `${API_URL}/api/profile/${userId}/cars`;
        } else {
          // Własny profil — pobierz userId z /me, potem /cars
          const meRes = await fetch(`${API_URL}/api/profile/me`, { headers });
          if (!meRes.ok) throw new Error('Brak profilu');
          const me = await meRes.json();
          const uid = me.userId ?? me.id;
          if (!uid) throw new Error('Brak userId');
          endpoint = `${API_URL}/api/profile/${uid}/cars`;
        }

        const res = await fetch(endpoint, { headers });
        if (!res.ok) throw new Error('Błąd pobierania aut');
        const data = await res.json();
        setCars(Array.isArray(data) ? data : []);
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
    photos: Array<{ uri: string; name: string; type: string }>;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const form  = new FormData();
      form.append('brand',  data.brand);
      form.append('specs',  data.specs);
      form.append('isMain', String(data.isMain));
      data.photos.forEach(photo => {
        form.append('photos', { uri: photo.uri, name: photo.name, type: photo.type } as any);
      });

      const res = await fetch(`${API_URL}/api/profile/cars`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}` },
        body:    form,
      });
      if (!res.ok) throw new Error('Błąd dodawania auta');
      const newCar: Car = await res.json();
      setCars(prev => [...prev, newCar]);
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
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/profile/cars/${carId}`, {
        method:  'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Błąd usuwania auta');
      setCars(prev => prev.filter(c => c.id !== carId));
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
      const token = await getToken();
      const res   = await fetch(`${API_URL}/api/profile/cars/${carId}/main`, {
        method:  'PATCH',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Błąd ustawiania głównego auta');
      setCars(prev => prev.map(c => ({ ...c, isMain: c.id === carId })));
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