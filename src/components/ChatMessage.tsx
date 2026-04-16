'use client'

import { Sparkles, Terminal, CircleUserRound, Info } from 'lucide-react'
import type { ReactNode } from 'react'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'coder' | 'system'
  content: string
  timestamp: string
  toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>
  images?: Array<{ name: string; mimeType: string; base64: string }>
}

const TOOL_LABELS: Record<string, string> = {
  create_project: 'Project created',
  update_gdd: 'GDD updated',
  send_to_coder: 'Code modified',
  trigger_build: 'Build complete',
  trigger_export: 'Export complete',
}

const roleMeta: Record<Message['role'], { label: string; bubbleClass: string; icon: ReactNode; iconClass: string }> = {
  user: {
    label: 'You',
    bubbleClass: 'bg-indigo-50 text-slate-800 ml-8',
    icon: <CircleUserRound className="w-3.5 h-3.5" />,
    iconClass: 'text-indigo-500',
  },
  assistant: {
    label: 'GD Agent',
    bubbleClass: 'bg-slate-100 text-slate-800 mr-8',
    icon: <Sparkles className="w-3.5 h-3.5" />,
    iconClass: 'text-violet-500',
  },
  coder: {
    label: 'Code Agent',
    bubbleClass: 'bg-emerald-50 text-slate-800 mr-8',
    icon: <Terminal className="w-3.5 h-3.5" />,
    iconClass: 'text-emerald-600',
  },
  system: {
    label: 'System',
    bubbleClass: 'bg-amber-50 text-amber-800 mr-8 text-xs',
    icon: <Info className="w-3.5 h-3.5" />,
    iconClass: 'text-amber-500',
  },
}

export function ChatMessage({ message }: { message: Message }) {
  const meta = roleMeta[message.role]

  return (
    <div className={message.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
      <div className={`rounded-xl px-3.5 py-2.5 max-w-[90%] ${meta.bubbleClass}`}>
        <div className={`flex items-center gap-1.5 mb-1 ${meta.iconClass}`}>
          {meta.icon}
          <span className="text-[10px] font-medium">{meta.label}</span>
        </div>
        <div className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</div>

        {/* Image attachments */}
        {message.images && message.images.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {message.images.map((img, i) => (
              <img
                key={i}
                src={`data:${img.mimeType};base64,${img.base64}`}
                alt={img.name}
                className="max-w-[200px] max-h-[150px] rounded-lg border border-slate-200 object-cover"
              />
            ))}
          </div>
        )}

        {/* Tool call badges */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {message.toolCalls.map((tc) => (
              <span
                key={tc.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
              >
                <svg className="w-2.5 h-2.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {TOOL_LABELS[tc.name] || tc.name}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
