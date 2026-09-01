import sharp from 'sharp'
import { PDFParse } from 'pdf-parse'
import { createWorker } from 'tesseract.js'
import { fromBuffer } from 'pdf2pic'
import JSZip from 'jszip'
import * as cheerio from 'cheerio'
import mammoth from 'mammoth'
import logger from '@adonisjs/core/services/logger'

export async function preprocessImage(filebuffer: Buffer): Promise<Buffer> {
  return await sharp(filebuffer)
    .grayscale()
    .normalize()
    .sharpen()
    .resize({ width: 2000, fit: 'inside' })
    .toBuffer()
}

export async function convertPDFtoImages(filebuffer: Buffer): Promise<Buffer[]> {
  const converted = await fromBuffer(filebuffer, {
    quality: 50,
    density: 200,
    format: 'png',
  }).bulk(-1, {
    responseType: 'buffer',
  })
  return converted.filter((res) => res.buffer).map((res) => res.buffer!)
}

export async function extractPDFText(filebuffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: filebuffer })
  const data = await parser.getText()
  await parser.destroy()
  return data.text
}

export async function extractTXTText(filebuffer: Buffer): Promise<string> {
  return filebuffer.toString('utf-8')
}

export async function extractImageText(filebuffer: Buffer): Promise<string> {
  const worker = await createWorker('eng')
  const result = await worker.recognize(filebuffer)
  await worker.terminate()
  return result.data.text
}

export async function processImageFile(fileBuffer: Buffer): Promise<string> {
  const preprocessedBuffer = await preprocessImage(fileBuffer)
  return await extractImageText(preprocessedBuffer)
}

export async function processPDFFile(fileBuffer: Buffer): Promise<string> {
  let extractedText = await extractPDFText(fileBuffer)

  if (!extractedText || extractedText.trim().length < 100) {
    logger.debug('[RAG] PDF text extraction minimal, attempting OCR on pages')
    const imageBuffers = await convertPDFtoImages(fileBuffer)
    extractedText = ''

    for (const imgBuffer of imageBuffers) {
      const preprocessedImg = await preprocessImage(imgBuffer)
      const pageText = await extractImageText(preprocessedImg)
      extractedText += pageText + '\n'
    }
  }

  return extractedText
}

export async function processTextFile(fileBuffer: Buffer): Promise<string> {
  return await extractTXTText(fileBuffer)
}

export async function processDocxFile(fileBuffer: Buffer): Promise<string> {
  const { value: text } = await mammoth.extractRawText({ buffer: fileBuffer })
  return text
}

export async function processEPUBFile(fileBuffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(fileBuffer)

  const containerXml = await zip.file('META-INF/container.xml')?.async('text')
  if (!containerXml) {
    throw new Error('Invalid EPUB: missing META-INF/container.xml')
  }

  const $container = cheerio.load(containerXml, { xml: true })
  const opfPath = $container('rootfile').attr('full-path')
  if (!opfPath) {
    throw new Error('Invalid EPUB: no rootfile found in container.xml')
  }

  const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : ''

  const opfContent = await zip.file(opfPath)?.async('text')
  if (!opfContent) {
    throw new Error(`Invalid EPUB: OPF file not found at ${opfPath}`)
  }

  const $opf = cheerio.load(opfContent, { xml: true })

  const manifestItems = new Map<string, string>()
  $opf('manifest item').each((_, el) => {
    const id = $opf(el).attr('id')
    const href = $opf(el).attr('href')
    const mediaType = $opf(el).attr('media-type') || ''
    if (id && href && (mediaType.includes('html') || mediaType.includes('xml'))) {
      manifestItems.set(id, href)
    }
  })

  const spineOrder: string[] = []
  $opf('spine itemref').each((_, el) => {
    const idref = $opf(el).attr('idref')
    if (idref && manifestItems.has(idref)) {
      spineOrder.push(manifestItems.get(idref)!)
    }
  })

  const contentFiles = spineOrder.length > 0 ? spineOrder : Array.from(manifestItems.values())

  const textParts: string[] = []
  for (const href of contentFiles) {
    const fullPath = opfDir + href
    const content = await zip.file(fullPath)?.async('text')
    if (content) {
      const $ = cheerio.load(content)
      $('script, style').remove()
      const text = $('body').text().trim()
      if (text) {
        textParts.push(text)
      }
    }
  }

  const fullText = textParts.join('\n\n')
  logger.debug(
    `[RAG] EPUB extracted ${textParts.length} chapters, ${fullText.length} characters total`
  )
  return fullText
}
