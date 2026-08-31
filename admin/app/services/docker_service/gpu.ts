/* eslint-disable @unicorn/no-await-expression-member */
/* eslint-disable @unicorn/prefer-node-protocol */
import Docker from 'dockerode'
import { exec } from 'child_process'
import { promisify } from 'util'
import { readFile } from 'node:fs/promises'
import logger from '@adonisjs/core/services/logger'
import KVStore from '#models/kv_store'
import { mapGfxToHsaOverride } from '../../utils/amd_hsa_override.js'
import type { GpuDetectionResult, DockerDevice } from './types.js'

const execAsync = promisify(exec)

export async function detectGPUType(docker: Docker): Promise<GpuDetectionResult> {
  try {
    try {
      const dockerInfo = await docker.info()
      const runtimes = dockerInfo.Runtimes || {}
      if ('nvidia' in runtimes) {
        logger.info('[DockerService] NVIDIA container runtime detected via Docker API')
        await persistGPUType('nvidia')
        return { type: 'nvidia' }
      }
    } catch (error: any) {
      logger.warn(`[DockerService] Could not query Docker info for GPU runtimes: ${error.message}`)
    }

    try {
      const marker = (await readFile('/app/storage/.nomad-gpu-type', 'utf8')).trim()
      if (marker === 'nvidia') {
        logger.warn(
          '[DockerService] NVIDIA GPU recorded in marker file but NVIDIA Container Toolkit is not installed'
        )
        return { type: 'none', toolkitMissing: true }
      }
      if (marker === 'amd') {
        logger.info('[DockerService] AMD GPU detected via install-time marker file')
        await persistGPUType('amd')
        return { type: 'amd' }
      }
    } catch {
      // No marker file — fall through to lspci attempt for host-based installs
    }

    try {
      const { stdout: nvidiaCheck } = await execAsync('lspci 2>/dev/null | grep -i nvidia || true')
      if (nvidiaCheck.trim()) {
        logger.warn(
          '[DockerService] NVIDIA GPU detected via lspci but NVIDIA Container Toolkit is not installed'
        )
        return { type: 'none', toolkitMissing: true }
      }
    } catch (error: any) {
      // lspci not available (likely inside Docker container), continue
    }

    try {
      const { stdout: amdCheck } = await execAsync(
        'lspci 2>/dev/null | grep -iE "VGA|3D controller|Display" | grep -iE "amd|radeon" || true'
      )
      if (amdCheck.trim()) {
        logger.info('[DockerService] AMD GPU detected via lspci')
        await persistGPUType('amd')
        return { type: 'amd' }
      }
    } catch (error: any) {
      // lspci not available, continue
    }

    try {
      const savedType = await KVStore.getValue('gpu.type')
      if (savedType === 'nvidia' || savedType === 'amd') {
        logger.info(
          `[DockerService] No GPU detected live, but KV store has '${savedType}' from previous detection. Using saved value.`
        )
        return { type: savedType as 'nvidia' | 'amd' }
      }
    } catch {
      // KV store not available, continue
    }

    logger.info('[DockerService] No GPU detected')
    return { type: 'none' }
  } catch (error: any) {
    logger.warn(`[DockerService] Error detecting GPU type: ${error.message}`)
    return { type: 'none' }
  }
}

async function persistGPUType(type: 'nvidia' | 'amd'): Promise<void> {
  try {
    await KVStore.setValue('gpu.type', type)
    logger.info(`[DockerService] Persisted GPU type '${type}' to KV store`)
  } catch (error: any) {
    logger.warn(`[DockerService] Failed to persist GPU type: ${error.message}`)
  }
}

export async function resolveAmdHsaOverride(): Promise<string | null> {
  const manualRaw = await KVStore.getValue('ai.amdHsaOverride')
  if (manualRaw !== null && manualRaw !== undefined && String(manualRaw).trim() !== '') {
    const manual = String(manualRaw).trim().toLowerCase()
    if (manual === 'none' || manual === 'off' || manual === 'false') {
      logger.info('[DockerService] HSA override disabled via ai.amdHsaOverride')
      return null
    }
    if (/^\d+\.\d+\.\d+$/.test(manual)) {
      logger.info(`[DockerService] HSA override forced to ${manual} via ai.amdHsaOverride`)
      return manual
    }
    logger.warn(`[DockerService] Ignoring invalid ai.amdHsaOverride value: ${manualRaw}`)
  }

  try {
    const gfx = (await readFile('/app/storage/.nomad-amd-gfx', 'utf8')).trim()
    const mapped = mapGfxToHsaOverride(gfx)
    logger.info(`[DockerService] AMD gfx marker '${gfx}' → HSA override ${mapped ?? 'none'}`)
    return mapped
  } catch {
    // Marker absent — most likely an existing install upgraded without re-running
    // install_nomad.sh. Fall through to the default.
  }

  logger.warn(
    '[DockerService] AMD GPU configured but no gfx marker (/app/storage/.nomad-amd-gfx) and no ' +
      'ai.amdHsaOverride KV; relying on native ROCm discovery. iGPUs not on the bundled rocblas ' +
      'allowlist (e.g. 780M/gfx1103, 680M/gfx1035) will silently fall back to CPU. Set the ' +
      'ai.amdHsaOverride KV (e.g. 11.0.0 for a 780M) and force-reinstall the AI service if so.'
  )
  return null
}

export async function discoverAMDDevices(): Promise<DockerDevice[]> {
  return [
    { PathOnHost: '/dev/kfd', PathInContainer: '/dev/kfd', CgroupPermissions: 'rwm' },
    { PathOnHost: '/dev/dri', PathInContainer: '/dev/dri', CgroupPermissions: 'rwm' },
  ]
}
