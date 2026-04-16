import type {
  AppSettings,
  AutoSnapshotFrequency,
  DefaultExportFormat,
  PageWidthPreset,
  SnapshotRetention
} from './types';

export const FONT_OPTIONS = [
  'Georgia',
  'Times New Roman',
  'Palatino',
  'Garamond',
  'Merriweather',
  'Arial',
  'Helvetica',
  'Inter'
];

export const LANGUAGE_OPTIONS = [
  'en-US',
  'en-GB',
  'es-ES',
  'fr-FR',
  'de-DE',
  'it-IT',
  'pt-BR',
  'nl-NL',
  'sv-SE',
  'fi-FI',
  'da-DK',
  'no-NO',
  'pl-PL',
  'cs-CZ',
  'hu-HU',
  'tr-TR',
  'ru-RU',
  'uk-UA',
  'hi-IN',
  'ja-JP',
  'ko-KR',
  'zh-CN'
];

export const CANVAS_WIDTHS: Record<PageWidthPreset, number> = {
  narrow: 760,
  medium: 980,
  wide: 1220
};

const FREQUENCY_TO_MINUTES: Record<Exclude<AutoSnapshotFrequency, 'custom'>, number> = {
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60
};

export const RETENTION_TO_DAYS: Record<Exclude<SnapshotRetention, 'custom' | 'forever'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365
};

export const DEFAULT_SETTINGS: AppSettings = {
  appTheme: 'light',
  followSystemTheme: false,
  defaultFont: 'Georgia',
  defaultFontSize: 16,
  defaultLineSpacing: '1.5',
  customLineSpacing: 1.75,
  defaultTextAlignment: 'left',
  paragraphSpacing: 12,
  defaultPageWidth: 'medium',
  language: 'en-US',
  spellCheck: true,
  grammarCheck: true,
  autoCorrect: true,
  smartQuotes: true,
  autoCapitalizeSentences: true,
  focusMode: false,
  typewriterScrolling: false,
  showFormattingMarks: false,
  showWordCount: true,
  showCharacterCount: false,
  showParagraphCount: false,
  showReadingTime: false,
  showWordGoal: false,
  wordGoalTarget: 80000,
  wordGoalDisplay: 'fraction',
  highlightCurrentLine: false,
  cursorStyle: 'line',
  cursorBlink: true,
  doubleClickSelectsWord: true,
  tripleClickSelectsParagraph: true,
  pastePlainTextByDefault: false,
  autoSnapshotsEnabled: true,
  autoSnapshotFrequency: '15m',
  autoSnapshotCustomMinutes: 15,
  snapshotOnlyWhenChangesExist: true,
  autoSnapshotNaming: true,
  keepSnapshotsFor: 'forever',
  customRetentionDays: 30,
  maximumSnapshotsEnabled: false,
  maximumSnapshots: 100,
  snapshotLimitBehavior: 'deleteOldestAuto',
  hiddenSnapshotHashes: [],
  canvasWidth: 'medium',
  canvasShadow: true,
  showPageRuler: false,
  paragraphIndentStyle: 'block',
  deletionColor: '#DC2626',
  additionColor: '#16A34A',
  usePatternsInsteadOfColor: false,
  diffHighlightOpacity: 60,
  animationSpeed: 'normal',
  reduceMotion: false,
  includeDocumentTitleInExport: true,
  includePageNumbersInPdf: true,
  pdfPageSize: 'A4',
  pdfMargins: 'normal',
  includeAuthorNameInExport: false,
  authorName: '',
  exportWithComparisonMarkup: false,
  importMode: 'newDocument',
  fontScaling: 100,
  highContrastMode: false,
  screenReaderSupport: true,
  keyboardNavigation: true,
  tooltipDelay: 500,
  focusIndicators: 'default',
  dyslexiaFriendlyFont: false,
  lineFocusHighlight: false,
  projectsDirectory: '',
  backupsDirectory: '',
  exportsDirectory: '',
  defaultExportFormat: 'inkline'
};

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeSettings(input?: Partial<AppSettings> | null): AppSettings {
  const settings = {
    ...DEFAULT_SETTINGS,
    ...input
  };

  const font = FONT_OPTIONS.includes(settings.defaultFont) ? settings.defaultFont : DEFAULT_SETTINGS.defaultFont;
  const pageWidth = settings.defaultPageWidth;
  const canvasWidth = settings.canvasWidth;

  return {
    ...settings,
    appTheme: ['light', 'dark', 'sepia'].includes(settings.appTheme) ? settings.appTheme : DEFAULT_SETTINGS.appTheme,
    defaultFont: font,
    defaultFontSize: clamp(Number(settings.defaultFontSize || DEFAULT_SETTINGS.defaultFontSize), 8, 72),
    customLineSpacing: clamp(Number(settings.customLineSpacing || DEFAULT_SETTINGS.customLineSpacing), 1, 3),
    paragraphSpacing: clamp(Number(settings.paragraphSpacing || DEFAULT_SETTINGS.paragraphSpacing), 0, 40),
    defaultPageWidth: ['narrow', 'medium', 'wide'].includes(pageWidth) ? pageWidth : DEFAULT_SETTINGS.defaultPageWidth,
    language: LANGUAGE_OPTIONS.includes(settings.language) ? settings.language : DEFAULT_SETTINGS.language,
    wordGoalTarget: clamp(Number(settings.wordGoalTarget || DEFAULT_SETTINGS.wordGoalTarget), 1, 9999999),
    autoSnapshotCustomMinutes: clamp(
      Number(settings.autoSnapshotCustomMinutes || DEFAULT_SETTINGS.autoSnapshotCustomMinutes),
      1,
      1440
    ),
    customRetentionDays: clamp(Number(settings.customRetentionDays || DEFAULT_SETTINGS.customRetentionDays), 1, 3650),
    maximumSnapshots: clamp(Number(settings.maximumSnapshots || DEFAULT_SETTINGS.maximumSnapshots), 1, 10000),
    hiddenSnapshotHashes: Array.isArray(settings.hiddenSnapshotHashes) ? settings.hiddenSnapshotHashes : [],
    canvasWidth: ['narrow', 'medium', 'wide'].includes(canvasWidth) ? canvasWidth : DEFAULT_SETTINGS.canvasWidth,
    diffHighlightOpacity: clamp(Number(settings.diffHighlightOpacity || DEFAULT_SETTINGS.diffHighlightOpacity), 0, 100),
    fontScaling: clamp(Number(settings.fontScaling || DEFAULT_SETTINGS.fontScaling), 80, 150),
    tooltipDelay: clamp(Number(settings.tooltipDelay || DEFAULT_SETTINGS.tooltipDelay), 0, 1000),
    deletionColor: settings.deletionColor || DEFAULT_SETTINGS.deletionColor,
    additionColor: settings.additionColor || DEFAULT_SETTINGS.additionColor,
    defaultExportFormat: (['pdf', 'docx', 'txt', 'md', 'inkline'] as DefaultExportFormat[]).includes(
      settings.defaultExportFormat
    )
      ? settings.defaultExportFormat
      : DEFAULT_SETTINGS.defaultExportFormat
  };
}

export function pageWidthToPixels(width: PageWidthPreset) {
  return CANVAS_WIDTHS[width];
}

export function currentLineSpacing(settings: AppSettings) {
  switch (settings.defaultLineSpacing) {
    case 'single':
      return 1;
    case '1.15':
      return 1.15;
    case '1.5':
      return 1.5;
    case 'double':
      return 2;
    case 'custom':
      return settings.customLineSpacing;
    default:
      return 1.5;
  }
}

export function animationMultiplier(settings: AppSettings) {
  if (settings.reduceMotion || settings.animationSpeed === 'off') {
    return 0;
  }

  if (settings.animationSpeed === 'slow') return 1.45;
  if (settings.animationSpeed === 'fast') return 0.7;
  return 1;
}

export function getAutoSnapshotMinutes(settings: AppSettings) {
  return settings.autoSnapshotFrequency === 'custom'
    ? settings.autoSnapshotCustomMinutes
    : FREQUENCY_TO_MINUTES[settings.autoSnapshotFrequency];
}
