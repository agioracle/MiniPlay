'use client'

import { useState } from 'react'

interface ErrorCardProps {
  message: string
  details?: string
  retrying?: boolean
  attempt?: number
  maxAttempts?: number
}

export function ErrorCard({ message, details, retrying, attempt, maxAttempts }: ErrorCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 mr-8">
      <div className="flex items-start gap-2">
        <span className="shrink-0 mt-0.5">
          {retrying ? (
            <span className="w-4 h-4 rounded-full border-2 border-amber-500 border-t-transparent animate-spin inline-block" />
          ) : (
            <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          )}
        </span>
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-medium ${retrying ? 'text-amber-700' : 'text-red-700'}`}>
            {retrying
              ? `Auto-fixing (${attempt}/${maxAttempts})...`
              : 'Build Error'
            }
          </div>
          <div className="text-xs text-red-600 mt-0.5 break-words">{message}</div>

          {details && (
            <>
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-[10px] text-slate-500 hover:text-slate-700 mt-1"
              >
                {expanded ? 'Hide details' : 'Show details'}
              </button>
              {expanded && (
                <pre className="text-[10px] text-slate-600 bg-slate-100 mt-1 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto rounded p-2">
                  {details}
                </pre>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
