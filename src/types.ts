export type VideoSourceType = "youtube" | "video" | "prototype";

export const DEFAULT_CATEGORIES = [
  "Documentaries",
  "Workouts",
  "Screen Recordings",
] as const;

export type NavView = "Home" | "New & Popular" | "My List" | (string & {});

export type VideoChapter = {
  id: string;
  time: number;
  label: string;
};

export type Video = {
  id: string;
  title: string;
  category: string;
  year: number;
  duration: string;
  durationSeconds?: number;
  match: number;
  description: string;
  image: string;
  thumbnailPath?: string;
  tags: string[];
  sourceType: VideoSourceType;
  youtubeId?: string;
  videoUrl?: string;
  videoPath?: string;
  progress?: number;
  progressSeconds?: number;
  added?: boolean;
  liked?: boolean;
  pinned?: boolean;
  chapters?: VideoChapter[];
  createdAt: string;
  isPrototype?: boolean;
};

export type CatalogData = {
  videos: Video[];
  categories: string[];
};

export type AuthStatus = {
  authenticated: boolean;
  configured: boolean;
  storageMode: "blob" | "local";
  devHint?: string;
};
