export const COMFYUI_SERVICE_PORT = '8188'

export const COMFYUI_GENERATION_TIMEOUT_MS = 180_000
export const COMFYUI_POLL_INTERVAL_MS = 1_000

export const COMFYUI_DEFAULT_WIDTH = 1024
export const COMFYUI_DEFAULT_HEIGHT = 1024
export const COMFYUI_DEFAULT_STEPS = 25
export const COMFYUI_DEFAULT_CFG = 7
export const COMFYUI_DEFAULT_SAMPLER = 'euler'
export const COMFYUI_DEFAULT_SCHEDULER = 'normal'
export const COMFYUI_DEFAULT_NEGATIVE_PROMPT = ''

export const COMFYUI_CHAT_WORKFLOW_OVERRIDE_REL = 'storage/comfyui/chat_workflow_api.json'

export const COMFYUI_NODE_IDS = {
  checkpoint: '4',
  positive: '6',
  negative: '7',
  latent: '5',
  sampler: '3',
  save: '9',
} as const

export const COMFYUI_DEFAULT_CHAT_WORKFLOW: Record<string, any> = {
  '3': {
    class_type: 'KSampler',
    inputs: {
      cfg: COMFYUI_DEFAULT_CFG,
      denoise: 1,
      latent_image: ['5', 0],
      model: ['4', 0],
      negative: ['7', 0],
      positive: ['6', 0],
      sampler_name: COMFYUI_DEFAULT_SAMPLER,
      scheduler: COMFYUI_DEFAULT_SCHEDULER,
      seed: 0,
      steps: COMFYUI_DEFAULT_STEPS,
    },
  },
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: '',
    },
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: {
      batch_size: 1,
      height: COMFYUI_DEFAULT_HEIGHT,
      width: COMFYUI_DEFAULT_WIDTH,
    },
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['4', 1],
      text: '',
    },
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: {
      clip: ['4', 1],
      text: COMFYUI_DEFAULT_NEGATIVE_PROMPT,
    },
  },
  '8': {
    class_type: 'VAEDecode',
    inputs: {
      samples: ['3', 0],
      vae: ['4', 2],
    },
  },
  '9': {
    class_type: 'SaveImage',
    inputs: {
      filename_prefix: 'nomad_chat',
    },
  },
}
