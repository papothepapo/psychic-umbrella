import type { ExportFormat, StorageOverview } from './types';

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = {
  pdf: 'PDF document',
  docx: 'Word document',
  txt: 'Plain text',
  md: 'Markdown',
  inkline: 'Inkline project'
};

export function exportFormatExtension(format: ExportFormat) {
  return format === 'inkline' ? 'inkline' : format;
}

export function sanitizeExportName(value: string) {
  const cleaned = value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return cleaned || 'inkline-export';
}

export function joinExportPath(directory: string, fileName: string) {
  if (!directory.trim()) return fileName;
  const separator = directory.includes('\\') ? '\\' : '/';
  return `${directory.replace(/[\\/]+$/, '')}${separator}${fileName}`;
}

export function buildDefaultExportPath(storage: StorageOverview | null, title: string, format: ExportFormat) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `${sanitizeExportName(title)}-${stamp}.${exportFormatExtension(format)}`;
  return joinExportPath(storage?.exportsDirectory ?? '', fileName);
}

export function exportDialogFilters(format: ExportFormat) {
  return [
    {
      name: EXPORT_FORMAT_LABELS[format],
      extensions: [exportFormatExtension(format)]
    }
  ];
}
