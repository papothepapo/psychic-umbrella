import { invoke } from '@tauri-apps/api/core';
import type {
  AppSettings,
  ChangeStats,
  Comment,
  CommentThread,
  ConflictResolution,
  DiffResult,
  MergeResult,
  ProjectMeta,
  SavePoint
} from './types';

export const api = {
  createProject: (title: string) => invoke<ProjectMeta>('create_project', { title }),
  listProjects: () => invoke<ProjectMeta[]>('list_projects'),
  deleteProject: (projectId: string) => invoke<void>('delete_project', { projectId }),
  renameProject: (projectId: string, newTitle: string) =>
    invoke<void>('rename_project', { projectId, newTitle }),
  loadDocument: (projectId: string) => invoke<string>('load_document', { projectId }),
  saveDocument: (projectId: string, content: string) => invoke<void>('save_document', { projectId, content }),
  createSavePoint: (projectId: string, message: string) =>
    invoke<SavePoint>('create_save_point', { projectId, message }),
  getTimeline: (projectId: string) => invoke<SavePoint[]>('get_timeline', { projectId }),
  getDocumentAtSavePoint: (projectId: string, hash: string) =>
    invoke<string>('get_document_at_save_point', { projectId, hash }),
  getChangeStats: (projectId: string, hash: string) =>
    invoke<ChangeStats>('get_change_stats', { projectId, hash }),
  computeDiff: (projectId: string, from: string, to: string) =>
    invoke<DiffResult>('compute_diff', { projectId, from, to }),
  loadComments: (projectId: string) => invoke<CommentThread[]>('load_comments', { projectId }),
  addComment: (projectId: string, paragraphId: string, text: string) =>
    invoke<CommentThread>('add_comment', { projectId, paragraphId, text }),
  replyToComment: (projectId: string, threadId: string, text: string) =>
    invoke<Comment>('reply_to_comment', { projectId, threadId, text }),
  resolveThread: (projectId: string, threadId: string) =>
    invoke<void>('resolve_thread', { projectId, threadId }),
  deleteThread: (projectId: string, threadId: string) =>
    invoke<void>('delete_thread', { projectId, threadId }),
  importAndDiff: (projectId: string, filePath: string) =>
    invoke<MergeResult>('import_and_diff', { projectId, filePath }),
  applyMerge: (projectId: string, resolutions: ConflictResolution[]) =>
    invoke<void>('apply_merge', { projectId, resolutions }),
  getSettings: () => invoke<AppSettings>('get_settings'),
  updateSettings: (settings: AppSettings) => invoke<void>('update_settings', { settings })
};
