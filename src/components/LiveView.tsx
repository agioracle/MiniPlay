'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { RefreshCw, Hammer, Bug } from 'lucide-react'

type PreviewStatus = 'idle' | 'building' | 'starting-server' | 'ready' | 'build-failed' | 'server-failed'

const STATUS_LABELS: Record<PreviewStatus, string> = {
  idle: 'Waiting for your ideas...',
  building: 'Building H5 preview...',
  'starting-server': 'Starting preview server...',
  ready: '',
  'build-failed': 'Build failed',
  'server-failed': 'Preview server failed',
}

export function LiveView({ autoPreview = false }: { autoPreview?: boolean }) {
  const [status, setStatus] = useState<PreviewStatus>('idle')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [rebuilding, setRebuilding] = useState(false)
  const [projectName, setProjectName] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.miniplay) return

    // Fetch project name
    window.miniplay.projectActive?.().then((p) => {
      if (p) {
        const name = p.split('/').pop() || p
        setProjectName(name)
      }
    })

    const unsubStatus = window.miniplay.onPreviewStatus?.((data) => {
      setStatus(data.status as PreviewStatus)
      if (data.url) setPreviewUrl(data.url)
      if (data.error) setError(data.error)
      else setError(null)
    })

    const unsubRefresh = window.miniplay.onPreviewRefresh?.((data) => {
      setPreviewUrl(data.url)
      setStatus('ready')
      if (iframeRef.current) {
        iframeRef.current.src = data.url + '?t=' + Date.now()
      }
    })

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'miniplay:error') {
        const payload = event.data.payload
        window.miniplay.previewRuntimeError?.({
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
    if (autoPreview) {
      window.miniplay.projectResumePreview?.().catch(() => {
        // Ignore — no active project or no build yet
      })
    }

    return () => {
      unsubStatus?.()
      unsubRefresh?.()
      window.removeEventListener('message', handleMessage)
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      if (previewUrl && iframeRef.current) {
        iframeRef.current.src = previewUrl + '?t=' + Date.now()
      } else if (window.miniplay?.previewRefresh) {
        await window.miniplay.previewRefresh()
      }
    } catch {
      // ignore
    } finally {
      setRefreshing(false)
    }
  }, [previewUrl, refreshing])

  const handleRebuild = useCallback(async () => {
    if (rebuilding) return
    setRebuilding(true)
    setPreviewUrl(null)
    setStatus('building')
    try {
      if (window.miniplay?.previewRefresh) {
        await window.miniplay.previewRefresh()
      }
    } catch {
      // ignore
    } finally {
      setRebuilding(false)
    }
  }, [rebuilding])

  const handleToggleDevtools = useCallback(() => {
    window.miniplay?.previewToggleDevtools?.()
  }, [])

  const isLoading = status === 'building' || status === 'starting-server'
  const isError = status === 'build-failed' || status === 'server-failed'

  return (
    <div className="h-full w-full bg-white overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100 shrink-0">
        <span className="text-[11px] font-medium text-slate-500 truncate pl-1">
          {projectName || ''}
        </span>
        {(previewUrl || isError) && (
          <div className="flex items-center gap-1">
            <button
              onClick={handleToggleDevtools}
              className="p-1 rounded hover:bg-slate-100 transition-colors"
              title="Toggle DevTools"
            >
              <Bug className="w-3.5 h-3.5 text-slate-400" />
            </button>
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
          </div>
        )}
      </div>

      {/* Preview content */}
      <div className="flex-1 min-h-0">
        {previewUrl ? (
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
                  <span className="text-[10px] text-slate-500 max-w-[240px] text-center truncate">{error}</span>
                )}
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
