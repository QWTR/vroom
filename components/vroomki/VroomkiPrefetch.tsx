import { useEffect, useMemo } from 'react';
import { Image } from 'react-native';
import type { VroomkiPost } from '../../app/Community/community/communityShared';

/** Lekki prefetch — bez ukrytych Video/Audio (OOM / restart apki). */
export function VroomkiPrefetch({
  posts,
  activeId,
}: {
  posts: VroomkiPost[];
  activeId: number | null;
}) {
  const targets = useMemo(() => {
    if (!activeId) return [];
    const idx = posts.findIndex((p) => p.id === activeId);
    if (idx < 0) return [];
    return posts.slice(idx + 1, idx + 3);
  }, [posts, activeId]);

  const uris = useMemo(() => {
    const set = new Set<string>();
    targets.forEach((post) => {
      post.photos.forEach((uri) => set.add(uri));
      post.car?.photos?.forEach((uri) => set.add(uri));
      if (post.videos[0]) set.add(post.videos[0]);
      if (post.sound?.audioUrl) set.add(post.sound.audioUrl);
    });
    return Array.from(set).slice(0, 10);
  }, [targets]);

  useEffect(() => {
    uris.forEach((uri) => {
      if (/\.(jpg|jpeg|png|webp|gif)/i.test(uri) || uri.includes('/uploads/')) {
        Image.prefetch(uri).catch(() => {});
      } else {
        fetch(uri, { method: 'HEAD' }).catch(() => {});
      }
    });
  }, [uris]);

  return null;
}
