import { useState } from 'react'
import { Head, Link, router } from '@inertiajs/react'
import { IconArrowLeft, IconSettings } from '@tabler/icons-react'

import MapsLayout from '~/layouts/MapsLayout'
import MapComponent from '~/components/maps/MapComponent'
import StyledButton from '~/components/StyledButton'
import Alert from '~/components/Alert'

import { FileEntry } from '../../types/files'

export default function Maps(props: {
  maps: { baseAssetsExist: boolean; worldBasemapExists: boolean; regionFiles: FileEntry[] }
}) {
  const [isHoveringUI, setIsHoveringUI] = useState(false)
  const [showMapCoordinates, setShowMapCoordinates] = useState(true)

  const alertMessage = !props.maps.baseAssetsExist
    ? 'The base map assets have not been installed. Please download them first to enable map functionality.'
    : !props.maps.worldBasemapExists
      ? 'The world base map has not been downloaded yet, so the map may appear blank outside downloaded regions. Connect this NOMAD to the internet and download it (~15 MB) from Map Settings.'
      : props.maps.regionFiles.length === 0
        ? 'No map regions have been downloaded yet. Please download some regions to enable map functionality.'
        : null

  return (
    <MapsLayout>
      <Head title="Maps" />

      <div className="relative w-full h-full overflow-hidden">
        {/* Navbar */}
        <div
          className="absolute top-0 left-0 right-0 z-50 flex justify-between items-center px-3 sm:px-6 py-2 sm:py-3 border-b border-border-subtle bg-surface-secondary backdrop-blur-sm"
          onMouseEnter={() => setIsHoveringUI(true)}
          onMouseLeave={() => setIsHoveringUI(false)}
        >
          <Link href="/home" className="flex items-center gap-2 min-w-0">
            <IconArrowLeft className="h-6 w-6 shrink-0" />
            <p className="text-base sm:text-lg font-semibold text-text-primary truncate hidden sm:inline">
              Maps
            </p>
          </Link>

          <div className="flex items-center gap-2 sm:gap-4">
            <button
              type="button"
              onClick={() => setShowMapCoordinates((prev) => !prev)}
              className="rounded-lg px-2 sm:px-3 py-1.5 text-sm bg-surface-primary text-text-secondary border border-border-default hover:bg-surface-tertiary transition focus:outline-none focus:ring-2 focus:ring-desert-green focus:border-transparent"
            >
              <span className="sm:hidden">
                {showMapCoordinates ? 'Hide Coords' : 'Show Coords'}
              </span>
              <span className="hidden sm:inline">
                {showMapCoordinates ? 'Hide Coordinates' : 'Show Coordinates'}
              </span>
            </button>

            <Link href="/settings/maps" className="shrink-0">
              <StyledButton variant="primary" size="md">
                <IconSettings className="h-4 w-4 mr-2 shrink-0" />
                <span className="hidden sm:inline">Manage Map Regions</span>
              </StyledButton>
            </Link>
          </div>
        </div>

        {/* Alert */}
        {alertMessage && (
          <div
            className="absolute top-20 left-4 right-4 z-50"
            onMouseEnter={() => setIsHoveringUI(true)}
            onMouseLeave={() => setIsHoveringUI(false)}
          >
            <Alert
              title={alertMessage}
              type="warning"
              variant="solid"
              className="w-full"
              buttonProps={{
                variant: 'secondary',
                children: 'Go to Map Settings',
                icon: 'IconSettings',
                onClick: () => router.visit('/settings/maps'),
              }}
            />
          </div>
        )}

        {/* Map */}
        <div className="absolute inset-0">
          <MapComponent isHoveringUI={isHoveringUI} showCoordinatesEnabled={showMapCoordinates} />
        </div>
      </div>
    </MapsLayout>
  )
}
