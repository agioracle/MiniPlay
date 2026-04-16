'use client'

import { useState, useEffect } from 'react'
import { WaveDotsBackground } from '@/components/WaveDotsBackground'

interface CoderDetectResult {
  found: boolean
  version: string | null
  agentId: string
  agentName: string
}

interface EnvStatus {
  node: { found: boolean; version: string | null }
  phaserWx: { found: boolean; version: string | null }
  coderAgents: CoderDetectResult[]
  detectedAt: string
}

/* ------------------------------------------------------------------ */
/*  EnvCheckScreen                                                    */
/* ------------------------------------------------------------------ */

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${ok ? 'bg-emerald-500' : 'bg-red-400'}`} />
  )
}

export function EnvCheckScreen({ onContinue }: { onContinue: () => void }) {
  const [env, setEnv] = useState<EnvStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!window.miniplay?.envStatus) {
      setLoading(false)
      return
    }
    window.miniplay.envStatus().then((result) => {
      setEnv(result)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [])

  const hasErrors = env && (!env.node?.found || !env.phaserWx?.found)
  const installedCoders = env?.coderAgents?.filter(a => a.found) ?? []

  return (
    <div className="relative h-screen overflow-hidden bg-[#FAFAF8]">
      {/* Animated wave dots background */}
      <WaveDotsBackground />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center justify-center h-full gap-6">
        <h1 className="text-2xl font-semibold text-slate-900">MiniPlay</h1>
        <p className="text-sm text-slate-500">Environment check</p>

        {loading ? (
          <div className="flex items-center gap-3 text-slate-400 text-sm">
            <span className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
            Checking environment...
          </div>
        ) : env ? (
          <div className="w-[360px] space-y-4">
            {/* Node.js */}
            <div className="flex items-center gap-3 px-4 py-3 bg-white/80 backdrop-blur-sm rounded-xl border border-white/60 shadow-sm">
              <StatusDot ok={!!env.node?.found} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800">Node.js</div>
              </div>
              <span className={`text-xs ${env.node?.found ? 'text-slate-400' : 'text-red-500'}`}>
                {env.node?.found ? env.node.version : 'Not found'}
              </span>
            </div>

            {/* phaser-wx */}
            <div className="flex items-center gap-3 px-4 py-3 bg-white/80 backdrop-blur-sm rounded-xl border border-white/60 shadow-sm">
              <StatusDot ok={!!env.phaserWx?.found} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-slate-800">phaser-wx Toolchain</div>
              </div>
              <span className={`text-xs ${env.phaserWx?.found ? 'text-slate-400' : 'text-red-500'}`}>
                {env.phaserWx?.found ? env.phaserWx.version : 'Not found'}
              </span>
            </div>

            {/* Coder Agents */}
            <div className="px-4 py-3 bg-white/80 backdrop-blur-sm rounded-xl border border-white/60 shadow-sm">
              <div className="text-sm font-medium text-slate-800 mb-2">Coder Agents</div>
              <div className="space-y-1.5">
                {env.coderAgents?.map((agent) => (
                  <div key={agent.agentId} className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${agent.found ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                    <span className="text-xs text-slate-700">{agent.agentName}</span>
                    {agent.found && (
                      <span className="text-[11px] text-slate-400">{agent.version}</span>
                    )}
                  </div>
                ))}
              </div>
              {installedCoders.length === 0 && (
                <p className="text-[11px] text-amber-600 mt-2">
                  No coder agent installed. Please install at least one from Settings.
                </p>
              )}
            </div>

            {hasErrors && (
              <p className="text-xs text-red-600 text-center">
                Some dependencies are missing. Please fix them before proceeding.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Unable to detect environment</p>
        )}

        <button
          onClick={onContinue}
          disabled={loading || !!hasErrors}
          className="mt-2 px-8 py-2.5 text-sm font-medium rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors shadow-lg shadow-indigo-200"
        >
          Get Started
        </button>
      </div>
    </div>
  )
}
