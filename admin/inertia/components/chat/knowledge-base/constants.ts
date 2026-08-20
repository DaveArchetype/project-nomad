export const VIEWABLE_EXTENSIONS = new Set([
  'md',
  'txt',
  'csv',
  'json',
  'yaml',
  'yml',
  'toml',
  'xml',
  'html',
])

export function isViewableExtension(filename: string): boolean {
  const ext = filename.split('.').at(-1)?.toLowerCase() ?? ''
  return VIEWABLE_EXTENSIONS.has(ext)
}
