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

export type Story = {
  id: string;
  userId: string;
  /** Signed photo URL; null if it could not be signed. */
  photoUrl: string | null;
  createdAt: string;
  expiresAt: string;
  seen: boolean;
  likedByMe: boolean;
};

export type StoryGroup = {
  author: PublicProfile;
  /** Oldest first, like Instagram. */
  stories: Story[];
  isMine: boolean;
  hasUnseen: boolean;
};

export type PostComment = {
  id: string;
  postId: string;
  author: PublicProfile;
  body: string;
  createdAt: string;
};
