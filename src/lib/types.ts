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

export type ExportFormat = 'pdf' | 'md' | 'txt' | 'inkline' | 'docx';
export type AppTheme = 'light' | 'dark' | 'sepia';
export type TextAlignment = 'left' | 'center' | 'right' | 'justify';
export type LineSpacingPreset = 'single' | '1.15' | '1.5' | 'double' | 'custom';
export type PageWidthPreset = 'narrow' | 'medium' | 'wide';
export type AutoSnapshotFrequency = '1m' | '5m' | '15m' | '30m' | '1h' | 'custom';
export type SnapshotRetention = 'forever' | '7d' | '30d' | '90d' | '1y' | 'custom';
export type SnapshotLimitBehavior = 'deleteOldestAuto' | 'prompt';
export type AnimationSpeed = 'normal' | 'slow' | 'fast' | 'off';
export type WordGoalDisplay = 'bar' | 'percentage' | 'fraction';
export type CursorStyle = 'line' | 'block' | 'underline';
export type ParagraphIndentStyle = 'none' | 'firstLine' | 'block';
export type FocusIndicatorStyle = 'default' | 'high' | 'off';
export type DefaultExportFormat = 'pdf' | 'docx' | 'txt' | 'md' | 'inkline';
export type PdfPageSize = 'A4' | 'Letter' | 'A5';
export type PdfMarginPreset = 'normal' | 'narrow' | 'wide';
export type ImportMode = 'newDocument' | 'newSnapshot';

export interface AppSettings {
  appTheme: AppTheme;
  followSystemTheme: boolean;
  defaultFont: string;
  defaultFontSize: number;
  defaultLineSpacing: LineSpacingPreset;
  customLineSpacing: number;
  defaultTextAlignment: TextAlignment;
  paragraphSpacing: number;
  defaultPageWidth: PageWidthPreset;
  language: string;
  spellCheck: boolean;
  grammarCheck: boolean;
  autoCorrect: boolean;
  smartQuotes: boolean;
  autoCapitalizeSentences: boolean;
  focusMode: boolean;
  typewriterScrolling: boolean;
  showFormattingMarks: boolean;
  showWordCount: boolean;
  showCharacterCount: boolean;
  showParagraphCount: boolean;
  showReadingTime: boolean;
  showWordGoal: boolean;
  wordGoalTarget: number;
  wordGoalDisplay: WordGoalDisplay;
  highlightCurrentLine: boolean;
  cursorStyle: CursorStyle;
  cursorBlink: boolean;
  doubleClickSelectsWord: boolean;
  tripleClickSelectsParagraph: boolean;
  pastePlainTextByDefault: boolean;
  autoSnapshotsEnabled: boolean;
  autoSnapshotFrequency: AutoSnapshotFrequency;
  autoSnapshotCustomMinutes: number;
  snapshotOnlyWhenChangesExist: boolean;
  autoSnapshotNaming: boolean;
  keepSnapshotsFor: SnapshotRetention;
  customRetentionDays: number;
  maximumSnapshotsEnabled: boolean;
  maximumSnapshots: number;
  snapshotLimitBehavior: SnapshotLimitBehavior;
  hiddenSnapshotHashes: string[];
  canvasWidth: PageWidthPreset;
  canvasShadow: boolean;
  showPageRuler: boolean;
  paragraphIndentStyle: ParagraphIndentStyle;
  deletionColor: string;
  additionColor: string;
  usePatternsInsteadOfColor: boolean;
  diffHighlightOpacity: number;
  animationSpeed: AnimationSpeed;
  reduceMotion: boolean;
  includeDocumentTitleInExport: boolean;
  includePageNumbersInPdf: boolean;
  pdfPageSize: PdfPageSize;
  pdfMargins: PdfMarginPreset;
  includeAuthorNameInExport: boolean;
  authorName: string;
  exportWithComparisonMarkup: boolean;
  importMode: ImportMode;
  fontScaling: number;
  highContrastMode: boolean;
  screenReaderSupport: boolean;
  keyboardNavigation: boolean;
  tooltipDelay: number;
  focusIndicators: FocusIndicatorStyle;
  dyslexiaFriendlyFont: boolean;
  lineFocusHighlight: boolean;
  projectsDirectory: string;
  backupsDirectory: string;
  exportsDirectory: string;
  defaultExportFormat: DefaultExportFormat;
}
