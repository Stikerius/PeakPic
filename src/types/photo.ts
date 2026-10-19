export type PhotoSource = "camera" | "gallery";

export type CapturedPhoto = {
  uri: string;
  source: PhotoSource;
};
