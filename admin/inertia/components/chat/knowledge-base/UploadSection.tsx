import type { RefObject } from 'react'
import FileUploader from '~/components/file-uploader'
import StyledButton from '~/components/StyledButton'
import StyledSectionHeader from '~/components/StyledSectionHeader'
import CollectionCombobox from '../CollectionCombobox'

interface UploadSectionProps {
  aiAssistantName: string
  isMobile: boolean
  fileUploaderRef: RefObject<React.ComponentRef<typeof FileUploader> | null>
  files: File[]
  setFiles: (f: File[]) => void
  uploadCollection: string
  setUploadCollection: (s: string) => void
  comboboxOptions: string[]
  handleUpload: () => Promise<void>
  isUploading: boolean
  qdrantOffline: boolean
  ingestPolicy: 'Always' | 'Manual'
  updateIngestPolicyPending: boolean
  onUpdateIngestPolicy: (p: 'Always' | 'Manual') => void
}

export default function UploadSection({
  aiAssistantName,
  isMobile,
  fileUploaderRef,
  files,
  setFiles,
  uploadCollection,
  setUploadCollection,
  comboboxOptions,
  handleUpload,
  isUploading,
  qdrantOffline,
  ingestPolicy,
  updateIngestPolicyPending,
  onUpdateIngestPolicy,
}: UploadSectionProps) {
  return (
    <section className="rounded-lg border border-border-subtle bg-surface-primary p-4 md:p-6 space-y-4 md:space-y-6">
      <StyledSectionHeader title="Upload Documents" className="mb-0!" />
      <FileUploader
        ref={fileUploaderRef}
        minFiles={1}
        maxFiles={5}
        onUpload={(uploadedFiles) => {
          setFiles(Array.from(uploadedFiles))
        }}
      />
      <div className="flex flex-col md:flex-row justify-center items-stretch md:items-center gap-3 md:gap-4">
        <label className="flex flex-col md:flex-row md:items-center gap-1 md:gap-2 text-sm text-text-secondary w-full md:w-auto min-w-0">
          <span className="shrink-0">Collection:</span>
          <CollectionCombobox
            value={uploadCollection}
            onChange={setUploadCollection}
            options={comboboxOptions}
            className="w-full md:w-48"
          />
        </label>
        <div className="w-full md:w-auto">
          <StyledButton
            variant="primary"
            size="lg"
            icon="IconUpload"
            onClick={handleUpload}
            disabled={files.length === 0 || isUploading || qdrantOffline}
            loading={isUploading}
            fullWidth={isMobile}
          >
            Upload
          </StyledButton>
        </div>
      </div>
      <div className="flex flex-col md:flex-row md:flex-wrap items-stretch md:items-center justify-between gap-3 p-4 rounded-lg border border-border-subtle bg-surface-secondary">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-primary">Auto-index new content for AI?</p>
          <p className="text-xs text-text-muted mt-1">
            Indexed content typically uses 5–10× the original file size on disk. Changes apply to
            new content added after this setting changes.
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Ingest policy"
          className="inline-flex rounded-md overflow-hidden border border-border-subtle w-full md:w-auto justify-center"
        >
          {(['Always', 'Manual'] as const).map((option) => {
            const isActive = ingestPolicy === option
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={isActive}
                onClick={() => !isActive && onUpdateIngestPolicy(option)}
                disabled={updateIngestPolicyPending}
                className={`flex-1 md:flex-none px-4 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-desert-green text-white'
                    : 'bg-surface-primary text-text-secondary hover:bg-surface-tertiary'
                } ${updateIngestPolicyPending ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              >
                {option}
              </button>
            )
          })}
        </div>
      </div>
      <details
        className="group rounded-lg border border-border-subtle bg-surface-secondary"
        open={!isMobile}
      >
        <summary className="flex items-center justify-between gap-2 p-4 cursor-pointer list-none">
          <span className="text-sm font-semibold text-desert-green">
            Why upload documents to your Knowledge Base?
          </span>
          <svg
            className="w-4 h-4 text-text-muted transition-transform group-open:rotate-180 shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="px-4 pb-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-6 h-6 rounded-full bg-desert-green text-white flex items-center justify-center text-sm font-bold">
              1
            </div>
            <div>
              <p className="font-medium text-desert-stone-dark">
                {aiAssistantName} Knowledge Base Integration
              </p>
              <p className="text-sm text-desert-stone">
                When you upload documents to your Knowledge Base, NOMAD processes and embeds the
                content, making it directly accessible to {aiAssistantName}. This allows{' '}
                {aiAssistantName} to reference your specific documents during conversations,
                providing more accurate and personalized responses based on your uploaded data.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-6 h-6 rounded-full bg-desert-green text-white flex items-center justify-center text-sm font-bold">
              2
            </div>
            <div>
              <p className="font-medium text-desert-stone-dark">
                Enhanced Document Processing with OCR
              </p>
              <p className="text-sm text-desert-stone">
                NOMAD includes built-in Optical Character Recognition (OCR) capabilities, allowing
                it to extract text from image-based documents such as scanned PDFs or photos. This
                means that even if your documents are not in a standard text format, NOMAD can still
                process and embed their content for AI access.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <div className="shrink-0 w-6 h-6 rounded-full bg-desert-green text-white flex items-center justify-center text-sm font-bold">
              3
            </div>
            <div>
              <p className="font-medium text-desert-stone-dark">Information Library Integration</p>
              <p className="text-sm text-desert-stone">
                NOMAD will automatically discover and extract any content you save to your
                Information Library (if installed), making it instantly available to{' '}
                {aiAssistantName} without any extra steps.
              </p>
            </div>
          </div>
        </div>
      </details>
    </section>
  )
}
