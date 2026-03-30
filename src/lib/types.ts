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

export interface ChangeStats {
  wordsAdded: number;
  wordsDeleted: number;
  paragraphsChanged: number;
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

export interface CommentThread {
  id: string;
  paragraphId: string;
  resolved: boolean;
  comments: Comment[];
}

export interface Comment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

export interface MergeResult {
  blocks: MergeBlock[];
  hasConflicts: boolean;
}

export interface MergeBlock {
  type: 'clean' | 'conflict';
  content?: string;
  yours?: string;
  theirs?: string;
  blockIndex: number;
}

export interface ConflictResolution {
  blockIndex: number;
  choice: 'yours' | 'theirs' | 'both';
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  font: string;
  fontSize: number;
  projectsDirectory: string;
  autosaveIntervalMs: number;
}
