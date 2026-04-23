'use client'

import { useState, useEffect, useImperativeHandle, forwardRef } from 'react'
import { LiveView } from '@/components/LiveView'
import { GddEditor } from '@/components/GddEditor'
import { AssetsPanel } from '@/components/AssetsPanel'

type RightTab = 'preview' | 'gdd' | 'assets'

export interface RightPanelHandle {
  switchToGdd: () => void
}

export const RightPanel = forwardRef<
  RightPanelHandle,
  { autoPreview?: boolean; projectPath?: string | null }
>(function RightPanel({ autoPreview = false, projectPath = null }, ref) {
    const [activeTab, setActiveTab] = useState<RightTab>('preview')

    useImperativeHandle(ref, () => ({
      switchToGdd() {
        setActiveTab('gdd')
      },
    }), [])

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
          onClick={() => setActiveTab('assets')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeTab === 'assets'
              ? 'bg-indigo-50 text-indigo-700'
              : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
          }`}
        >
          Assets
        </button>
        <button
          onClick={() => setActiveTab('gdd')}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
            activeTab === 'gdd'
              ? 'bg-indigo-50 text-indigo-700'
              : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
          }`}
        >
          Game Design Document
        </button>
      </div>

      {/* Content — both panels always mounted, toggle visibility via CSS */}
      <div className="flex-1 min-h-0 px-3 pb-3">
        <div className={`h-full bg-white rounded-2xl overflow-hidden card-shadow ${activeTab === 'preview' ? '' : 'hidden'}`}>
          <LiveView autoPreview={autoPreview} projectPath={projectPath} />
        </div>
        <div className={`h-full bg-white rounded-2xl overflow-hidden card-shadow ${activeTab === 'gdd' ? '' : 'hidden'}`}>
          <GddEditor visible={activeTab === 'gdd'} />
        </div>
        <div className={`h-full bg-white rounded-2xl overflow-hidden card-shadow ${activeTab === 'assets' ? '' : 'hidden'}`}>
          <AssetsPanel visible={activeTab === 'assets'} />
        </div>
      </div>
    </div>
  )
})
