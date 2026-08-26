export function stripMarkdownForHighlighting(text: string): string {
  let s = text
  s = s.replace(/```[\s\S]*?```/g, ' ')
  s = s.replace(/`([^`]+)`/g, '$1')
  s = s.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  s = s.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  s = s.replace(/#{1,6}\s+/g, '')
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1')
  s = s.replace(/\*([^*]+)\*/g, '$1')
  s = s.replace(/__([^_]+)__/g, '$1')
  s = s.replace(/_([^_]+)_/g, '$1')
  s = s.replace(/~~([^~]+)~~/g, '$1')
  s = s.replace(/^\s*[-*+]\s+/gm, '')
  s = s.replace(/^\s*\d+\.\s+/gm, '')
  s = s.replace(/^\s*>\s+/gm, '')
  s = s.replace(/\|/g, ' ')
  s = s.replace(/[#*~`]/g, '')
  s = s.replace(/\n{2,}/g, '\n')
  return s.trim()
}

export type SentenceChunk = {
  text: string
  startWordOffset: number
  wordCount: number
}

export function getSentencesWithOffsets(text: string): SentenceChunk[] {
  const sentences = text
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)

  let offset = 0
  return sentences.map((s) => {
    const wordCount = s.split(/\s+/).filter(Boolean).length
    const result = { text: s, startWordOffset: offset, wordCount }
    offset += wordCount
    return result
  })
}
