'use client'

import { type RefObject } from 'react'

interface PhoneFrameProps {
  children: React.ReactNode
  previewUrl?: string
  iframeRef?: RefObject<HTMLIFrameElement | null>
}

export function PhoneFrame({ children, previewUrl, iframeRef }: PhoneFrameProps) {
  return (
    <div className="relative" style={{ height: 'calc(100vh - 8rem)' }}>
      {/* Phone bezel */}
      <div
        className="h-full rounded-[2.5rem] border-[3px] border-slate-200 bg-white overflow-hidden shadow-lg"
        style={{ aspectRatio: '9/16' }}
      >
        {/* Notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-slate-800 rounded-b-2xl z-10" />

        {/* Screen content */}
        <div className="w-full h-full overflow-hidden">
          {previewUrl ? (
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className="w-full h-full border-0"
              sandbox="allow-scripts allow-same-origin"
              title="Game Preview"
            />
          ) : (
            children
          )}
        </div>
      </div>
    </div>
  )
}
