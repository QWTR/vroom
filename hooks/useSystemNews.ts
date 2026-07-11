import { useCallback, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_URL } from '../constants/config';

export type SystemNewsItem = {
  id: number;
  title: string;
  excerpt: string | null;
  body?: string;
  imageUrl: string | null;
  sourceUrl: string | null;
  sourceName: string | null;
  status: string;
  category: string;
  createdAt: string;
  publishedAt: string | null;
  publishedPostId: number | null;
};

export type SystemNewsPagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

const PAGE_LIMIT = 12;
const SEEN_KEY = 'system_news_seen';

function normalizeNewsImageUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^http:\/\/(www\.)?v-room\.app/i.test(trimmed)) {
    return trimmed.replace(/^http:\/\//i, 'https://');
  }
  if (trimmed.startsWith('/uploads/')) {
    return `${API_URL}${trimmed}`;
  }
  return trimmed;
}

function normalizeNewsItem(item: SystemNewsItem): SystemNewsItem {
  return {
    ...item,
    imageUrl: normalizeNewsImageUrl(item.imageUrl),
  };
}

export function systemNewsSourceDomain(item: {
  sourceUrl?: string | null;
  sourceName?: string | null;
}): string {
  const url = String(item.sourceUrl || '').trim();
  if (url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, '');
    } catch {
      // fallthrough
    }
  }
  const name = String(item.sourceName || '').trim();
  return name || 'VROOM';
}

export function useSystemNews() {
  const [items, setItems] = useState<SystemNewsItem[]>([]);
  const [seenIds, setSeenIds] = useState<number[]>([]);
  const [pagination, setPagination] = useState<SystemNewsPagination>({
    page: 1,
    limit: PAGE_LIMIT,
    total: 0,
    totalPages: 1,
  });
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);

  const loadPage = useCallback(async (page = 1, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const seenRaw = await AsyncStorage.getItem(SEEN_KEY);
      const seen: number[] = seenRaw ? JSON.parse(seenRaw) : [];
      setSeenIds(Array.isArray(seen) ? seen : []);

      const res = await fetch(
        `${API_URL}/api/system-news?page=${page}&limit=${PAGE_LIMIT}`,
      );
      if (!res.ok) throw new Error('fetch failed');
      const data = await res.json();
      const nextItems: SystemNewsItem[] = (Array.isArray(data?.items) ? data.items : [])
        .map((item: SystemNewsItem) => normalizeNewsItem(item));
      setItems((prev) => (append ? [...prev, ...nextItems] : nextItems));
      if (data?.pagination) setPagination(data.pagination);
    } catch (e) {
      console.warn('useSystemNews load error:', e);
      if (!append) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading) return;
    if (pagination.page >= pagination.totalPages) return;
    await loadPage(pagination.page + 1, true);
  }, [loadPage, loading, loadingMore, pagination.page, pagination.totalPages]);

  const loadDetail = useCallback(async (id: number): Promise<SystemNewsItem | null> => {
    setDetailLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/system-news/${id}`);
      if (!res.ok) return null;
      const item = await res.json();
      return item ? normalizeNewsItem(item) : null;
    } catch (e) {
      console.warn('useSystemNews detail error:', e);
      return null;
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setItems([]);
    setPagination({ page: 1, limit: PAGE_LIMIT, total: 0, totalPages: 1 });
  }, []);

  const markSeen = useCallback(async (id: number) => {
    setSeenIds((prev) => {
      if (prev.includes(id)) return prev;
      const next = [...prev, id];
      AsyncStorage.setItem(SEEN_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const markAllSeen = useCallback(async (ids: number[]) => {
    setSeenIds((prev) => {
      const next = Array.from(new Set([...prev, ...ids]));
      AsyncStorage.setItem(SEEN_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const unseenCount = items.filter((item) => !seenIds.includes(item.id)).length;

  return {
    items,
    seenIds,
    unseenCount,
    pagination,
    loading,
    loadingMore,
    detailLoading,
    loadPage,
    loadMore,
    loadDetail,
    markSeen,
    markAllSeen,
    reset,
  };
}
