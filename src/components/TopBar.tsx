'use client'

import { useState } from 'react'
import { TimeTravelBar } from '@/components/TimeTravelBar'

export function TopBar({ onBack }: { onBack?: () => void }) {
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    if (!window.miniplay?.exportRun || exporting) return
    setExporting(true)
    try {
      await window.miniplay.exportRun()
    } catch (err) {
      console.error('Export failed:', err)
    } finally {
      setExporting(false)
    }
  }

  return (
    <header
      className="flex items-center h-12 px-4 border-b border-slate-200 bg-white/80 backdrop-blur-sm"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* macOS traffic light space */}
      <div className="w-20 shrink-0" />

      {/* Back button */}
      {onBack && (
        <button
          onClick={onBack}
          className="mr-3 p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          title="Back to projects"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
      )}

      {/* App title */}
      <h1 className="text-sm font-semibold tracking-wide text-slate-800">
        MiniPlay
      </h1>

      {/* Time Travel version chips */}
      <div className="ml-6 overflow-x-auto max-w-[40%]">
        <TimeTravelBar />
      </div>

      <div className="flex-1" />

      {/* Export button */}
      <button
        onClick={handleExport}
        disabled={exporting}
        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white shadow-sm transition-colors flex items-center gap-1.5"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {exporting ? (
          <>
            <span className="w-3 h-3 rounded-full border border-white/50 border-t-transparent animate-spin" />
            Exporting...
          </>
        ) : (
          'Export'
        )}
      </button>
    </header>
  )
}
