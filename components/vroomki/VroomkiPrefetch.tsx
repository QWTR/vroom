import { useEffect, useMemo } from 'react';
import { Image } from 'react-native';
import type { VroomkiPost } from '../../app/Community/community/communityShared';
import { priorityPrefetchVroomkiVideo, prefetchVroomkiVideo } from '../../lib/vroomkiVideoCache';

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

  const uris = useMemo(() => {
    const images: string[] = [];
    const videos: string[] = [];
    targets.forEach((post) => {
      post.photos.forEach((uri) => images.push(uri));
      post.car?.photos?.forEach((uri) => images.push(uri));
      if (post.videos[0]) videos.push(post.videos[0]);
    });
    return {
      images: Array.from(new Set(images)).slice(0, 12),
      videos: Array.from(new Set(videos)).slice(0, 5),
    };
  }, [targets]);

  useEffect(() => {
    uris.images.forEach((uri) => {
      Image.prefetch(uri).catch(() => {});
    });
    uris.videos.forEach((uri, index) => {
      if (index === 0) priorityPrefetchVroomkiVideo(uri);
      else prefetchVroomkiVideo(uri);
    });
  }, [uris]);

  return null;
}
