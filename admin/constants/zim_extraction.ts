export const HTML_SELECTORS_TO_REMOVE = [
  'script',
  'style',
  'nav',
  'header',
  'footer',
  'noscript',
  'iframe',
  'svg',
  '.navbox',
  '.sidebar',
  '.infobox',
  '.mw-editsection',
  '.reference',
  '.reflist',
  '.toc',
  '.noprint',
  '.mw-jump-link',
  '.mw-headline-anchor',
  '[role="navigation"]',
  '.navbar',
  '.hatnote',
  '.ambox',
  '.sistersitebox',
  '.portal',
  '#coordinates',
  '.geo-nondefault',
  '.authority-control',
]

// Common heading names that usually don't have meaningful content under them
export const NON_CONTENT_HEADING_PATTERNS = [
  /^see also$/i,
  /^references$/i,
  /^external links$/i,
  /^further reading$/i,
  /^notes$/i,
  /^bibliography$/i,
  /^navigation$/i,
]

export const ZIM_FLUSH_CHUNK_COUNT = 2048

export const ZIM_FLUSH_ARTICLE_INTERVAL = 100

export const ZIM_QDRANT_UPSERT_BATCH = 500
