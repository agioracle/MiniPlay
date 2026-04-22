'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { ChatMessage, type Message } from '@/components/ChatMessage'
import { ChatInput, type ImageAttachment } from '@/components/ChatInput'
import { Sparkles, Terminal, FileCheck } from 'lucide-react'

const DEFAULT_WELCOME: Message[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content: 'Hi! Tell me about the game you want to create.',
    timestamp: new Date().toISOString(),
  },
]

interface CoderBatch {
  batchId: string
  status: string | null
  output: string[]
  started: boolean
  done: boolean
}

interface ChatPanelProps {
  initialMessages?: Message[]
  onSend: (text: string, images?: ImageAttachment[]) => Promise<{ text?: string; toolCalls?: unknown[]; error?: string; projectCreated?: boolean; gddUpdated?: boolean; success?: boolean }>
  /** Dedicated callback for GDD confirmation — always routes through GD Agent regardless of projectPhase */
  onGddConfirm?: (text: string) => Promise<{ text?: string; toolCalls?: unknown[]; error?: string; projectCreated?: boolean; gddUpdated?: boolean; success?: boolean }>
  projectPhase?: 'gd' | 'code'
  onGddUpdated?: () => void
}

export function ChatPanel({ initialMessages, onSend, onGddConfirm, projectPhase = 'gd', onGddUpdated }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? DEFAULT_WELCOME)
  const [isLoading, setIsLoading] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [activeToolCalls, setActiveToolCalls] = useState<Map<string, { name: string; status: 'running' | 'done' }>>(new Map())
  const [coderBatches, setCoderBatches] = useState<CoderBatch[]>([])
  const [pendingGddConfirm, setPendingGddConfirm] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const coderLogRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const onGddUpdatedRef = useRef(onGddUpdated)
  onGddUpdatedRef.current = onGddUpdated

  // Sync messages when initialMessages prop changes (e.g. opening a different project)
  useEffect(() => {
    setMessages(initialMessages ?? DEFAULT_WELCOME)
  }, [initialMessages])

  // Auto-scroll coder logs to bottom
  useEffect(() => {
    for (const [, el] of coderLogRefs.current) {
      if (el) el.scrollTop = el.scrollHeight
    }
  }, [coderBatches])

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, streamingText, coderBatches])

  // Listen for agent stream events
  useEffect(() => {
    if (typeof window === 'undefined' || !window.miniplay?.onAgentStream) return

    const unsub = window.miniplay.onAgentStream((event) => {
      if (event.type === 'text-delta' && event.text) {
        setStreamingText(prev => prev + event.text)
      } else if (event.type === 'tool-call' && event.toolCallId && event.toolName) {
        if (event.toolName === 'send_to_coder' && event.batchId) {
          // Create a new coder batch
          setCoderBatches(prev => {
            // Don't create duplicate
            if (prev.some(b => b.batchId === event.batchId)) return prev
            return [...prev, {
              batchId: event.batchId!,
              status: null,
              output: [],
              started: false,
              done: false,
            }]
          })
        } else if (event.toolName !== 'send_to_coder') {
          // Non-coder tool call — track in activeToolCalls
          setActiveToolCalls(prev => {
            const next = new Map(prev)
            next.set(event.toolCallId!, { name: event.toolName!, status: 'running' })
            return next
          })
        }
        // send_to_coder without batchId (from GD Agent onChunk) — ignore, the tool's execute() sends its own with batchId
      } else if (event.type === 'coder-status' && event.text && event.batchId) {
        setCoderBatches(prev => prev.map(b =>
          b.batchId === event.batchId
            ? { ...b, status: event.text!, started: true }
            : b
        ))
      } else if (event.type === 'coder-status' && event.text && !event.batchId) {
        // Legacy: update the last active (non-done) batch
        setCoderBatches(prev => {
          let idx = -1
          for (let i = prev.length - 1; i >= 0; i--) {
            if (!prev[i].done) { idx = i; break }
          }
          if (idx < 0) return prev
          const updated = [...prev]
          updated[idx] = { ...updated[idx], status: event.text!, started: true }
          return updated
        })
      } else if (event.type === 'coder-output' && event.text !== undefined) {
        const batchId = event.batchId
        setCoderBatches(prev => {
          let targetIdx: number
          if (batchId) {
            targetIdx = prev.findIndex(b => b.batchId === batchId)
          } else {
            targetIdx = -1
            for (let i = prev.length - 1; i >= 0; i--) {
              if (!prev[i].done) { targetIdx = i; break }
            }
          }
          if (targetIdx < 0) return prev
          const updated = [...prev]
          const batch = updated[targetIdx]
          const newOutput = [...batch.output, event.text!]
          updated[targetIdx] = {
            ...batch,
            output: newOutput.length > 200 ? newOutput.slice(-200) : newOutput,
            started: true,
          }
          return updated
        })
      } else if (event.type === 'tool-result' && event.toolCallId) {
        // Update non-coder tool calls
        setActiveToolCalls(prev => {
          const next = new Map(prev)
          const existing = next.get(event.toolCallId!)
          if (existing) {
            next.set(event.toolCallId!, { ...existing, status: 'done' })
          }
          return next
        })
      } else if (event.type === 'gdd-updated') {
        // GDD has been updated — notify parent to switch to GDD tab
        onGddUpdatedRef.current?.()
        // Mark that we need user confirmation
        setPendingGddConfirm(true)
      } else if (event.type === 'done') {
        if (event.batchId) {
          // Mark specific batch as done
          setCoderBatches(prev => prev.map(b =>
            b.batchId === event.batchId ? { ...b, done: true } : b
          ))
        } else {
          // Legacy GD Agent done — clear streaming text
          setStreamingText('')
        }
      } else if (event.type === 'error') {
        setStreamingText('')
      }
    })

    return unsub
  }, [])

  const handleSendWithFn = useCallback(async (
    text: string,
    sendFn: (text: string, images?: ImageAttachment[]) => Promise<{ text?: string; toolCalls?: unknown[]; error?: string; projectCreated?: boolean; gddUpdated?: boolean; success?: boolean }>,
    images?: ImageAttachment[],
  ) => {
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
    // Clear completed batches, keep active ones
    setCoderBatches(prev => prev.filter(b => !b.done))

    try {
      const result = await sendFn(text, images)
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
    } catch (err) {
      setMessages(prev => [...prev, {
        id: `msg_${Date.now()}_error`,
        role: 'system',
        content: `Error: ${err}`,
        timestamp: new Date().toISOString(),
      }])
    } finally {
      setIsLoading(false)
      setActiveToolCalls(new Map())
    }
  }, [])

  const handleSend = useCallback(async (text: string, images?: ImageAttachment[]) => {
    await handleSendWithFn(text, onSend, images)
  }, [onSend, handleSendWithFn])

  const handleGddConfirm = useCallback(async () => {
    setPendingGddConfirm(false)
    // Use dedicated GD Agent callback to ensure this always goes through GD Agent,
    // not Code Agent (which happens when projectPhase is 'code')
    const sendFn = onGddConfirm || onSend
    await handleSendWithFn('GDD 确认完成，请开始编码', sendFn)
  }, [onGddConfirm, onSend, handleSendWithFn])

  const setCoderLogRef = useCallback((batchId: string, el: HTMLDivElement | null) => {
    if (el) {
      coderLogRefs.current.set(batchId, el)
    } else {
      coderLogRefs.current.delete(batchId)
    }
  }, [])

  // Filter batches that have started (have received at least one status/output event)
  const visibleBatches = coderBatches.filter(b => b.started)

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
        {activeToolCalls.size > 0 && (
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

        {/* GDD Confirm Button — shown after GDD is updated, waiting for user confirmation */}
        {pendingGddConfirm && !isLoading && (
          <div className="flex justify-start">
            <div className="rounded-xl px-4 py-3 max-w-[90%] bg-amber-50 border border-amber-200 mr-8">
              <div className="flex items-center gap-2 mb-2 text-amber-700">
                <FileCheck className="w-4 h-4" />
                <span className="text-xs font-semibold">GDD Ready for Review</span>
              </div>
              <p className="text-xs text-amber-600 mb-3">
                GDD 文档已更新，请在右侧面板查看并确认。确认后将开始编码。
              </p>
              <button
                onClick={handleGddConfirm}
                className="w-full px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors flex items-center justify-center gap-2"
              >
                <FileCheck className="w-3.5 h-3.5" />
                确认 GDD，开始编码
              </button>
            </div>
          </div>
        )}

        {/* Code Agent bubbles — one per batch */}
        {visibleBatches.map((batch) => (
          <div key={batch.batchId} className="flex justify-start">
            <div className="rounded-xl px-3.5 py-2.5 max-w-[90%] bg-emerald-50 text-slate-800 mr-8">
              <div className="flex items-center gap-1.5 mb-2 text-emerald-600">
                <Terminal className="w-3.5 h-3.5" />
                <span className="text-[10px] font-medium">Code Agent</span>
              </div>

              {/* Coder status line */}
              <div className="flex items-center gap-2 text-xs text-slate-600 mb-2">
                {batch.status === 'done' ? (
                  <span className="w-3.5 h-3.5 rounded-full bg-emerald-100 flex items-center justify-center">
                    <svg className="w-2 h-2 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </span>
                ) : batch.status === 'failed' || batch.status?.includes('failed') ? (
                  <span className="w-3.5 h-3.5 rounded-full bg-red-100 flex items-center justify-center">
                    <svg className="w-2 h-2 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </span>
                ) : (
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
                )}
                <span>
                  {batch.status
                    ? batch.status === 'launching' ? 'Launching...'
                      : batch.status === 'agent:planning' ? 'Planning...'
                      : batch.status === 'agent:coding' ? 'Working...'
                      : batch.status === 'done' ? 'Done'
                      : batch.status === 'failed' ? 'Failed'
                      : batch.status.charAt(0).toUpperCase() + batch.status.slice(1)
                    : 'Starting...'
                  }
                </span>
              </div>

              {/* Coder output log */}
              {batch.output.length > 0 && (
                <div className="mt-1">
                  <div
                    ref={(el) => setCoderLogRef(batch.batchId, el)}
                    className="rounded-lg bg-slate-900 text-slate-300 text-[11px] font-mono p-2.5 max-h-40 overflow-y-auto leading-relaxed"
                  >
                    {batch.output.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap break-all">{line}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}

        {/* Loading indicator (no streaming text yet) */}
        {isLoading && !streamingText && activeToolCalls.size === 0 && visibleBatches.length === 0 && (
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
