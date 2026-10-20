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
  /** Signed cover photo URL; null if it could not be signed. */
  photoUrl: string | null;
  /** All photos in carousel order (just the cover for single-photo posts). */
  photoUrls: string[];
  /** People tagged in the post. */
  tags: PublicProfile[];
  /** The day's slideshow (several photos of one training day). */
  isDayPost: boolean;
  /** Shown in the author's profile grid. */
  showInProfile: boolean;
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
  /** People tagged in the story. */
  mentions: PublicProfile[];
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
  /** Top-level comment this one replies to; null for top-level comments. */
  parentId: string | null;
  author: PublicProfile;
  body: string;
  createdAt: string;
  likeCount: number;
  likedByMe: boolean;
};
