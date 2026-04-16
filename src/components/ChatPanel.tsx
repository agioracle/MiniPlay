'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { ChatMessage, type Message } from '@/components/ChatMessage'
import { ChatInput, type ImageAttachment } from '@/components/ChatInput'
import { Sparkles, Terminal } from 'lucide-react'

const DEFAULT_WELCOME: Message[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content: 'Hi! Tell me about the game you want to create.',
    timestamp: new Date().toISOString(),
  },
]

interface ChatPanelProps {
  initialMessages?: Message[]
  onSend: (text: string, images?: ImageAttachment[]) => Promise<{ text?: string; toolCalls?: unknown[]; error?: string; projectCreated?: boolean; success?: boolean }>
  projectPhase?: 'gd' | 'code'
}

export function ChatPanel({ initialMessages, onSend, projectPhase = 'gd' }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? DEFAULT_WELCOME)
  const [isLoading, setIsLoading] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [activeToolCalls, setActiveToolCalls] = useState<Map<string, { name: string; status: 'running' | 'done' }>>(new Map())
  const [coderStatus, setCoderStatus] = useState<string | null>(null)
  const [coderOutput, setCoderOutput] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const coderLogRef = useRef<HTMLDivElement>(null)

  // Sync messages when initialMessages prop changes (e.g. opening a different project)
  useEffect(() => {
    setMessages(initialMessages ?? DEFAULT_WELCOME)
  }, [initialMessages])

  // Auto-scroll coder log to bottom
  useEffect(() => {
    if (coderLogRef.current) {
      coderLogRef.current.scrollTop = coderLogRef.current.scrollHeight
    }
  }, [coderOutput])

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingText, coderOutput])

  // Listen for agent stream events
  useEffect(() => {
    if (typeof window === 'undefined' || !window.miniplay?.onAgentStream) return

    const unsub = window.miniplay.onAgentStream((event) => {
      if (event.type === 'text-delta' && event.text) {
        setStreamingText(prev => prev + event.text)
      } else if (event.type === 'tool-call' && event.toolCallId && event.toolName) {
        setActiveToolCalls(prev => {
          const next = new Map(prev)
          next.set(event.toolCallId!, { name: event.toolName!, status: 'running' })
          return next
        })
        // When send_to_coder starts, reset coder state
        if (event.toolName === 'send_to_coder') {
          setCoderStatus(null)
          setCoderOutput([])
        }
      } else if (event.type === 'coder-status' && event.text) {
        setCoderStatus(event.text)
      } else if (event.type === 'coder-output' && event.text) {
        setCoderOutput(prev => {
          const next = [...prev, event.text!]
          // Keep last 200 lines to avoid memory issues
          return next.length > 200 ? next.slice(-200) : next
        })
      } else if (event.type === 'tool-result' && event.toolCallId) {
        setActiveToolCalls(prev => {
          const next = new Map(prev)
          const existing = next.get(event.toolCallId!)
          if (existing) {
            next.set(event.toolCallId!, { ...existing, status: 'done' })
          }
          return next
        })
      } else if (event.type === 'done') {
        // Streaming complete — clear GD Agent streaming text only.
        // Coder state (status, output, tool calls) is cleared when the
        // next handleSend starts, so the Code Agent bubble stays visible
        // until the final message replaces it.
        setStreamingText('')
      } else if (event.type === 'error') {
        setStreamingText('')
      }
    })

    return unsub
  }, [])

  const handleSend = useCallback(async (text: string, images?: ImageAttachment[]) => {
    const userMsg: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
      images,
    }
    setMessages(prev => [...prev, userMsg])
    setIsLoading(true)
    setStreamingText('')
    setActiveToolCalls(new Map())
    setCoderStatus(null)
    setCoderOutput([])

    try {
      const result = await onSend(text, images)
      if (result.error) {
        setMessages(prev => [...prev, {
          id: `msg_${Date.now()}_error`,
          role: 'system',
          content: `Error: ${result.error}`,
          timestamp: new Date().toISOString(),
        }])
      } else if (result.text || (result.toolCalls && (result.toolCalls as unknown[]).length > 0)) {
        // Determine role: if result has toolCalls → GD Agent, if result has success field → Code Agent
        const isCoder = 'success' in result
        setMessages(prev => [...prev, {
          id: `msg_${Date.now()}_reply`,
          role: isCoder ? 'coder' as const : 'assistant' as const,
          content: result.text ?? '',
          timestamp: new Date().toISOString(),
          toolCalls: result.toolCalls as Message['toolCalls'],
        }])
      }
      // For coder:send — no text response, status shown via stream events
    } catch (err) {
      setMessages(prev => [...prev, {
        id: `msg_${Date.now()}_error`,
        role: 'system',
        content: `Error: ${err}`,
        timestamp: new Date().toISOString(),
      }])
    } finally {
      setIsLoading(false)
      // Clear coder real-time UI after final message has been added
      setActiveToolCalls(new Map())
      setCoderStatus(null)
      setCoderOutput([])
    }
  }, [onSend])

  return (
    <>
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map(msg => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {/* Streaming text (GD Agent phase) */}
        {isLoading && streamingText && (
          <div className="flex justify-start">
            <div className="rounded-xl px-3.5 py-2.5 max-w-[90%] bg-slate-100 text-slate-800 mr-8">
              <div className="flex items-center gap-1.5 mb-1 text-violet-500">
                <Sparkles className="w-3.5 h-3.5" />
                <span className="text-[10px] font-medium">GD Agent</span>
              </div>
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{streamingText}<span className="inline-block w-3.5 h-3.5 ml-1 align-middle rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" /></div>
            </div>
          </div>
        )}

        {/* GD Agent tool calls (non-coder tools only) */}
        {activeToolCalls.size > 0 && !Array.from(activeToolCalls.values()).some(tc => tc.name === 'send_to_coder') && (
          <div className="space-y-1.5">
            {Array.from(activeToolCalls.entries()).map(([id, tc]) => (
              <div key={id} className="flex items-center gap-2 text-xs text-slate-500 pl-2">
                {tc.status === 'running' ? (
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
                ) : (
                  <span className="w-3.5 h-3.5 rounded-full bg-emerald-100 flex items-center justify-center">
                    <svg className="w-2 h-2 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                )}
                <span className="text-slate-500">
                  {tc.name === 'create_project' && (tc.status === 'running' ? 'Creating project...' : 'Project created')}
                  {tc.name === 'update_gdd' && (tc.status === 'running' ? 'Updating GDD...' : 'GDD updated')}
                  {tc.name === 'trigger_build' && (tc.status === 'running' ? 'Building...' : 'Build complete')}
                  {tc.name === 'trigger_export' && (tc.status === 'running' ? 'Exporting...' : 'Export complete')}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Code Agent bubble — wraps status + log + build into one chat message */}
        {(coderOutput.length > 0 || Array.from(activeToolCalls.values()).some(tc => tc.name === 'send_to_coder')) && (
          <div className="flex justify-start">
            <div className="rounded-xl px-3.5 py-2.5 max-w-[90%] bg-emerald-50 text-slate-800 mr-8">
              <div className="flex items-center gap-1.5 mb-2 text-emerald-600">
                <Terminal className="w-3.5 h-3.5" />
                <span className="text-[10px] font-medium">Code Agent</span>
              </div>

              {/* Coder status line */}
              <div className="flex items-center gap-2 text-xs text-slate-600 mb-2">
                {coderStatus === 'done' ? (
                  <span className="w-3.5 h-3.5 rounded-full bg-emerald-100 flex items-center justify-center">
                    <svg className="w-2 h-2 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                ) : coderStatus === 'failed' || coderStatus?.includes('failed') ? (
                  <span className="w-3.5 h-3.5 rounded-full bg-red-100 flex items-center justify-center">
                    <svg className="w-2 h-2 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </span>
                ) : (
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
                )}
                <span>
                  {coderStatus
                    ? coderStatus === 'launching' ? 'Launching...'
                      : coderStatus === 'agent:planning' ? 'Planning...'
                      : coderStatus === 'agent:coding' ? 'Working...'
                      : coderStatus === 'done' ? 'Done'
                      : coderStatus === 'failed' ? 'Failed'
                      : coderStatus.charAt(0).toUpperCase() + coderStatus.slice(1)
                    : 'Starting...'
                  }
                </span>
              </div>

              {/* Build status (if trigger_build is active alongside coder) */}
              {Array.from(activeToolCalls.entries())
                .filter(([, tc]) => tc.name === 'trigger_build')
                .map(([id, tc]) => (
                  <div key={id} className="flex items-center gap-2 text-xs text-slate-600 mb-2">
                    {tc.status === 'running' ? (
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
                    ) : (
                      <span className="w-3.5 h-3.5 rounded-full bg-emerald-100 flex items-center justify-center">
                        <svg className="w-2 h-2 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    )}
                    <span>{tc.status === 'running' ? 'Building preview...' : 'Build complete'}</span>
                  </div>
                ))
              }

              {/* Coder output log — always visible, max 5 lines, auto-scroll */}
              {coderOutput.length > 0 && (
                <div className="mt-1">
                  <div
                    ref={coderLogRef}
                    className="rounded-lg bg-slate-900 text-slate-300 text-[11px] font-mono p-2.5 max-h-[160px] overflow-y-auto leading-relaxed"
                  >
                    {coderOutput.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Loading indicator (no streaming text yet) */}
        {isLoading && !streamingText && activeToolCalls.size === 0 && (
          <div className="flex items-center gap-2 text-slate-400 text-sm">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400 animate-pulse" />
            Thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={isLoading} projectPhase={projectPhase} />
    </>
  )
}
