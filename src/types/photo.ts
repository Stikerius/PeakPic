export type LocalPhoto = {
  id: string;
  /** File name inside the app's photo directory. The absolute URI is resolved at read time, because the app container path can change between installs. */
  fileName: string;
  caption: string | null;
  /** ISO 8601 timestamp */
  createdAt: string;
};

export type PhotoSource = "camera" | "gallery";

export type CapturedPhoto = {
  uri: string;
  source: PhotoSource;
};
