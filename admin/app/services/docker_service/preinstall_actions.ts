import { join } from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, copyFile, chown, chmod, access, writeFile, readdir } from 'node:fs/promises'
import logger from '@adonisjs/core/services/logger'
import { doResumableDownloadWithRetry } from '../../utils/downloads.js'
import {
  ZIM_STORAGE_PATH,
  BOOKS_STORAGE_PATH,
  CALIBRE_EMPTY_LIBRARY_ASSET_PATH,
  VAULTWARDEN_STORAGE_PATH,
  MESHCORE_WEB_STORAGE_PATH,
  MEDIA_STORAGE_PATH,
  JELLYFIN_MEDIA_SUBFOLDERS,
  CODE_SERVER_STORAGE_PATH,
  COMFYUI_STORAGE_PATH,
} from '../../utils/fs.js'
import { KiwixLibraryService } from '../kiwix_library_service.js'
import { SERVICE_NAMES } from '../../../constants/service_names.js'
import type { DockerCtx } from './types.js'

const execAsync = promisify(exec)

export async function runPreinstallActions__KiwixServe(ctx: DockerCtx): Promise<void> {
  const WIKIPEDIA_ZIM_URL =
    'https://github.com/Crosstalk-Solutions/project-nomad/raw/refs/heads/main/install/wikipedia_en_100_mini_2026-01.zim'
  const filename = 'wikipedia_en_100_mini_2026-01.zim'
  const filepath = join(process.cwd(), ZIM_STORAGE_PATH, filename)
  logger.info(`[DockerService] Kiwix Serve pre-install: Downloading ZIM file to ${filepath}`)

  ctx.broadcast(SERVICE_NAMES.KIWIX, 'preinstall', `Running pre-install actions for Kiwix Serve...`)
  ctx.broadcast(
    SERVICE_NAMES.KIWIX,
    'preinstall',
    `Downloading Wikipedia ZIM file from ${WIKIPEDIA_ZIM_URL}. This may take some time...`
  )

  try {
    await doResumableDownloadWithRetry({
      url: WIKIPEDIA_ZIM_URL,
      filepath,
      timeout: 60000,
      allowedMimeTypes: ['application/x-zim', 'application/x-openzim', 'application/octet-stream'],
    })

    ctx.broadcast(SERVICE_NAMES.KIWIX, 'preinstall', `Downloaded Wikipedia ZIM file to ${filepath}`)

    const kiwixLibraryService = new KiwixLibraryService()
    await kiwixLibraryService.rebuildFromDisk()
    ctx.broadcast(SERVICE_NAMES.KIWIX, 'preinstall', 'Generated kiwix library XML.')
  } catch (error: any) {
    ctx.broadcast(
      SERVICE_NAMES.KIWIX,
      'preinstall-error',
      `Failed to download Wikipedia ZIM file: ${error.message}`
    )
    throw new Error(`Pre-install action failed: ${error.message}`)
  }
}

export async function runPreinstallActions__CalibreWeb(ctx: DockerCtx): Promise<void> {
  const CALIBRE_WEB_UID = 1000
  const CALIBRE_WEB_GID = 1000

  const booksDir = join(process.cwd(), BOOKS_STORAGE_PATH)
  const metadataPath = join(booksDir, 'metadata.db')
  const assetPath = join(process.cwd(), CALIBRE_EMPTY_LIBRARY_ASSET_PATH)

  ctx.broadcast(
    SERVICE_NAMES.CALIBREWEB,
    'preinstall',
    `Running pre-install actions for Calibre-Web...`
  )

  try {
    await mkdir(booksDir, { recursive: true })

    const alreadyHasLibrary = await access(metadataPath)
      .then(() => true)
      .catch(() => false)

    if (alreadyHasLibrary) {
      ctx.broadcast(
        SERVICE_NAMES.CALIBREWEB,
        'preinstall',
        `Existing Calibre library found in books folder — leaving it as-is.`
      )
    } else {
      await copyFile(assetPath, metadataPath)
      ctx.broadcast(
        SERVICE_NAMES.CALIBREWEB,
        'preinstall',
        `Seeded an empty Calibre library into the books folder.`
      )
    }

    await chown(booksDir, CALIBRE_WEB_UID, CALIBRE_WEB_GID)
    await chown(metadataPath, CALIBRE_WEB_UID, CALIBRE_WEB_GID)
  } catch (error: any) {
    ctx.broadcast(
      SERVICE_NAMES.CALIBREWEB,
      'preinstall-error',
      `Failed to prepare the Calibre library: ${error.message}`
    )
    throw new Error(`Pre-install action failed: ${error.message}`)
  }
}

export async function runPreinstallActions__CodeServer(ctx: DockerCtx): Promise<void> {
  const CODE_SERVER_UID = 1000
  const CODE_SERVER_GID = 1000

  const dataDir = join(process.cwd(), CODE_SERVER_STORAGE_PATH)

  ctx.broadcast(
    SERVICE_NAMES.CODE_SERVER,
    'preinstall',
    `Running pre-install actions for Code Server...`
  )

  try {
    await mkdir(dataDir, { recursive: true })
    await chown(dataDir, CODE_SERVER_UID, CODE_SERVER_GID)
  } catch (error: any) {
    ctx.broadcast(
      SERVICE_NAMES.CODE_SERVER,
      'preinstall-error',
      `Failed to prepare the Code Server data folder: ${error.message}`
    )
    throw new Error(`Pre-install action failed: ${error.message}`)
  }
}

export async function ensureSelfSignedCert(
  certDir: string,
  commonName: string
): Promise<{ certPath: string; keyPath: string }> {
  const certPath = join(certDir, 'cert.pem')
  const keyPath = join(certDir, 'key.pem')

  await mkdir(certDir, { recursive: true })

  const alreadyHasCert = await Promise.all([
    access(certPath)
      .then(() => true)
      .catch(() => false),
    access(keyPath)
      .then(() => true)
      .catch(() => false),
  ]).then(([c, k]) => c && k)

  if (alreadyHasCert) return { certPath, keyPath }

  await execAsync(
    `openssl req -x509 -newkey rsa:2048 -nodes ` +
      `-keyout "${keyPath}" -out "${certPath}" -days 3650 ` +
      `-subj "/CN=${commonName}" ` +
      `-addext "subjectAltName=DNS:nomad,DNS:localhost"`
  )

  await chmod(keyPath, 0o600)
  await chmod(certPath, 0o644)

  return { certPath, keyPath }
}

export async function runPreinstallActions__Vaultwarden(ctx: DockerCtx): Promise<void> {
  const dataDir = join(process.cwd(), VAULTWARDEN_STORAGE_PATH)

  ctx.broadcast(
    SERVICE_NAMES.VAULTWARDEN,
    'preinstall',
    `Running pre-install actions for Vaultwarden...`
  )

  try {
    await ensureSelfSignedCert(dataDir, 'Project NOMAD Vaultwarden')
    ctx.broadcast(
      SERVICE_NAMES.VAULTWARDEN,
      'preinstall',
      `Vaultwarden HTTPS certificate is ready.`
    )
  } catch (error: any) {
    ctx.broadcast(
      SERVICE_NAMES.VAULTWARDEN,
      'preinstall-error',
      `Failed to prepare the Vaultwarden certificate: ${error.message}`
    )
    throw new Error(`Pre-install action failed: ${error.message}`)
  }
}

export async function runPreinstallActions__MeshCoreWeb(ctx: DockerCtx): Promise<void> {
  const appDir = join(process.cwd(), MESHCORE_WEB_STORAGE_PATH)
  const certDir = join(appDir, 'certs')
  const nginxConfPath = join(appDir, 'nginx-ssl.conf')

  ctx.broadcast(
    SERVICE_NAMES.MESHCORE_WEB,
    'preinstall',
    `Running pre-install actions for MeshCore Web...`
  )

  try {
    await ensureSelfSignedCert(certDir, 'Project NOMAD MeshCore Web')

    const nginxConf =
      [
        'server {',
        '    listen 443 ssl;',
        '    server_name _;',
        '    ssl_certificate     /certs/cert.pem;',
        '    ssl_certificate_key /certs/key.pem;',
        '    root /usr/share/nginx/html;',
        '    index index.html;',
        '    location / {',
        '        try_files $uri $uri/ /index.html;',
        '    }',
        '}',
      ].join('\n') + '\n'
    await writeFile(nginxConfPath, nginxConf)
    await chmod(nginxConfPath, 0o644)

    ctx.broadcast(
      SERVICE_NAMES.MESHCORE_WEB,
      'preinstall',
      `MeshCore Web HTTPS certificate and config are ready.`
    )
  } catch (error: any) {
    ctx.broadcast(
      SERVICE_NAMES.MESHCORE_WEB,
      'preinstall-error',
      `Failed to prepare MeshCore Web: ${error.message}`
    )
    throw new Error(`Pre-install action failed: ${error.message}`)
  }
}

export async function runPreinstallActions__Jellyfin(ctx: DockerCtx): Promise<void> {
  const mediaDir = join(process.cwd(), MEDIA_STORAGE_PATH)

  ctx.broadcast(SERVICE_NAMES.JELLYFIN, 'preinstall', `Running pre-install actions for Jellyfin...`)

  try {
    await mkdir(mediaDir, { recursive: true })
    for (const name of JELLYFIN_MEDIA_SUBFOLDERS) {
      await mkdir(join(mediaDir, name), { recursive: true })
    }
    ctx.broadcast(
      SERVICE_NAMES.JELLYFIN,
      'preinstall',
      `Prepared media folders: ${JELLYFIN_MEDIA_SUBFOLDERS.join(', ')}.`
    )
  } catch (error: any) {
    ctx.broadcast(
      SERVICE_NAMES.JELLYFIN,
      'preinstall-error',
      `Failed to prepare the Jellyfin media folders: ${error.message}`
    )
    throw new Error(`Pre-install action failed: ${error.message}`)
  }
}

const COMFYUI_RUNPODDIRECT_REPO = 'https://github.com/MadiatorLabs/ComfyUI-RunpodDirect.git'

export async function runPreinstallActions__Comfyui(ctx: DockerCtx): Promise<void> {
  const customNodesDir = join(process.cwd(), COMFYUI_STORAGE_PATH, 'custom_nodes')
  const targetDir = join(customNodesDir, 'ComfyUI-RunpodDirect')

  ctx.broadcast(
    SERVICE_NAMES.COMFYUI,
    'preinstall',
    `Running pre-install actions for Image Studio...`
  )

  try {
    await mkdir(customNodesDir, { recursive: true })

    const existing = await readdir(targetDir).catch(() => null)
    if (existing && existing.length > 0) {
      ctx.broadcast(
        SERVICE_NAMES.COMFYUI,
        'preinstall',
        `ComfyUI-RunpodDirect already present — updating via git pull...`
      )
      await execAsync('git pull', { cwd: targetDir })
      ctx.broadcast(SERVICE_NAMES.COMFYUI, 'preinstall', `ComfyUI-RunpodDirect updated to latest.`)
      return
    }

    ctx.broadcast(
      SERVICE_NAMES.COMFYUI,
      'preinstall',
      `Cloning ComfyUI-RunpodDirect custom node...`
    )
    await execAsync(`git clone ${COMFYUI_RUNPODDIRECT_REPO} "${targetDir}"`)
    ctx.broadcast(
      SERVICE_NAMES.COMFYUI,
      'preinstall',
      `Cloned ComfyUI-RunpodDirect into custom_nodes.`
    )
  } catch (error: any) {
    ctx.broadcast(
      SERVICE_NAMES.COMFYUI,
      'preinstall-error',
      `Failed to set up ComfyUI-RunpodDirect: ${error.message}`
    )
    throw new Error(`Pre-install action failed: ${error.message}`)
  }
}
