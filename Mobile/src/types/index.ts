export interface DriveConfig {
  chatId: string;
  chatTitle: string;
  accessHash: string;
}

export interface TopicFolder {
  id: number;
  title: string;
  iconColor: number;
  date: number;
  messageCount: number;
}

export interface ChunkManifest {
  type: "segmented_file";
  fileName: string;
  fileSize: number;
  chunks: number[];
  chunkSize?: number;
  thumb?: number;
}

export interface DriveFile {
  id: number;
  name: string;
  size: number;
  topicId: number;
  manifest: ChunkManifest;
  date: number;
  mimeType?: string;
  chunkFileName?: string;
  uploaderName?: string;
  message?: any;

}

export interface UploadProgress {
  fileId: string;
  fileName: string;
  totalChunks: number;
  uploadedChunks: number;
  totalBytes: number;
  uploadedBytes: number;
  speedBps?: number;
  status: "preparing" | "uploading" | "finalizing" | "done" | "error";
  error?: string;
}

export interface DownloadProgress {
  name: string;
  progress: number;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
}

export type AuthStep = "phone" | "credentials" | "otp" | "password" | "done";

export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  avatarUrl: string | null;
  phone?: string;
  isPremium?: boolean;
  isVerified?: boolean;
  photoUrl?: string | null;
}

export interface SavedAccount {
  userId: string;
  session: string;
  username: string;
  idName: string;
  apiHash: string;
  apiId: number;
  avatarUrl: string | null;
  updatedAt: number;
}

export interface AuthState {
  step: AuthStep;
  phone: string;
  apiId?: number;
  apiHash?: string;
  loading: boolean;
  error: string | null;
}
