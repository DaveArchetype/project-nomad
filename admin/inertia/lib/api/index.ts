import { AxiosInstance } from 'axios'
import { createApiClient } from './client'
import { OllamaChatRequest } from '../../../types/ollama'
import type { CountryCode } from '../../../types/maps'
import type { ResourceUpdateInfo } from '../../../types/collections'
import * as system from './system'
import * as chat from './chat'
import * as rag from './rag'
import * as maps from './maps'
import * as zim from './zim'
import * as collections from './collections'
import * as voice from './voice'
import * as docs from './docs'
import * as automations from './automations'

class API {
  private client: AxiosInstance = createApiClient()

  // System / services / settings
  affectService = (service_name: string, action: 'start' | 'stop' | 'restart') =>
    system.affectService(this.client, service_name, action)
  checkServiceUpdates = () => system.checkServiceUpdates(this.client)
  getAvailableVersions = (serviceName: string) =>
    system.getAvailableVersions(this.client, serviceName)
  updateService = (serviceName: string, targetVersion: string) =>
    system.updateService(this.client, serviceName, targetVersion)
  forceReinstallService = (service_name: string) =>
    system.forceReinstallService(this.client, service_name)
  getDebugInfo = () => system.getDebugInfo(this.client)
  getInternetStatus = () => system.getInternetStatus(this.client)
  getSystemInfo = () => system.getSystemInfo(this.client)
  getSystemServices = () => system.getSystemServices(this.client)
  getAppAutoUpdateStatus = () => system.getAppAutoUpdateStatus(this.client)
  getContentAutoUpdateStatus = () => system.getContentAutoUpdateStatus(this.client)
  setServiceAutoUpdate = (serviceName: string, enabled: boolean) =>
    system.setServiceAutoUpdate(this.client, serviceName, enabled)
  healthCheck = () => system.healthCheck(this.client)
  installService = (service_name: string) => system.installService(this.client, service_name)
  getSetting = (key: string) => system.getSetting(this.client, key)
  updateSetting = (key: string, value: any) => system.updateSetting(this.client, key, value)
  getVpnCountries = () => system.getVpnCountries(this.client)
  testVpn = () => system.testVpn(this.client)
  testStremioVpn = () => system.testStremioVpn(this.client)
  preflightCheck = (service_name: string) => system.preflightCheck(this.client, service_name)
  suggestCustomPort = () => system.suggestCustomPort(this.client)
  preflightCustomApp = (payload: {
    image?: string
    ports?: number[]
    volumes?: Array<{ host_path: string; container_path: string }>
    exclude_service?: string
  }) => system.preflightCustomApp(this.client, payload)
  createCustomApp = (payload: {
    friendly_name: string
    image: string
    ports?: Array<{ container: number; host: number }>
    volumes?: Array<{ host_path: string; container_path: string }>
    env?: string[]
    category?: string
    icon?: string
    memory_mb?: number
    cpus?: number
    force?: boolean
  }) => system.createCustomApp(this.client, payload)
  setServiceCustomUrl = (service_name: string, custom_url: string | null) =>
    system.setServiceCustomUrl(this.client, service_name, custom_url)
  deleteCustomApp = (service_name: string, remove_image = false) =>
    system.deleteCustomApp(this.client, service_name, remove_image)
  uninstallService = (service_name: string, remove_image = false) =>
    system.uninstallService(this.client, service_name, remove_image)
  updateCustomAppImage = (service_name: string) =>
    system.updateCustomAppImage(this.client, service_name)
  getServiceLogs = (service_name: string, tail = 200) =>
    system.getServiceLogs(this.client, service_name, tail)
  getServiceStats = (service_name: string) => system.getServiceStats(this.client, service_name)
  getCustomApp = (service_name: string) => system.getCustomApp(this.client, service_name)
  updateCustomApp = (payload: {
    service_name: string
    friendly_name: string
    image: string
    ports?: Array<{ container: number; host: number }>
    volumes?: Array<{ host_path: string; container_path: string }>
    env?: string[]
    category?: string
    icon?: string
    memory_mb?: number
    cpus?: number
    force?: boolean
  }) => system.updateCustomApp(this.client, payload)

  // Ollama / chat
  getRemoteOllamaStatus = () => chat.getRemoteOllamaStatus(this.client)
  getImageGenStatus = () => chat.getImageGenStatus(this.client)
  configureRemoteOllama = (remoteUrl: string | null) =>
    chat.configureRemoteOllama(this.client, remoteUrl)
  deleteModel = (model: string) => chat.deleteModel(this.client, model)
  downloadModel = (model: string) => chat.downloadModel(this.client, model)
  getInstalledModels = () => chat.getInstalledModels(this.client)
  unloadChatModels = (targetModel: string | null, vramAware?: boolean) =>
    chat.unloadChatModels(this.client, targetModel, vramAware)
  ensureTeiStarted = () => chat.ensureTeiStarted(this.client)
  getAvailableModels = (params: {
    query?: string
    recommendedOnly?: boolean
    limit?: number
    force?: boolean
    sort?: 'pulls' | 'name' | 'recent'
  }) => chat.getAvailableModels(this.client, params)
  sendChatMessage = (chatRequest: OllamaChatRequest) =>
    chat.sendChatMessage(this.client, chatRequest)
  streamChatMessage = (
    chatRequest: OllamaChatRequest,
    onChunk: (content: string, thinking: string, done: boolean) => void,
    signal?: AbortSignal,
    onSources?: (
      sources: Array<{
        source: string
        title: string
        contentType?: string
        score?: number
        snippet: string
        kiwixPath?: string
        url?: string
      }>
    ) => void,
    onToolStep?: (step: {
      tool: string
      step: 'start' | 'end' | 'error'
      input?: Record<string, any>
      output?: string
      error?: string
    }) => void,
    onImages?: (images: string[]) => void
  ) => chat.streamChatMessage(chatRequest, onChunk, signal, onSources, onToolStep, onImages)
  getChatSuggestions = (signal?: AbortSignal) => chat.getChatSuggestions(this.client, signal)
  getChatSessions = () => chat.getChatSessions(this.client)
  getChatSession = (sessionId: string) => chat.getChatSession(this.client, sessionId)
  createChatSession = (title: string, model?: string) =>
    chat.createChatSession(this.client, title, model)
  updateChatSession = (sessionId: string, data: { title?: string; model?: string }) =>
    chat.updateChatSession(this.client, sessionId, data)
  deleteChatSession = (sessionId: string) => chat.deleteChatSession(this.client, sessionId)
  deleteAllChatSessions = () => chat.deleteAllChatSessions(this.client)
  addChatMessage = (sessionId: string, role: 'system' | 'user' | 'assistant', content: string) =>
    chat.addChatMessage(this.client, sessionId, role, content)
  getNomadMd = () => chat.getNomadMd(this.client)
  saveNomadMd = (content: string) => chat.saveNomadMd(this.client, content)

  // RAG / knowledge base
  getActiveEmbedJobs = () => rag.getActiveEmbedJobs(this.client)
  getFailedEmbedJobs = () => rag.getFailedEmbedJobs(this.client)
  cleanupFailedEmbedJobs = () => rag.cleanupFailedEmbedJobs(this.client)
  cancelAllEmbedJobs = () => rag.cancelAllEmbedJobs(this.client)
  resumeEmbedJob = (jobId: string) => rag.resumeEmbedJob(this.client, jobId)
  pauseAllEmbedJobs = () => rag.pauseAllEmbedJobs(this.client)
  resumeAllEmbedJobs = () => rag.resumeAllEmbedJobs(this.client)
  pauseEmbedJob = (jobId: string) => rag.pauseEmbedJob(this.client, jobId)
  resumePausedEmbedJob = (jobId: string) => rag.resumePausedEmbedJob(this.client, jobId)
  checkRAGHealth = () => rag.checkRAGHealth(this.client)
  getStoredRAGFiles = () => rag.getStoredRAGFiles(this.client)
  embedSingleRAGFile = (source: string, force: boolean = false) =>
    rag.embedSingleRAGFile(this.client, source, force)
  verifyRAGFile = (source: string) => rag.verifyRAGFile(this.client, source)
  resumeRAGFile = (source: string) => rag.resumeRAGFile(this.client, source)
  repairRAGFile = (source: string) => rag.repairRAGFile(this.client, source)
  repairAllRAGFiles = () => rag.repairAllRAGFiles(this.client)
  getKbFileWarnings = () => rag.getKbFileWarnings(this.client)
  deleteRAGFile = (source: string) => rag.deleteRAGFile(this.client, source)
  getFileContent = (source: string) => rag.getFileContent(this.client, source)
  getSourcePreviewImageUrl = (source: string, kiwixPath?: string, index?: number) =>
    rag.getSourcePreviewImageUrl(source, kiwixPath, index)
  syncRAGStorage = () => rag.syncRAGStorage(this.client)
  reembedAllRAG = () => rag.reembedAllRAG(this.client)
  resetAndRebuildRAG = () => rag.resetAndRebuildRAG(this.client)
  estimateEmbeddingBatch = (files: { filename: string; sizeBytes: number }[]) =>
    rag.estimateEmbeddingBatch(this.client, files)
  getKbPolicyPromptState = () => rag.getKbPolicyPromptState(this.client)
  uploadDocument = (file: File, collection?: string) =>
    rag.uploadDocument(this.client, file, collection)
  getKnowledgeCollections = () => rag.getKnowledgeCollections(this.client)
  updateFileCollection = (source: string, collection: string | null) =>
    rag.updateFileCollection(this.client, source, collection)
  renameCollection = (oldName: string, newName: string) =>
    rag.renameCollection(this.client, oldName, newName)
  deleteCollection = (name: string) => rag.deleteCollection(this.client, name)

  // Maps
  downloadBaseMapAssets = () => maps.downloadBaseMapAssets(this.client)
  setupWorldBasemap = () => maps.setupWorldBasemap(this.client)
  downloadMapCollection = (slug: string) => maps.downloadMapCollection(this.client, slug)
  downloadRemoteMapRegion = (url: string) => maps.downloadRemoteMapRegion(this.client, url)
  downloadRemoteMapRegionPreflight = (url: string) =>
    maps.downloadRemoteMapRegionPreflight(this.client, url)
  deleteMapRegionFile = (filename: string) => maps.deleteMapRegionFile(this.client, filename)
  fetchLatestMapCollections = () => maps.fetchLatestMapCollections(this.client)
  getGlobalMapInfo = () => maps.getGlobalMapInfo(this.client)
  downloadGlobalMap = () => maps.downloadGlobalMap(this.client)
  listCountries = () => maps.listCountries(this.client)
  listCountryGroups = () => maps.listCountryGroups(this.client)
  extractMapPreflight = (params: { countries: CountryCode[]; maxzoom?: number }) =>
    maps.extractMapPreflight(this.client, params)
  extractMapRegion = (params: {
    countries: CountryCode[]
    maxzoom?: number
    label?: string
    estimatedBytes?: number
  }) => maps.extractMapRegion(this.client, params)
  listCuratedMapCollections = () => maps.listCuratedMapCollections(this.client)
  listMapRegionFiles = () => maps.listMapRegionFiles(this.client)
  listMapMarkers = () => maps.listMapMarkers(this.client)
  createMapMarker = (data: {
    name: string
    longitude: number
    latitude: number
    color?: string
    notes?: string | null
  }) => maps.createMapMarker(this.client, data)
  updateMapMarker = (id: number, data: { name?: string; color?: string }) =>
    maps.updateMapMarker(this.client, id, data)
  deleteMapMarker = (id: number) => maps.deleteMapMarker(this.client, id)

  // ZIM / downloads / Wikipedia
  downloadRemoteZimFile = (
    url: string,
    metadata?: { title: string; summary?: string; author?: string; size_bytes?: number }
  ) => zim.downloadRemoteZimFile(this.client, url, metadata)
  downloadCategoryTier = (categorySlug: string, tierSlug: string) =>
    zim.downloadCategoryTier(this.client, categorySlug, tierSlug)
  listRemoteZimFiles = (params: { start?: number; count?: number; query?: string }) =>
    zim.listRemoteZimFiles(this.client, params)
  listCustomLibraries = () => zim.listCustomLibraries(this.client)
  addCustomLibrary = (name: string, base_url: string) =>
    zim.addCustomLibrary(this.client, name, base_url)
  removeCustomLibrary = (id: number) => zim.removeCustomLibrary(this.client, id)
  browseLibrary = (url: string) => zim.browseLibrary(this.client, url)
  deleteZimFile = (filename: string) => zim.deleteZimFile(this.client, filename)
  listZimFiles = () => zim.listZimFiles(this.client)
  rescanZimLibrary = () => zim.rescanZimLibrary(this.client)
  getWikipediaState = () => zim.getWikipediaState(this.client)
  selectWikipedia = (optionId: string) => zim.selectWikipedia(this.client, optionId)
  listDownloadJobs = (filetype?: string) => zim.listDownloadJobs(this.client, filetype)
  removeDownloadJob = (jobId: string) => zim.removeDownloadJob(this.client, jobId)
  cancelDownloadJob = (jobId: string) => zim.cancelDownloadJob(this.client, jobId)
  retryDownloadJob = (jobId: string) => zim.retryDownloadJob(this.client, jobId)

  // Collections / content updates / creator packs
  checkForContentUpdates = () => collections.checkForContentUpdates(this.client)
  applyContentUpdate = (update: ResourceUpdateInfo) =>
    collections.applyContentUpdate(this.client, update)
  applyAllContentUpdates = (updates: ResourceUpdateInfo[]) =>
    collections.applyAllContentUpdates(this.client, updates)
  refreshManifests = () => collections.refreshManifests(this.client)
  listCuratedCategories = () => collections.listCuratedCategories(this.client)
  getCreatorPacks = () => collections.getCreatorPacks(this.client)
  installCreatorPack = (id: string) => collections.installCreatorPack(this.client, id)
  uninstallCreatorPack = (id: string) => collections.uninstallCreatorPack(this.client, id)

  // Voice / TTS
  getVoiceStatus = () => voice.getVoiceStatus(this.client)
  getWakeWordPresets = () => voice.getWakeWordPresets(this.client)
  uploadWakeWordModel = (file: File) => voice.uploadWakeWordModel(this.client, file)
  deleteWakeWordModel = () => voice.deleteWakeWordModel(this.client)
  getTtsVoices = () => voice.getTtsVoices(this.client)
  downloadTtsVoice = (voiceName: string) => voice.downloadTtsVoice(this.client, voiceName)
  deleteTtsVoice = (voiceName: string) => voice.deleteTtsVoice(this.client, voiceName)
  uploadTtsVoice = (onnxFile: File, jsonFile: File) =>
    voice.uploadTtsVoice(this.client, onnxFile, jsonFile)
  getXttsVoices = () => voice.getXttsVoices(this.client)
  cloneXttsVoice = (name: string, file: File) => voice.cloneXttsVoice(this.client, name, file)
  deleteXttsVoice = (voiceName: string) => voice.deleteXttsVoice(this.client, voiceName)
  synthesizeSpeech = (text: string, voiceName?: string, speed?: number) =>
    voice.synthesizeSpeech(this.client, text, voiceName, speed)
  listRecaps = (limit = 30) => voice.listRecaps(this.client, limit)
  generateRecap = (date?: string) => voice.generateRecap(this.client, date)

  // Docs
  listDocs = () => docs.listDocs(this.client)

  // Automations
  listAutomations = () => automations.listAutomations(this.client)
  createAutomation = (input: automations.CreateAutomationInput) =>
    automations.createAutomation(this.client, input)
  updateAutomation = (id: string, input: Partial<automations.CreateAutomationInput>) =>
    automations.updateAutomation(this.client, id, input)
  deleteAutomation = (id: string) => automations.deleteAutomation(this.client, id)
  runAutomation = (id: string) => automations.runAutomation(this.client, id)
  listAutomationRuns = (id: string) => automations.listAutomationRuns(this.client, id)
  listAutomationTools = () => automations.listAutomationTools(this.client)
  getAutomationDefaultModel = () => automations.getAutomationDefaultModel(this.client)
  listAutomationChats = () => automations.listAutomationChats(this.client)
  getAutomationStatus = () => automations.getAutomationStatus(this.client)
  saveN8nApiKey = (apiKey: string) => automations.saveN8nApiKey(this.client, apiKey)
}

export default new API()
