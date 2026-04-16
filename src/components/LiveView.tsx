'use client'

import { useState, useEffect, useRef } from 'react'

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
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.miniplay) return

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

  const isLoading = status === 'building' || status === 'starting-server'
  const isError = status === 'build-failed' || status === 'server-failed'

  return (
    <div className="h-full w-full bg-white overflow-hidden">
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
  )
}
