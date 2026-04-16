'use client'

import { useState, useEffect } from 'react'

type CoderAgentId = 'opencode' | 'claude-code' | 'codex' | 'gemini-cli'

interface CoderDetectResult {
  found: boolean
  version: string | null
  agentId: CoderAgentId
  agentName: string
  installInstructions?: string
  installUrl?: string
}

const AGENT_META: Record<CoderAgentId, { name: string; description: string }> = {
  'claude-code': { name: 'Claude Code', description: 'Anthropic Claude Code CLI' },
  'opencode': { name: 'OpenCode', description: 'Anthropic open-source coding agent' },
  'codex': { name: 'Codex', description: 'OpenAI Codex CLI agent' },
  'gemini-cli': { name: 'Gemini CLI', description: 'Google Gemini CLI agent' },
}

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const [apiEndpoint, setApiEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [coderAgent, setCoderAgent] = useState<CoderAgentId>('claude-code')
  const [coderStatuses, setCoderStatuses] = useState<CoderDetectResult[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!open) return
    if (!window.miniplay) return

    window.miniplay.configGet().then((config) => {
      setApiEndpoint(config.apiEndpoint || '')
      setApiKey(config.apiKey)
      setModel(config.model)
      setCoderAgent(config.coderAgent || 'claude-code')
    })

    // Use cached env detection results for instant display
    window.miniplay.envStatus?.().then((env) => {
      if (env?.coderAgents) {
        setCoderStatuses(env.coderAgents)
      }
    }).catch(() => {
      // Fallback to live detection if envStatus not available
      window.miniplay.coderDetectAll?.().then((results) => {
        setCoderStatuses(results)
      })
    })
  }, [open])

  if (!open) return null

  const handleSave = async () => {
    if (!window.miniplay) return
    setSaving(true)
    await window.miniplay.configSet({
      apiEndpoint: apiEndpoint.trim(),
      apiKey: apiKey.trim(),
      model: model.trim(),
      coderAgent: coderAgent as any,
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const selectedStatus = coderStatuses.find(s => s.agentId === coderAgent)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      <div className="relative bg-white border border-slate-200 rounded-2xl p-6 w-[480px] shadow-xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold text-slate-900 mb-5">Settings</h2>

        {/* === GD Agent (LLM) === */}
        <div className="mb-5">
          <label className="block text-xs font-medium text-slate-500 mb-3">GD Agent (LLM)</label>

          {/* API Endpoint */}
          <label className="block text-xs text-slate-500 mb-1">API Endpoint</label>
          <input
            type="text"
            value={apiEndpoint}
            onChange={(e) => setApiEndpoint(e.target.value)}
            placeholder="https://api.anthropic.com/v1"
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors mb-3"
          />

          {/* API Key */}
          <label className="block text-xs text-slate-500 mb-1">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors mb-3"
          />

          {/* Model */}
          <label className="block text-xs text-slate-500 mb-1">Model</label>
          <input
            type="text"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. claude-sonnet-4-20250514"
            className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors"
          />
        </div>

        {/* === Coder Agent === */}
        <div className="border-t border-slate-200 pt-5 mb-5">
          <label className="block text-xs font-medium text-slate-500 mb-2">Coder Agent (for code generation)</label>
          <div className="grid grid-cols-2 gap-2">
            {(Object.keys(AGENT_META) as CoderAgentId[]).map((id) => {
              const meta = AGENT_META[id]
              const status = coderStatuses.find(s => s.agentId === id)
              const isSelected = coderAgent === id

              return (
                <button
                  key={id}
                  onClick={() => setCoderAgent(id)}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    isSelected
                      ? 'border-indigo-500 bg-indigo-50'
                      : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${isSelected ? 'text-indigo-700' : 'text-slate-700'}`}>
                      {meta.name}
                    </span>
                    {status?.found ? (
                      <>
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span className="text-[10px] text-emerald-600">{status.version}</span>
                      </>
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-slate-300" title="Not installed" />
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          {selectedStatus && !selectedStatus.found && (
            <div className="mt-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <div className="text-xs text-amber-700 font-medium mb-1">
                {AGENT_META[coderAgent].name} not installed
              </div>
              <div className="text-xs text-slate-700 font-mono bg-slate-100 px-2 py-1.5 rounded mt-1">
                {selectedStatus.installInstructions}
              </div>
              {selectedStatus.installUrl && (
                <a
                  href={selectedStatus.installUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-indigo-600 hover:text-indigo-700 mt-2 inline-block"
                >
                  {selectedStatus.installUrl}
                </a>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-600 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white transition-colors"
          >
            {saving ? 'Saving...' : saved ? 'Saved!' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
