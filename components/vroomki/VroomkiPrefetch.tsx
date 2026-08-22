import { useEffect, useMemo } from 'react';
import { Image } from 'expo-image';
import type { VroomkiPost } from '../../app/Community/community/communityShared';
import type { PerformanceProfile } from '../../lib/performance/policy';

export function VroomkiPrefetch({
  posts,
  activeId,
  profile,
  active = true,
}: {
  posts: VroomkiPost[];
  activeId: number | null;
  profile: PerformanceProfile;
  active?: boolean;
}) {
  const targets = useMemo(() => {
    if (!active || !activeId) return [];
    const idx = posts.findIndex((p) => p.id === activeId);
    if (idx < 0) return [];
    if (profile === 'battery') return posts.slice(idx, idx + 1);
    if (profile === 'smooth') return posts.slice(Math.max(0, idx - 1), idx + 2);
    return posts.slice(idx, idx + 2);
  }, [active, posts, activeId, profile]);

  const imageUris = useMemo(() => {
    const images: string[] = [];
    targets.forEach((post) => {
      if (post.videoThumbnailUrl) images.push(post.videoThumbnailUrl);
      post.photos.forEach((uri) => images.push(uri));
      post.car?.photos?.forEach((uri) => images.push(uri));
    });
    const maxImages = profile === 'battery' ? 4 : profile === 'smooth' ? 12 : 8;
    return Array.from(new Set(images)).slice(0, maxImages);
  }, [profile, targets]);

  useEffect(() => {
    imageUris.forEach((uri) => {
      Image.prefetch(uri).catch(() => {});
    });
  }, [imageUris]);

  return null;
}
