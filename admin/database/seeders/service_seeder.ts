import Service from '#models/service'
import { BaseSeeder } from '@adonisjs/lucid/seeders'
import { ModelAttributes } from '@adonisjs/lucid/types/model'
import env from '#start/env'
import { SERVICE_NAMES } from '../../constants/service_names.js'
import { KIWIX_LIBRARY_CMD } from '../../constants/kiwix.js'

type ServiceSeedRecord = Omit<
  ModelAttributes<Service>,
  | 'created_at'
  | 'updated_at'
  | 'id'
  | 'available_update_version'
  | 'update_checked_at'
  | 'metadata'
  | 'is_user_modified'
  | 'is_deprecated'
  | 'custom_url'
  | 'auto_update_enabled'
  | 'available_update_first_seen_at'
  | 'auto_update_consecutive_failures'
  | 'auto_update_disabled_reason'
> & { metadata?: string | null }

export default class ServiceSeeder extends BaseSeeder {
  // Use environment variable with fallback to production default
  private static NOMAD_STORAGE_ABS_PATH = env.get(
    'NOMAD_STORAGE_PATH',
    '/opt/project-nomad/storage'
  )
  private static DEFAULT_SERVICES: ServiceSeedRecord[] = [
    // ── Core / original services ──────────────────────────────────────────────
    {
      service_name: SERVICE_NAMES.KIWIX,
      friendly_name: 'Information Library',
      powered_by: 'Kiwix',
      display_order: 1,
      description:
        'Offline access to Wikipedia, medical references, how-to guides, and encyclopedias',
      icon: 'IconBooks',
      container_image: 'ghcr.io/kiwix/kiwix-serve:3.8.1',
      source_repo: 'https://github.com/kiwix/kiwix-tools',
      container_command: KIWIX_LIBRARY_CMD,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/zim:/data`],
          PortBindings: { '8080/tcp': [{ HostPort: '8090' }] },
        },
        ExposedPorts: { '8080/tcp': {} },
      }),
      ui_location: '8090',
      ui_path: '/kiwix',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'education',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.QDRANT,
      friendly_name: 'Qdrant Vector Database',
      powered_by: null,
      display_order: 100,
      description: 'Vector database for storing and searching embeddings',
      icon: 'IconRobot',
      container_image: 'qdrant/qdrant:v1.16',
      source_repo: 'https://github.com/qdrant/qdrant',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/qdrant:/qdrant/storage`],
          PortBindings: { '6333/tcp': [{ HostPort: '6333' }], '6334/tcp': [{ HostPort: '6334' }] },
        },
        ExposedPorts: { '6333/tcp': {}, '6334/tcp': {} },
        // Disable anonymous telemetry — NOMAD is offline-first
        Env: ['QDRANT__TELEMETRY_DISABLED=true'],
      }),
      ui_location: '6333',
      ui_path: null,
      installed: false,
      installation_status: 'idle',
      is_dependency_service: true,
      is_custom: false,
      category: null,
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.OLLAMA,
      friendly_name: 'AI Assistant',
      powered_by: 'Ollama',
      display_order: 0,
      description: 'Local AI chat that runs entirely on your hardware - no internet required',
      icon: 'IconWand',
      container_image: 'ollama/ollama:0.24.0',
      source_repo: 'https://github.com/ollama/ollama',
      container_command: 'serve',
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/ollama:/root/.ollama`],
          PortBindings: { '11434/tcp': [{ HostPort: '11434' }] },
        },
        ExposedPorts: { '11434/tcp': {} },
      }),
      ui_location: '/chat',
      ui_path: null,
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'ai',
      depends_on: SERVICE_NAMES.QDRANT,
    },
    {
      service_name: SERVICE_NAMES.CYBERCHEF,
      friendly_name: 'Data Tools',
      powered_by: 'CyberChef',
      display_order: 11,
      description: 'Swiss Army knife for data encoding, encryption, and analysis',
      icon: 'IconChefHat',
      container_image: 'ghcr.io/gchq/cyberchef:10.24.0',
      source_repo: 'https://github.com/gchq/CyberChef',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '80/tcp': [{ HostPort: '8100' }] },
        },
        ExposedPorts: { '80/tcp': {} },
      }),
      ui_location: '8100',
      ui_path: '/cyberchef',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'utility',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.FLATNOTES,
      friendly_name: 'Notes',
      powered_by: 'FlatNotes',
      display_order: 10,
      description: 'Simple note-taking app with local storage',
      icon: 'IconNotes',
      container_image: 'dullage/flatnotes:v5.5.4',
      source_repo: 'https://github.com/dullage/flatnotes',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '8080/tcp': [{ HostPort: '8200' }] },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/flatnotes:/data`],
        },
        ExposedPorts: { '8080/tcp': {} },
        Env: ['FLATNOTES_AUTH_TYPE=none'],
      }),
      ui_location: '8200',
      ui_path: '/flatnotes',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'productivity',
      depends_on: null,
    },
    {
      // "Kolibri Gen 2" — the upstream-official learningequality image replacing the ~6-year-old
      // community treehouses/kolibri:0.12.8. This is a distinct catalog entry (own service_name,
      // volume, and ports), not an in-place upgrade: the new image uses a different repo, mounts at
      // /kolibri instead of /root/.kolibri, and crosses 7 minor versions of Kolibri's own data
      // schema. Existing 0.12.8 installs are sunset via the deprecate-legacy-kolibri migration and
      // keep running on 8300 until uninstalled; content is re-imported into the fresh Gen 2 install.
      service_name: SERVICE_NAMES.KOLIBRI_GEN2,
      friendly_name: 'Education Platform (Gen 2)',
      powered_by: 'Kolibri',
      display_order: 2,
      description: 'Interactive learning platform with video courses and exercises',
      icon: 'IconSchool',
      container_image: 'learningequality/kolibri:0.19.4',
      source_repo: 'https://github.com/learningequality/kolibri',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          // 8080 = web UI. 8311 = zip-content server (interactive exercises / HTML5 apps), served
          // from a separate "alternate origin" the browser connects to DIRECTLY. KOLIBRI_ZIP_CONTENT_PORT
          // sets the port Kolibri both LISTENS on inside the container AND advertises in content URLs,
          // so the internal port, the published host port, and that env value must all be identical
          // (8311) — otherwise content URLs point at a host port that doesn't route to the listener
          // and every content page fails with ERR_CONNECTION_REFUSED. The image's default 8081 is
          // unused here. The image refuses to start without /kolibri mounted (KOLIBRI_HOME = /kolibri).
          PortBindings: { '8080/tcp': [{ HostPort: '8310' }], '8311/tcp': [{ HostPort: '8311' }] },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/kolibri-gen2:/kolibri`],
        },
        ExposedPorts: { '8080/tcp': {}, '8311/tcp': {} },
        Env: ['KOLIBRI_ZIP_CONTENT_PORT=8311'],
      }),
      ui_location: '8310',
      ui_path: '/kolibri',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'education',
      depends_on: null,
    },

    // ── Supply Depot — curated catalog (ports 8400–8499) ─────────────────────

    {
      service_name: SERVICE_NAMES.STIRLING_PDF,
      friendly_name: 'Stirling PDF',
      powered_by: 'Stirling-Tools',
      display_order: 20,
      description:
        'Locally-hosted PDF manipulation tool — merge, split, compress, convert, and more',
      icon: 'IconFileDescription',
      container_image: 'ghcr.io/stirling-tools/s-pdf:2.13.1',
      source_repo: 'https://github.com/Stirling-Tools/Stirling-PDF',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '8080/tcp': [{ HostPort: '8400' }] },
          Binds: [
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/stirling-pdf/configs:/configs`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/stirling-pdf/logs:/logs`,
          ],
        },
        ExposedPorts: { '8080/tcp': {} },
        // Stirling v2 ignores the old v1 `DOCKER_ENABLE_SECURITY` flag and ships with
        // `security.enableLogin: true` in settings.yml, so it boots behind a login wall.
        // For a single-user offline appliance we open it straight to the tools. Users who
        // want a login can flip this to `true` via Manage > Edit (env overrides settings.yml).
        Env: ['SECURITY_ENABLELOGIN=false', 'LANGS=en_GB'],
      }),
      ui_location: '8400',
      ui_path: '/stirling-pdf',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'productivity',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.FILEBROWSER,
      friendly_name: 'File Browser',
      powered_by: 'FileBrowser',
      display_order: 21,
      description:
        'Web-based file manager — browse, upload, download, and organize files on your device',
      icon: 'IconFolderOpen',
      container_image: 'filebrowser/filebrowser:v2',
      source_repo: 'https://github.com/filebrowser/filebrowser',
      // Browsable root is storage/filebrowser/files (persistent, so files created at the top level
      // survive updates), with the user-facing content folders mounted in beneath it. We deliberately
      // do NOT mount the sensitive/app-internal folders (vaultwarden, ollama, qdrant, logs, other
      // apps' config + *.db). They simply aren't present in the container, so they can't be browsed,
      // downloaded, or deleted — this is the guardrail. FileBrowser's own rules feature would need a
      // wrapper script / imported config shipped into the container, which the catalog model doesn't
      // support, so mount selection is how we scope visibility. To expose another content folder,
      // add a `${STORAGE}/<folder>:/srv/<folder>` bind here.
      // The DB lives in storage/filebrowser/db (mounted at /db, a SIBLING of the root, not under it)
      // so FileBrowser's own .filebrowser.db never shows up in the user's file listing. User: root so
      // it can read/write folders owned by other UIDs.
      container_command: '--root /srv --database /db/.filebrowser.db',
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '80/tcp': [{ HostPort: '8410' }] },
          Binds: [
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/filebrowser/files:/srv`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/filebrowser/db:/db`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/books:/srv/books`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/maps:/srv/maps`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/media:/srv/media`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/kb_uploads:/srv/kb_uploads`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/zim:/srv/zim`,
          ],
        },
        ExposedPorts: { '80/tcp': {} },
        // Without an initial password FileBrowser generates a random one and prints it only to
        // the container logs, which a non-technical user can't reach. Seed a known admin/nomad
        // login on first run instead (only applies when the DB doesn't exist yet); the docs tell
        // users to change it. FB_NOAUTH / --noauth don't work on this image (v2.63.x), so a login
        // stays, which is the safer default anyway for a read/write/delete file manager.
        // NOTE: FB_PASSWORD must be a bcrypt hash, not plaintext. The value below is the hash of
        // "nomad" (generated via `filebrowser hash nomad`). Login is admin / nomad.
        Env: [
          'FB_USERNAME=admin',
          'FB_PASSWORD=$2a$10$Dvu3XTiLxvPTzvdOKu6y6.AmadN6Zt0ddLwK.8MQ.RCIQWunWBQXa',
        ],
        User: 'root',
      }),
      ui_location: '8410',
      ui_path: '/filebrowser',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'utility',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.CALIBREWEB,
      friendly_name: 'Calibre Web',
      powered_by: 'Calibre-Web',
      display_order: 22,
      description: 'Web-based e-book reader and library manager for your Calibre collection',
      icon: 'IconBook',
      container_image: 'linuxserver/calibre-web:0.6.26-ls386',
      source_repo: 'https://github.com/janeczku/calibre-web',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '8083/tcp': [{ HostPort: '8420' }] },
          Binds: [
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/calibreweb/config:/config`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/books:/books`,
          ],
        },
        ExposedPorts: { '8083/tcp': {} },
        Env: ['PUID=1000', 'PGID=1000'],
      }),
      ui_location: '8420',
      ui_path: '/calibre-web',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'media',
      depends_on: null,
      metadata: JSON.stringify({ minMemoryMB: 512, minDiskMB: 5120 }),
    },
    {
      service_name: SERVICE_NAMES.IT_TOOLS,
      friendly_name: 'IT Tools',
      powered_by: 'IT-Tools',
      display_order: 23,
      description:
        'Collection of handy utilities for developers — UUID, hash, encoding, formatters, and more',
      icon: 'IconTool',
      container_image: 'ghcr.io/corentinth/it-tools:2024.10.22-7ca5933',
      source_repo: 'https://github.com/CorentinTh/it-tools',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '80/tcp': [{ HostPort: '8430' }] },
        },
        ExposedPorts: { '80/tcp': {} },
      }),
      ui_location: '8430',
      ui_path: '/it-tools',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'utility',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.EXCALIDRAW,
      friendly_name: 'Excalidraw',
      powered_by: 'Excalidraw',
      display_order: 24,
      description:
        'Virtual whiteboard for sketching hand-drawn-style diagrams — works fully offline',
      icon: 'IconPencil',
      container_image: 'excalidraw/excalidraw:sha-4bfc5bb',
      source_repo: 'https://github.com/excalidraw/excalidraw',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '80/tcp': [{ HostPort: '8440' }] },
        },
        ExposedPorts: { '80/tcp': {} },
      }),
      ui_location: '8440',
      ui_path: '/excalidraw',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'productivity',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.MESHTASTIC_WEB,
      friendly_name: 'Meshtastic Web',
      powered_by: 'Meshtastic',
      display_order: 30,
      description: 'Browser-based client for managing Meshtastic mesh radio devices',
      icon: 'IconWifi',
      container_image: 'ghcr.io/meshtastic/web:2.7.1',
      source_repo: 'https://github.com/meshtastic/web',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          // meshtastic/web serves on 8080 inside the container, not 80.
          PortBindings: { '8080/tcp': [{ HostPort: '8450' }] },
        },
        ExposedPorts: { '8080/tcp': {} },
      }),
      ui_location: '8450',
      ui_path: '/meshtastic',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'networking',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.MESHCORE_WEB,
      friendly_name: 'MeshCore Web',
      powered_by: 'MeshCore',
      display_order: 32,
      description: 'Browser-based client for MeshCore mesh radio devices',
      icon: 'IconAntenna',
      // aXistem's prebuilt image of Liam Cottle's MeshCore web client (MeshCore is a sibling LoRa
      // mesh project to Meshtastic).
      container_image: 'ghcr.io/axistem-dev/meshcore-web:v1.45.0',
      source_repo: 'https://github.com/aXistem-dev/meshcore-web',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          // The image is stock nginx:alpine serving the Flutter build over HTTP on 80. MeshCore's
          // client reaches a radio via Web Bluetooth / Web Serial, which browsers only permit from a
          // secure (HTTPS) context — so we serve it over HTTPS. _runPreinstallActions__MeshCoreWeb
          // writes a self-signed cert + an SSL server config into storage/meshcore-web; we bind both
          // in (the config over the image's default.conf) and publish 443. The https: prefix on
          // ui_location builds an https:// Open link (one-time cert warning, same as Vaultwarden).
          PortBindings: { '443/tcp': [{ HostPort: '8500' }] },
          Binds: [
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/meshcore-web/nginx-ssl.conf:/etc/nginx/conf.d/default.conf:ro`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/meshcore-web/certs:/certs:ro`,
          ],
        },
        ExposedPorts: { '443/tcp': {} },
      }),
      ui_location: 'https:8500',
      ui_path: '/meshcore',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'networking',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.HOMEBOX,
      friendly_name: 'Homebox',
      powered_by: 'Homebox',
      display_order: 25,
      description: 'Home inventory and asset management — track everything you own',
      icon: 'IconBox',
      // Maintained fork. The original hay-kot/homebox was archived June 2024;
      // sysadminsmedia is the official continuation (drop-in: same 7745 port + /data volume,
      // migrates an existing DB forward, telemetry off by default).
      container_image: 'ghcr.io/sysadminsmedia/homebox:0.26.2',
      source_repo: 'https://github.com/sysadminsmedia/homebox',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '7745/tcp': [{ HostPort: '8470' }] },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/homebox:/data`],
        },
        ExposedPorts: { '7745/tcp': {} },
      }),
      ui_location: '8470',
      ui_path: '/homebox',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'productivity',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.VAULTWARDEN,
      friendly_name: 'Vaultwarden',
      powered_by: 'Vaultwarden',
      display_order: 26,
      description:
        'Lightweight Bitwarden-compatible password manager server — secure your credentials offline',
      icon: 'IconShieldLock',
      container_image: 'vaultwarden/server:1.36.0',
      source_repo: 'https://github.com/dani-garcia/vaultwarden',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '80/tcp': [{ HostPort: '8480' }] },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/vaultwarden:/data`],
        },
        ExposedPorts: { '80/tcp': {} },
        // ROCKET_TLS points at the self-signed cert generated on install by
        // DockerService._runPreinstallActions__Vaultwarden. Vaultwarden's web vault needs a secure
        // context (HTTPS) or it refuses to register/unlock, so it ships HTTPS-on-by-default.
        Env: ['WEBSOCKET_ENABLED=true', 'ROCKET_TLS={certs="/data/cert.pem",key="/data/key.pem"}'],
      }),
      // https: prefix tells getServiceLink to build an https:// Open link on this port.
      ui_location: 'https:8480',
      ui_path: '/vaultwarden',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'security',
      depends_on: null,
      metadata: JSON.stringify({ minMemoryMB: 256, minDiskMB: 512 }),
    },
    {
      service_name: SERVICE_NAMES.JELLYFIN,
      friendly_name: 'Jellyfin',
      powered_by: 'Jellyfin',
      display_order: 27,
      description: 'Open-source media server — stream your video, music, and photo libraries',
      icon: 'IconMovie',
      container_image: 'jellyfin/jellyfin:10.11.11',
      source_repo: 'https://github.com/jellyfin/jellyfin',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '8096/tcp': [{ HostPort: '8490' }] },
          Binds: [
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/jellyfin/config:/config`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/jellyfin/cache:/cache`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/media:/media`,
          ],
        },
        ExposedPorts: { '8096/tcp': {} },
      }),
      ui_location: '8490',
      ui_path: '/jellyfin',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'media',
      depends_on: null,
      metadata: JSON.stringify({ minMemoryMB: 2048, minDiskMB: 20480 }),
    },
    {
      service_name: SERVICE_NAMES.VPN,
      friendly_name: 'VPN Gateway',
      powered_by: 'Gluetun',
      display_order: 35,
      description:
        'Surfshark VPN client — encrypts traffic and bypasses geo-restrictions. Attach to Stremio from VPN Settings.',
      icon: 'IconShieldLock',
      container_image: 'qmcgaw/gluetun:v3.41.3',
      source_repo: 'https://github.com/qdm12/gluetun',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          CapAdd: ['NET_ADMIN'],
          Devices: [
            {
              PathOnHost: '/dev/net/tun',
              PathInContainer: '/dev/net/tun',
              CgroupPermissions: 'rwm',
            },
          ],
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/vpn/gluetun:/gluetun`],
        },
        Env: ['VPN_SERVICE_PROVIDER=surfshark', 'VPN_TYPE=openvpn'],
      }),
      ui_location: null,
      ui_path: null,
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'networking',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.STREMIO,
      friendly_name: 'Stremio',
      powered_by: 'Stremio',
      display_order: 34,
      description:
        'Stream movies, TV shows, and live channels from community add-ons — your personal media center',
      icon: 'IconDeviceTv',
      container_image: 'tsaridas/stremio-docker:v1.3.10',
      source_repo: 'https://github.com/tsaridas/stremio-docker',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '8080/tcp': [{ HostPort: '8530' }] },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/stremio:/root/.stremio-server`],
        },
        ExposedPorts: { '8080/tcp': {} },
        Env: ['NO_CORS=1', 'AUTO_SERVER_URL=1', 'CASTING_DISABLED=1'],
      }),
      ui_location: '8530',
      ui_path: '/stremio',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'media',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.CODE_SERVER,
      friendly_name: 'Code Server',
      powered_by: 'code-server',
      display_order: 28,
      description:
        'Browser-based VS Code editor — work on code and files on your NOMAD from any device',
      icon: 'IconCode',
      container_image: 'codercom/code-server:4.132.0',
      source_repo: 'https://github.com/coder/code-server',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '8080/tcp': [{ HostPort: '8460' }] },
          Binds: [
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}:/home/coder/project`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/code-server:/home/coder/.local/share/code-server`,
          ],
        },
        ExposedPorts: { '8080/tcp': {} },
        Env: ['PASSWORD=nomad'],
      }),
      ui_location: '8460',
      ui_path: '/code',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'utility',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.VOICE_GATEWAY,
      friendly_name: 'Voice Gateway',
      powered_by: 'openWakeWord + faster-whisper',
      display_order: 29,
      description: 'Ambient wake-word listening and speech-to-text for the Voice Assistant',
      icon: 'IconMicrophone',
      container_image: 'registry.dasaroff.com/davearchetype/project-nomad-voice-gateway:1.0.0',
      source_repo: 'https://github.com/DaveArchetype/project-nomad',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/voice-gateway:/data`],
        },
        Env: [
          'WHISPER_MODEL_SIZE=base',
          'WHISPER_LANGUAGE=auto',
          'WAKE_WORD_PRESET=hey_jarvis',
          'WAKE_WORD_SENSITIVITY=0.5',
          'VAD_SENSITIVITY=2',
        ],
      }),
      ui_location: '/settings/voice',
      ui_path: null,
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'ai',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.TTS,
      friendly_name: 'Text-to-Speech',
      powered_by: 'Piper',
      display_order: 30,
      description: 'Local text-to-speech synthesis for chat replies and daily recaps',
      icon: 'IconVolume',
      container_image: 'registry.dasaroff.com/davearchetype/project-nomad-tts:1.0.0',
      source_repo: 'https://github.com/DaveArchetype/project-nomad',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/tts:/data`],
        },
        Env: ['DEFAULT_VOICE=en_US-lessac-medium'],
      }),
      ui_location: '/settings/voice',
      ui_path: null,
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'ai',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.SEARXNG,
      friendly_name: 'Web Search',
      powered_by: 'SearXNG',
      display_order: 31,
      description:
        'Privacy-respecting metasearch engine — powers the AI assistant live internet tools',
      icon: 'IconWorld',
      container_image: 'searxng/searxng:latest',
      source_repo: 'https://github.com/searxng/searxng',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '8080/tcp': [{ HostPort: '8510' }] },
          Binds: [`${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/searxng:/etc/searxng`],
        },
        ExposedPorts: { '8080/tcp': {} },
        Env: ['SEARXNG_BASE_URL=http://localhost:8510/', 'UWSGI_WORKERS=4'],
      }),
      ui_location: '8510',
      ui_path: '/searxng',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'utility',
      depends_on: null,
    },
    {
      service_name: SERVICE_NAMES.COMFYUI,
      friendly_name: 'Image Studio',
      powered_by: 'ComfyUI',
      display_order: 33,
      description:
        'Generate images from text prompts with node-based workflows — fully customizable and GPU-accelerated',
      icon: 'IconPhoto',
      container_image: 'yanwk/comfyui-boot:cu126-slim',
      source_repo: 'https://github.com/comfyanonymous/ComfyUI',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '8188/tcp': [{ HostPort: '8520' }] },
          Binds: [
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/comfyui/models:/root/ComfyUI/models`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/comfyui/input:/root/ComfyUI/input`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/comfyui/output:/root/ComfyUI/output`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/comfyui/custom_nodes:/root/ComfyUI/custom_nodes`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/comfyui/user:/root/ComfyUI/user`,
          ],
        },
        ExposedPorts: { '8188/tcp': {} },
      }),
      ui_location: '8520',
      ui_path: '/image-studio',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'ai',
      depends_on: null,
      metadata: JSON.stringify({ minMemoryMB: 4096, minDiskMB: 20480 }),
    },
    {
      service_name: SERVICE_NAMES.N8N,
      friendly_name: 'Automations',
      powered_by: 'n8n',
      display_order: 34,
      description:
        'Schedule and run AI prompts on a timer — powers the Automations feature with reusable workflows, tools, and chat delivery',
      icon: 'IconAutomation',
      container_image: 'n8nio/n8n:1.110.0',
      source_repo: 'https://github.com/n8n-io/n8n',
      container_command: null,
      container_config: JSON.stringify({
        HostConfig: {
          RestartPolicy: { Name: 'unless-stopped' },
          PortBindings: { '5678/tcp': [{ HostPort: '8540' }] },
          Binds: [
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/n8n/data:/home/node/.n8n`,
            `${ServiceSeeder.NOMAD_STORAGE_ABS_PATH}/n8n/custom-nodes:/custom-nodes`,
          ],
        },
        ExposedPorts: { '5678/tcp': {} },
        Env: [
          'N8N_HOST=0.0.0.0',
          'N8N_PORT=5678',
          'N8N_PROTOCOL=http',
          'WEBHOOK_URL=https://n8n.dasaorff.com/',
          'GENERIC_TIMEZONE=UTC',
          'N8N_CUSTOM_EXTENSIONS=/custom-nodes',
          'N8N_DIAGNOSTICS_ENABLED=false',
          'N8N_RUNNERS_ENABLED=true',
          'N8N_ENFORCE_SETTINGS_PERMISSIONS=false',
          'N8N_SECURE_COOKIE=false',
          'N8N_COMMUNITY_PACKAGES_ALLOW_TOOL_USAGE=true',
        ],
      }),
      ui_location: '8540',
      ui_path: '/n8n',
      installed: false,
      installation_status: 'idle',
      is_dependency_service: false,
      is_custom: false,
      category: 'productivity',
      depends_on: null,
      metadata: JSON.stringify({ minMemoryMB: 1024, minDiskMB: 1024 }),
    },
  ]

  async run() {
    const existingServices = await Service.query().select([
      'service_name',
      'is_custom',
      'is_user_modified',
    ])
    const existingServiceMap = new Map(existingServices.map((s) => [s.service_name, s]))

    const newServices = ServiceSeeder.DEFAULT_SERVICES.filter(
      (service) => !existingServiceMap.has(service.service_name)
    )

    if (newServices.length > 0) {
      await Service.createMany([...newServices])
    }

    // Keep curated services in sync with the catalog. Custom services are user-defined and must
    // never be overwritten. User-modified curated services (a user edited their config) are
    // likewise left alone so the edit survives reboots. ui_location/ui_path/display_order are
    // synced too so a catalog change to an app's link/scheme/port (e.g. Vaultwarden moving to
    // https:8480, or a corrected internal port), its reverse-proxy subdomain slug, or its home
    // page position reaches existing non-modified installs on update, not just fresh ones.
    for (const service of ServiceSeeder.DEFAULT_SERVICES) {
      const existing = existingServiceMap.get(service.service_name)
      if (existing && !existing.is_custom && !existing.is_user_modified) {
        await Service.query()
          .where('service_name', service.service_name)
          .update({
            container_image: service.container_image,
            container_config: service.container_config,
            container_command: service.container_command ?? null,
            metadata: (service as any).metadata ?? null,
            category: service.category,
            ui_location: service.ui_location,
            ui_path: service.ui_path ?? null,
            display_order: service.display_order,
            depends_on: service.depends_on ?? null,
          })
      }
    }
  }
}
