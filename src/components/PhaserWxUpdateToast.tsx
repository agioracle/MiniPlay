'use client'

import { useEffect, useState } from 'react'

type PhaserWxUpdateStatus =
  | 'skipped-no-repo'
  | 'skipped-no-network'
  | 'skipped-no-git'
  | 'skipped-dirty'
  | 'up-to-date'
  | 'updating'
  | 'updated'
  | 'failed-rollback'
  | 'failed'

interface PhaserWxUpdateProgress {
  status: PhaserWxUpdateStatus
  detail?: string
  localHead?: string
  remoteHead?: string
  error?: string
}

/**
 * Small bottom-right toast that surfaces the background phaser-wx toolchain
 * update check. Auto-hides after a few seconds once the update reaches a
 * terminal state ("updated", "up-to-date", or any failure/skipped variant).
 *
 * The update runs independently in the Electron main process — this toast is
 * purely informational. On failure the app transparently keeps using the
 * previous toolchain version, so the user never has to take action.
 */
export function PhaserWxUpdateToast() {
  const [progress, setProgress] = useState<PhaserWxUpdateProgress | null>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const api = typeof window !== 'undefined' ? window.miniplay : undefined
    if (!api?.onPhaserWxUpdateProgress) return

    let hideTimer: ReturnType<typeof setTimeout> | null = null

    const unsub = api.onPhaserWxUpdateProgress((p) => {
      // Never show the toast for silent no-ops — these are the common case
      // (already up-to-date, or the user is offline). Only surface when an
      // actual update is happening or has finished.
      if (p.status === 'up-to-date' || p.status === 'skipped-no-repo' || p.status === 'skipped-no-network' || p.status === 'skipped-no-git') {
        return
      }

      setProgress(p)
      setVisible(true)

      if (hideTimer) {
        clearTimeout(hideTimer)
        hideTimer = null
      }

      // Auto-dismiss once we reach a terminal state.
      if (p.status !== 'updating') {
        hideTimer = setTimeout(() => setVisible(false), 6000)
      }
    })

    return () => {
      unsub?.()
      if (hideTimer) clearTimeout(hideTimer)
    }
  }, [])

  if (!visible || !progress) return null

  const { status, detail } = progress
  const updating = status === 'updating'
  const succeeded = status === 'updated'
  const failed = status === 'failed' || status === 'failed-rollback'
  const skippedDirty = status === 'skipped-dirty'

  const accent = succeeded
    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
    : failed
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : skippedDirty
        ? 'border-slate-200 bg-slate-50 text-slate-700'
        : 'border-indigo-200 bg-indigo-50 text-indigo-900'

  const title = updating
    ? 'Updating phaser-wx toolchain'
    : succeeded
      ? 'phaser-wx toolchain updated'
      : failed
        ? 'phaser-wx update failed'
        : skippedDirty
          ? 'phaser-wx update skipped'
          : 'phaser-wx toolchain'

  return (
    <div
      className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-xl border px-4 py-3 shadow-lg ${accent}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        {updating ? (
          <span className="mt-0.5 w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin shrink-0" />
        ) : (
          <span
            className={`mt-1 w-2.5 h-2.5 rounded-full shrink-0 ${
              succeeded ? 'bg-emerald-500' : failed ? 'bg-amber-500' : 'bg-slate-400'
            }`}
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium">{title}</div>
          {detail && (
            <div className="text-xs mt-1 opacity-80 wrap-break-word">{detail}</div>
          )}
          {failed && (
            <div className="text-[11px] mt-1 opacity-70">
              Continuing with the previously installed version.
            </div>
          )}
        </div>
        {!updating && (
          <button
            type="button"
            onClick={() => setVisible(false)}
            className="text-xs opacity-60 hover:opacity-100 shrink-0"
            aria-label="Dismiss"
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}
