'use client'

import { useState } from 'react'
import { LiveView } from '@/components/LiveView'
import { GddEditor } from '@/components/GddEditor'

type RightTab = 'preview' | 'gdd'

export function RightPanel({ autoPreview = false }: { autoPreview?: boolean }) {
  const [activeTab, setActiveTab] = useState<RightTab>('preview')

  return (
    <div className="h-full flex flex-col">
      {/* Tabs */}
      <div className="flex items-center gap-1 px-3 pt-2 pb-1">
        <button
          onClick={() => setActiveTab('preview')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeTab === 'preview'
              ? 'bg-indigo-50 text-indigo-700'
              : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
          }`}
        >
          Preview
        </button>
        <button
          onClick={() => setActiveTab('gdd')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeTab === 'gdd'
              ? 'bg-indigo-50 text-indigo-700'
              : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
          }`}
        >
          GD Document
        </button>
      </div>

      {/* Content — both panels always mounted, toggle visibility via CSS */}
      <div className="flex-1 min-h-0 px-3 pb-3">
        <div className={`h-full bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm ${activeTab === 'preview' ? '' : 'hidden'}`}>
          <LiveView autoPreview={autoPreview} />
        </div>
        <div className={`h-full bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm ${activeTab === 'gdd' ? '' : 'hidden'}`}>
          <GddEditor />
        </div>
      </div>
    </div>
  )
}
