export interface ProjectMeta {
  id: string;
  title: string;
  created: string;
  modified: string;
  wordCount: number;
  savePointCount: number;
  path: string;
}

export interface SavePoint {
  hash: string;
  message: string;
  timestamp: string;
  changeSize: number;
}

export interface DiffResult {
  blocks: DiffBlock[];
}

export interface DiffBlock {
  type: 'unchanged' | 'added' | 'deleted' | 'modified';
  leftContent?: string;
  rightContent?: string;
  wordDiffs?: WordDiff[];
}

export interface WordDiff {
  type: 'equal' | 'insert' | 'delete';
  text: string;
}

export interface BackupEntry {
  fileName: string;
  path: string;
  timestamp: string;
  kind: 'latest' | 'snapshot' | string;
}

export interface ExportedFile {
  path: string;
  format: ExportFormat;
}

export interface StorageOverview {
  appRoot: string;
  backupsDirectory: string;
  exportsDirectory: string;
}

export type ExportFormat = 'md' | 'txt' | 'inkline' | 'docx';

export interface AppSettings {
  theme: 'light' | 'mist' | 'system';
  font: string;
  fontSize: number;
  lineHeight: number;
  editorWidth: number;
  showRuler: boolean;
  showWordCount: boolean;
  showCharacterCount: boolean;
  showReadingTime: boolean;
  showStatusBar: boolean;
  showSpellcheck: boolean;
  focusMode: boolean;
  highlightMatches: boolean;
  projectsDirectory: string;
  backupsDirectory: string;
  exportsDirectory: string;
  autosaveIntervalMs: number;
  backupIntervalMs: number;
  defaultExportFormat: ExportFormat;
}
