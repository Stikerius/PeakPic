import type { DayKey } from "@/lib/streak";

export type PublicProfile = {
  id: string;
  username: string;
  /** Free display name (not unique); shown big, with @username next to or below it. */
  displayName: string;
  /** Signed avatar URL, null if the user has none. */
  avatarUrl: string | null;
};

/** An @mention drawn on a photo: who, and where (0-1 of the edited canvas). */
export type PhotoMention = { userId: string; username: string; x: number; y: number };

/** Shown when a feed entry is someone's repost of the post. */
export type FeedRepost = {
  id: string;
  reposter: PublicProfile;
  caption: string | null;
  createdAt: string;
};

export type FeedPost = {
  /** Unique per feed entry: the post id, or "repost:<id>" for a repost of it. */
  feedKey: string;
  /** Set when this entry is a repost; everything else describes the original post. */
  repost: FeedRepost | null;
  id: string;
  author: PublicProfile;
  /** Signed cover photo URL; null if it could not be signed. */
  photoUrl: string | null;
  /** All photos in carousel order (just the cover for single-photo posts). */
  photoUrls: string[];
  /** @mentions drawn on each photo (same order as photoUrls), for tapping them. */
  photoMentions: PhotoMention[][];
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
  /** Where the mentions sit on the photo (stories posted since tappable mentions exist). */
  mentionSpots: { userId: string; x: number; y: number }[];
  /** Width / height of the canvas the story was made on; null for older stories. */
  canvasAspect: number | null;
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
