import { useEffect, useMemo } from 'react';
import { Image } from 'react-native';
import type { VroomkiPost } from '../../app/Community/community/communityShared';

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
    return posts.slice(Math.max(0, idx - 1), idx + 4);
  }, [posts, activeId]);

  const imageUris = useMemo(() => {
    const images: string[] = [];
    targets.forEach((post) => {
      if (post.videoThumbnailUrl) images.push(post.videoThumbnailUrl);
      post.photos.forEach((uri) => images.push(uri));
      post.car?.photos?.forEach((uri) => images.push(uri));
    });
    return Array.from(new Set(images)).slice(0, 16);
  }, [targets]);

  useEffect(() => {
    imageUris.forEach((uri) => {
      Image.prefetch(uri).catch(() => {});
    });
  }, [imageUris]);

  return null;
}
