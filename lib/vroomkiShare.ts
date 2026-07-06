import type { VroomkiPost } from '../app/Community/community/communityShared';

const WEB_BASE = 'https://v-room.app';

export function buildVroomkiShareUrl(postId: number): string {
  return `${WEB_BASE}/vroomki/${postId}`;
}

export function buildVroomkiAppUrl(postId: number): string {
  return `vroom://vroomki?id=${postId}`;
}

export function getVroomkiCoverUrl(post: VroomkiPost): string | null {
  if (post.videos[0]) return post.videos[0];
  if (post.photos[0]) return post.photos[0];
  if (post.car?.photos?.[0]) return post.car.photos[0];
  return null;
}

export function buildVroomkiChatPayload(post: VroomkiPost) {
  const shareId = post.id > 0 ? post.id : (post.legacyCarId ?? Math.abs(post.id));
  return {
    type: 'vroomki',
    vroomkiPostId: shareId,
    legacyCarId: post.legacyCarId ?? (post.id < 0 ? Math.abs(post.id) : null),
    caption: post.caption?.slice(0, 200) ?? '',
    coverUrl: getVroomkiCoverUrl(post),
    authorUsername: post.author.username,
    mediaType: post.videos.length > 0 ? 'video' : 'photo',
  };
}
