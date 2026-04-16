'use client'

import { useState, useEffect } from 'react'

interface Version {
  version: string
  commitHash: string
  summary: string
  ts: string
}

export function TimeTravelBar() {
  const [versions, setVersions] = useState<Version[]>([])
  const [activeHash, setActiveHash] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Load versions on mount and listen for updates
  useEffect(() => {
    loadVersions()
  }, [])

  async function loadVersions() {
    if (!window.miniplay?.gitVersions) return
    const data = await window.miniplay.gitVersions()
    setVersions((data.versions || []) as Version[])
  }

  async function handleCheckout(hash: string) {
    if (!window.miniplay?.gitCheckout || loading) return
    setLoading(true)
    setActiveHash(hash)
    await window.miniplay.gitCheckout(hash)
    setLoading(false)
  }

  async function handleReturnToLatest() {
    if (!window.miniplay?.gitReturnToLatest || loading) return
    setLoading(true)
    setActiveHash(null)
    await window.miniplay.gitReturnToLatest()
    setLoading(false)
    loadVersions() // Refresh list
  }

  if (versions.length === 0) return null

  return (
    <div className="flex items-center gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      {versions.map((v) => (
        <button
          key={v.commitHash}
          onClick={() => handleCheckout(v.commitHash)}
          disabled={loading}
          title={`${v.version}: ${v.summary}`}
          className={`px-2 py-0.5 text-[11px] font-medium rounded-full transition-colors ${
            activeHash === v.commitHash
              ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-200'
              : activeHash === null && v === versions[versions.length - 1]
                ? 'bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          {v.version}
        </button>
      ))}

      {activeHash && (
        <button
          onClick={handleReturnToLatest}
          disabled={loading}
          className="px-2 py-0.5 text-[11px] font-medium rounded-full bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors"
        >
          ← Latest
        </button>
      )}

      {loading && (
        <span className="w-3 h-3 rounded-full border border-indigo-500 border-t-transparent animate-spin" />
      )}
    </div>
  )
}
