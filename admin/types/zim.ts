import { FileEntry } from './files.js'

export type ZimFileWithMetadata = FileEntry & {
  title: string | null
  summary: string | null
  author: string | null
  size_bytes: number | null
}

export type ListZimFilesResponse = {
  files: ZimFileWithMetadata[]
  next?: string
}

export type ListRemoteZimFilesResponse = {
  items: RemoteZimFileEntry[]
  has_more: boolean
  total_count: number
  next_start: number
}

export type RawRemoteZimFileEntry = {
  'id': string
  'title': string
  'updated': string
  'summary': string
  'language': string
  'name': string
  'flavour': string
  'category': string
  'tags': string
  'articleCount': number
  'mediaCount': number
  'link': Record<string, string>[]
  'author': {
    name: string
  }
  'publisher': {
    name: string
  }
  'dc:issued': string
}

export type RawListRemoteZimFilesResponse = {
  '?xml': string
  'feed': {
    id: string
    link: string[]
    title: string
    updated: string
    totalResults: number
    startIndex: number
    itemsPerPage: number
    entry?: RawRemoteZimFileEntry | RawRemoteZimFileEntry[]
  }
}

export type RemoteZimFileEntry = {
  id: string
  title: string
  updated: string
  summary: string
  size_bytes: number
  download_url: string
  author: string
  file_name: string
  language?: string
  category?: string
  tags?: string
  article_count?: number
  media_count?: number
  publisher?: string
  issued?: string
}

export type StreamZIMContentOptions = {
  strategy?: ExtractZIMChunkingStrategy
  startOffset?: number
  useWorkers?: boolean
  workerCount?: number
}

export type StreamZIMArticleCallback = (
  chunks: ZIMContentChunk[],
  articlesSeen: number,
  totalArticles: number
) => Promise<boolean | void>

export type StreamZIMContentResult = {
  articlesProcessed: number
  totalArticles: number
  cancelled: boolean
}

export type ExtractZIMChunkingStrategy = 'structured' | 'simple'

export type ZIMArchiveMetadata = {
  title: string
  creator: string
  publisher: string
  date: string
  language: string
  description: string
}

export type ZIMContentChunk = {
  // Content
  text: string

  // Article-level context
  articleTitle: string
  articlePath: string

  // Section-level context for structured chunks
  sectionTitle: string
  fullTitle: string // Combined "Article Title - Section Title"
  hierarchy: string // Breadcrumb trail
  sectionLevel?: number // Heading level (2=h2, 3=h3, etc.)

  // Document grouping
  documentId: string // Same for all chunks from one article

  // Archive metadata
  archiveMetadata: ZIMArchiveMetadata

  // Extraction metadata
  strategy: ExtractZIMChunkingStrategy
}
