import { invoke } from '@tauri-apps/api/core';
import type {
  AppSettings,
  BackupEntry,
  DiffResult,
  ExportFormat,
  ExportedFile,
  ProjectMeta,
  SavePoint,
  StorageOverview
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
  computeDiff: (projectId: string, from: string, to: string) =>
    invoke<DiffResult>('compute_diff', { projectId, from, to }),
  getSettings: () => invoke<AppSettings>('get_settings'),
  updateSettings: (settings: AppSettings) => invoke<void>('update_settings', { settings }),
  getStorageOverview: () => invoke<StorageOverview>('get_storage_overview'),
  listBackups: (projectId: string) => invoke<BackupEntry[]>('list_backups', { projectId }),
  createBackup: (projectId: string) => invoke<BackupEntry>('create_backup', { projectId }),
  exportProject: (projectId: string, format: ExportFormat) =>
    invoke<ExportedFile>('export_project', { projectId, format }),
  importProject: (fileName: string, content: string, contentEncoding?: 'utf8' | 'base64') =>
    invoke<ProjectMeta>('import_project', { fileName, content, contentEncoding })
};
