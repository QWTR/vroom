import { useState, useCallback } from 'react';
import { API_URL } from '../constants/config';

export interface PartnerBanner {
  id: number;
  title?: string;
  imageUrl: string;
  linkUrl?: string;
  order: number;
}

export function usePartnerBanners() {
  const [banners, setBanners] = useState<PartnerBanner[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchBanners = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/banners`);
      if (res.ok) {
        const data = await res.json();
        setBanners(data);
      }
    } catch (err) {
      console.error('Failed to fetch banners:', err);
    } finally { setLoading(false); }
  }, []);

  return { banners, loading, fetchBanners };
})
};