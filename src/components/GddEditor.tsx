'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

export function GddEditor() {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Load GDD on mount
  useEffect(() => {
    if (!window.miniplay?.gddRead) {
      setLoading(false)
      return
    }
    window.miniplay.gddRead().then((result) => {
      setContent(result.content || '')
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value)
    setDirty(true)
  }, [])

  const handleSave = useCallback(async () => {
    if (!window.miniplay?.gddWrite || !dirty) return
    setSaving(true)
    try {
      await window.miniplay.gddWrite(content)
      setDirty(false)
    } catch (err) {
      console.error('Failed to save GDD:', err)
    } finally {
      setSaving(false)
    }
  }, [content, dirty])

  // Ctrl/Cmd+S to save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [handleSave])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (!content) {
    return (
      <div className="h-full flex items-center justify-center">
        <span className="text-xs text-slate-400">No GDD yet. Start chatting to create one.</span>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-200 bg-slate-50/50">
        <span className="text-[11px] text-slate-400 font-medium">docs/GDD.md</span>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-[10px] text-amber-500">Unsaved changes</span>
          )}
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-2.5 py-1 text-[11px] font-medium rounded-md bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white transition-colors"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Editor */}
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        className="flex-1 w-full px-4 py-3 text-sm font-mono leading-relaxed text-slate-800 bg-white resize-none outline-none"
        spellCheck={false}
      />
    </div>
  )
}
