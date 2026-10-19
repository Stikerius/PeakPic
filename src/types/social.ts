import type { DayKey } from "@/lib/streak";

export type PublicProfile = {
  id: string;
  username: string;
  /** Signed avatar URL, null if the user has none. */
  avatarUrl: string | null;
};

export type FeedPost = {
  id: string;
  author: PublicProfile;
  /** Signed photo URL; null if it could not be signed. */
  photoUrl: string | null;
  caption: string | null;
  workoutDate: DayKey;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
};

export type PostComment = {
  id: string;
  postId: string;
  author: PublicProfile;
  body: string;
  createdAt: string;
};
