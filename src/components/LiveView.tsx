'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { RefreshCw, Hammer, Bug } from 'lucide-react'

type PreviewStatus =
  | 'idle'
  | 'building'
  | 'starting-server'
  | 'ready'
  | 'build-failed'
  | 'server-failed'
  | 'built-idle'

const STATUS_LABELS: Record<PreviewStatus, string> = {
  idle: 'Waiting for your ideas...',
  building: 'Building H5 preview...',
  'starting-server': 'Starting preview server...',
  ready: '',
  'build-failed': 'Build failed',
  'server-failed': 'Preview server failed',
  'built-idle': 'Build complete — open to preview.',
}

interface LiveViewProps {
  /**
   * The project this panel represents. When provided, every incoming preview
   * event is filtered against it so background-project noise (e.g. self-heal
   * builds on another project) never pollutes the current view.
   *
   * `null` (or undefined) means the panel has no project bound yet (e.g. the
   * pre-project GD phase). In that state we intentionally ignore all preview
   * events until a project is assigned.
   */
  projectPath?: string | null
  autoPreview?: boolean
}

export function LiveView({ projectPath = null, autoPreview = false }: LiveViewProps) {
  const [status, setStatus] = useState<PreviewStatus>('idle')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [projectName, setProjectName] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Append a cache-buster so Electron's shared HTTP cache never replays
  // assets from a previously-opened project. All projects are served from
  // the same origin (http://localhost:5173) with identical bundle names
  // (game.js, index.html), so without this every switch would reload the
  // first project's cached bundle.
  const withCacheBuster = (url: string): string => {
    const sep = url.includes('?') ? '&' : '?'
    return `${url}${sep}t=${Date.now()}`
  }

  // Reset local preview state whenever the bound project changes so a stale
  // iframe src never leaks across projects.
  useEffect(() => {
    setStatus('idle')
    setPreviewUrl(null)
    setError(null)
    if (projectPath) {
      const name = projectPath.split('/').pop() || projectPath
      setProjectName(name)
    } else {
      setProjectName(null)
    }
  }, [projectPath])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.miniplay) return

    const unsubStatus = window.miniplay.onPreviewStatus?.((data) => {
      // Cross-project filter: an event that targets another project must
      // never mutate this panel's state. Background project `built-idle`
      // events etc. are dropped here.
      if (data.projectPath && projectPath && data.projectPath !== projectPath) {
        return
      }
      // If we have no project bound yet, ignore all preview events.
      if (!projectPath) return

      setStatus((data.status as PreviewStatus) || 'idle')
      if (data.url) setPreviewUrl(withCacheBuster(data.url))
      if (data.error) setError(data.error)
      else setError(null)
    })

    const unsubRefresh = window.miniplay.onPreviewRefresh?.((data) => {
      if (data.projectPath && projectPath && data.projectPath !== projectPath) {
        return
      }
      if (!projectPath) return

      const busted = withCacheBuster(data.url)
      setPreviewUrl(busted)
      setStatus('ready')
      if (iframeRef.current) {
        iframeRef.current.src = busted
      }
    })

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'miniplay:error') {
        const payload = event.data.payload
        window.miniplay?.previewRuntimeError?.({
          message: payload?.message,
          source: payload?.source,
          line: payload?.line,
          stack: payload?.stack,
        })
        setStatus('build-failed')
        setError(payload?.message || 'Runtime error')
      }
    }
    window.addEventListener('message', handleMessage)

    // Auto-trigger preview on mount only when opening an existing project.
    // New projects have no build yet — preview will be triggered after
    // the GD Agent creates the project and the first build completes.
    if (autoPreview && projectPath) {
      window.miniplay.projectResumePreview?.({ projectPath }).catch(() => {
        // Ignore — no active project or no build yet
      })
    }

    return () => {
      unsubStatus?.()
      unsubRefresh?.()
      window.removeEventListener('message', handleMessage)
    }
    // Intentionally re-run when projectPath changes so the handlers close
    // over the latest path and the filter stays accurate.
  }, [projectPath, autoPreview])

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      if (previewUrl && iframeRef.current) {
        // Strip any existing cache-buster before appending a fresh one.
        const base = previewUrl.split('?')[0]
        iframeRef.current.src = withCacheBuster(base)
      } else if (window.miniplay?.previewRefresh) {
        await window.miniplay.previewRefresh(projectPath ? { projectPath } : undefined)
      }
    } catch {
      // ignore
    } finally {
      setRefreshing(false)
    }
  }, [previewUrl, refreshing, projectPath])

  const handleRebuild = useCallback(async () => {
    if (rebuilding) return
    setRebuilding(true)
    setPreviewUrl(null)
    setStatus('building')
    try {
      if (window.miniplay?.previewRefresh) {
        await window.miniplay.previewRefresh(projectPath ? { projectPath } : undefined)
      }
    } catch {
      // ignore
    } finally {
      setRebuilding(false)
    }
  }, [rebuilding, projectPath])

  const handleToggleDevtools = useCallback(() => {
    window.miniplay?.previewToggleDevtools?.()
  }, [])

  const isLoading = status === 'building' || status === 'starting-server'
  const isError = status === 'build-failed' || status === 'server-failed'
  const isBuiltIdle = status === 'built-idle'

  return (
    <div className="h-full w-full bg-white overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 shrink-0">
        <span className="text-[11px] font-medium text-slate-500 truncate pl-1">
          {projectName || ''}
        </span>
        <div className="flex items-center gap-1">
          {/* DevTools toggle — always visible so users can inspect console logs */}
          <button
            onClick={handleToggleDevtools}
            className="p-1 rounded hover:bg-slate-100 transition-colors"
            title="Toggle DevTools"
          >
            <Bug className="w-3.5 h-3.5 text-slate-400" />
          </button>
          {/* Rebuild & Refresh — only shown when preview is loaded or errored */}
          {(previewUrl || isError || isBuiltIdle) && (
            <>
              <button
                onClick={handleRebuild}
                disabled={rebuilding || isLoading}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors"
                title="Rebuild from source"
              >
                <Hammer className={`w-3.5 h-3.5 text-slate-400 ${rebuilding ? 'animate-bounce' : ''}`} />
              </button>
              <button
                onClick={handleRefresh}
                disabled={refreshing || isLoading}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-30 transition-colors"
                title="Reload preview"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Preview content */}
      <div className="flex-1 min-h-0">
        {/*
          Render the iframe only when we have a URL AND we're not in an error
          state. This prevents a stale iframe from masking the red error
          status page when a build/runtime failure happens on an
          already-running preview. When recovery succeeds and `status`
          transitions back to `running`/`ready`, `isError` flips to false and
          the iframe is re-mounted against the preserved `previewUrl`.
        */}
        {previewUrl && !isError ? (
          <iframe
            ref={iframeRef}
            src={previewUrl}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin"
            title="Game Preview"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-3">
            {isLoading && (
              <>
                <span className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                <span className="text-xs text-slate-400">{STATUS_LABELS[status]}</span>
              </>
            )}
            {isError && (
              <>
                <span className="w-8 h-8 rounded-full bg-red-50 flex items-center justify-center">
                  <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                  </svg>
                </span>
                <span className="text-xs text-red-600">{STATUS_LABELS[status]}</span>
                {error && (
                  <span className="text-[10px] text-slate-500 max-w-60 text-center truncate">{error}</span>
                )}
              </>
            )}
            {isBuiltIdle && (
              <>
                <span className="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center">
                  <Hammer className="w-4 h-4 text-indigo-500" />
                </span>
                <span className="text-xs text-slate-500">{STATUS_LABELS[status]}</span>
                <button
                  onClick={handleRefresh}
                  className="text-[11px] text-indigo-600 hover:text-indigo-700 underline underline-offset-2"
                >
                  Open preview
                </button>
              </>
            )}
            {status === 'idle' && (
              <span className="text-xs text-slate-400">{STATUS_LABELS[status]}</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
