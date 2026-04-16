'use client'

import { useState } from 'react'

interface ApiKeyFormProps {
  onSaved: () => void
}

export function ApiKeyForm({ onSaved }: ApiKeyFormProps) {
  const [apiEndpoint, setApiEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!apiKey.trim() || !apiEndpoint.trim() || !model.trim()) return
    setSaving(true)
    try {
      await window.miniplay.configSet({
        apiEndpoint: apiEndpoint.trim(),
        apiKey: apiKey.trim(),
        model: model.trim(),
      })
      onSaved()
    } catch (err) {
      console.error('Failed to save config:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="w-96 space-y-4">
      {/* API Endpoint */}
      <div>
        <label className="block text-xs text-slate-500 mb-1.5">API Endpoint</label>
        <input
          type="text"
          value={apiEndpoint}
          onChange={(e) => setApiEndpoint(e.target.value)}
          placeholder="https://api.anthropic.com/v1"
          className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors"
        />
      </div>

      {/* API Key */}
      <div>
        <label className="block text-xs text-slate-500 mb-1.5">API Key</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="sk-..."
          className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors"
        />
      </div>

      {/* Model */}
      <div>
        <label className="block text-xs text-slate-500 mb-1.5">Model</label>
        <input
          type="text"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="claude-sonnet-4-20250514"
          className="w-full px-3 py-2.5 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors"
        />
      </div>

      {/* Continue */}
      <button
        onClick={handleSave}
        disabled={!apiKey.trim() || !apiEndpoint.trim() || !model.trim() || saving}
        className="w-full py-2.5 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors"
      >
        {saving ? 'Saving...' : 'Continue'}
      </button>
    </div>
  )
}
