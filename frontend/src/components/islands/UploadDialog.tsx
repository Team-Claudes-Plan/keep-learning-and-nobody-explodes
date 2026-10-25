import { useEffect, useId, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { uploadDocuments } from '../../api/client'
import type { Island, UploadResponse } from '../../api/types'
import { playSfx } from '../../audio/sfx'

type UploadState =
  | { status: 'idle' }
  | { status: 'uploading'; progress: number }
  | { status: 'done'; result: UploadResponse }
  | { status: 'error'; message: string }

type UploadDialogProps = {
  island: Island
  onClose: () => void
}

// Pixel-art document with an up arrow. # outline, w paper, f folded corner, a arrow.
const ICON_PIXELS = [
  '................',
  '..#########.....',
  '..#wwwwwww##....',
  '..#wwwwwww#f#...',
  '..#wwwwwww#ff#..',
  '..#wwwwwww####..',
  '..#wwwwaawwww#..',
  '..#wwwaaaawww#..',
  '..#wwaaaaaaww#..',
  '..#wwwwaawwww#..',
  '..#wwwwaawwww#..',
  '..#wwwwaawwww#..',
  '..#wwwwaawwww#..',
  '..#wwwwwwwwww#..',
  '..############..',
  '................',
]

const ICON_COLORS: Record<string, string> = {
  '#': '#1b1030',
  w: '#ffffff',
  f: '#c9d3e0',
  a: 'currentColor',
}

// One rect per horizontal run of the same colour.
const ICON_RECTS = ICON_PIXELS.flatMap((row, y) => {
  const runs: { x: number; y: number; width: number; fill: string }[] = []
  for (let x = 0; x < row.length; ) {
    const char = row[x]
    let end = x
    while (row[end] === char) end++
    if (ICON_COLORS[char]) runs.push({ x, y, width: end - x, fill: ICON_COLORS[char] })
    x = end
  }
  return runs
})

/** Upload icon: a pixel-art document with an arrow pointing up. */
export function UploadIcon({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {ICON_RECTS.map((rect) => (
        <rect key={`${rect.x}-${rect.y}`} x={rect.x} y={rect.y} width={rect.width} height={1} fill={rect.fill} />
      ))}
    </svg>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const fileKey = (file: File) => `${file.name}:${file.size}:${file.lastModified}`

/** Lets the user add course documents to an island by dropping or picking files. */
export default function UploadDialog({ island, onClose }: UploadDialogProps) {
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [files, setFiles] = useState<File[]>([])
  const [dragging, setDragging] = useState(false)
  const [state, setState] = useState<UploadState>({ status: 'idle' })
  const uploading = state.status === 'uploading'

  // Cancel a running upload when the dialog goes away.
  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (state.status === 'done') playSfx(state.result.failures.length > 0 ? 'uploadError' : 'uploadDone')
    else if (state.status === 'error') playSfx('uploadError')
  }, [state])

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !uploading) onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose, uploading])

  const addFiles = (added: FileList | null) => {
    if (!added?.length) return
    playSfx('uiClick', { volume: 0.7 })
    setFiles((current) => {
      const known = new Set(current.map(fileKey))
      return [...current, ...Array.from(added).filter((file) => !known.has(fileKey(file)))]
    })
    setState({ status: 'idle' })
  }

  const removeFile = (file: File) => setFiles((current) => current.filter((f) => f !== file))

  const handleDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    if (!uploading) addFiles(event.dataTransfer.files)
  }

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = uploading ? 'none' : 'copy'
    setDragging(true)
  }

  const upload = async () => {
    if (!files.length) return
    const controller = new AbortController()
    abortRef.current = controller
    setState({ status: 'uploading', progress: 0 })
    try {
      const result = await uploadDocuments(island.id, files, {
        signal: controller.signal,
        onProgress: (progress) => setState({ status: 'uploading', progress }),
      })
      setState({ status: 'done', result })
      // Keep only what failed so it can be retried.
      const failed = new Set(result.failures.map((failure) => failure.filename))
      setFiles((current) => current.filter((file) => failed.has(file.name)))
    } catch (error) {
      if (controller.signal.aborted) setState({ status: 'idle' })
      else setState({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    } finally {
      abortRef.current = null
    }
  }

  return (
    <div className="upload-backdrop" onClick={() => !uploading && onClose()}>
      <div
        className="upload-dialog chamfer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="upload-dialog-face chamfer">
        <div className="upload-header">
          <div>
            <div id={titleId} className="upload-title">
              Upload documents
            </div>
            <div className="upload-subtitle">to {island.name}</div>
          </div>
          <button type="button" className="upload-close" onClick={onClose} disabled={uploading} aria-label="Close" data-sfx="none">
            ×
          </button>
        </div>

        <div
          className={`upload-dropzone chamfer${dragging ? ' is-dragging' : ''}${uploading ? ' is-disabled' : ''}`}
          onDragOver={handleDragOver}
          onDragLeave={(event) => {
            // Moving onto a child element also fires dragleave; only react when leaving the zone.
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
          }}
          onDrop={handleDrop}
        >
          <div className="upload-dropzone-face chamfer">
            <UploadIcon size={56} className="upload-dropzone-icon" />
            <div className="upload-dropzone-title">{dragging ? 'Let go!' : 'Drop files here'}</div>
            <div className="upload-or">or</div>
            <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}>
              Choose files…
            </button>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                addFiles(event.target.files)
                event.target.value = ''
              }}
            />
          </div>
        </div>

        {files.length > 0 && (
          <ul className="upload-files">
            {files.map((file) => (
              <li key={fileKey(file)}>
                <span className="upload-file-name">{file.name}</span>
                <span className="upload-file-size">{formatSize(file.size)}</span>
                <button
                  type="button"
                  onClick={() => removeFile(file)}
                  disabled={uploading}
                  aria-label={`Remove ${file.name}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}

        {state.status === 'uploading' && (
          <div className="upload-progress" role="progressbar" aria-valuenow={Math.round(state.progress * 100)}>
            <div style={{ width: `${state.progress * 100}%` }} />
          </div>
        )}

        {state.status === 'error' && <div className="upload-message is-bad">{state.message}</div>}

        {state.status === 'done' && (
          <div className={`upload-message ${state.result.failures.length ? 'is-bad' : 'is-good'}`}>
            {state.result.objects.length > 0 && (
              <div>
                Uploaded {state.result.objects.length} {state.result.objects.length === 1 ? 'file' : 'files'}.
              </div>
            )}
            {state.result.failures.map((failure, index) => (
              <div key={index}>
                {failure.filename ?? 'Remaining files'}: {failure.message}
              </div>
            ))}
          </div>
        )}

        <div className="upload-actions">
          {uploading ? (
            <button type="button" onClick={() => abortRef.current?.abort()}>
              Cancel
            </button>
          ) : (
            <button type="button" onClick={onClose} data-sfx="none">
              {state.status === 'done' ? 'Done' : 'Close'}
            </button>
          )}
          <button type="button" className="is-primary" onClick={upload} disabled={!files.length || uploading}>
            {uploading ? `Uploading… ${Math.round(state.progress * 100)}%` : `Upload${files.length ? ` ${files.length}` : ''}`}
          </button>
        </div>
        </div>
      </div>
    </div>
  )
}
