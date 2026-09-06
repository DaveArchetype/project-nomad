let playbackAudioContext: AudioContext | null = null

export async function unlockAudioPlayback(): Promise<AudioContext> {
  if (typeof window === 'undefined') throw new Error('Audio playback is unavailable.')

  const AudioContextConstructor =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioContextConstructor) throw new Error('Audio playback is not supported by this browser.')

  if (!playbackAudioContext || playbackAudioContext.state === 'closed') {
    playbackAudioContext = new AudioContextConstructor()
  }
  if (playbackAudioContext.state !== 'running') await playbackAudioContext.resume()
  if (playbackAudioContext.state !== 'running') {
    throw new Error('Audio playback is blocked. Click or press a key, then try again.')
  }
  return playbackAudioContext
}

export async function createSpeechSource(blob: Blob): Promise<{
  context: AudioContext
  source: AudioBufferSourceNode
  duration: number
}> {
  const context = await unlockAudioPlayback()
  const audioBuffer = await context.decodeAudioData(await blob.arrayBuffer())
  const source = context.createBufferSource()
  source.buffer = audioBuffer
  source.connect(context.destination)
  return { context, source, duration: audioBuffer.duration }
}

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
