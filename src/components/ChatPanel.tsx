'use client'

import { useState, useRef, useEffect, useCallback, useSyncExternalStore } from 'react'
import { ChatMessage, type Message } from '@/components/ChatMessage'
import { ChatInput, type ImageAttachment } from '@/components/ChatInput'
import { Sparkles, Terminal, FileCheck, StopCircle } from 'lucide-react'
import { sessionStore, type ProjectSessionState } from '@/lib/sessionStore'

const DEFAULT_WELCOME: Message[] = [
  {
    id: 'welcome',
    role: 'assistant',
    content: 'Hi! Tell me about the game you want to create.',
    timestamp: new Date().toISOString(),
  },
]

/**
 * Sentinel project identifier used by the store to key pre-project GD
 * conversations (before `create_project` runs). Matches the backend
 * `__none__` bucket semantics in `electron/ipc/agent.ts`.
 */
const PRE_PROJECT_KEY = '__none__'

interface ChatPanelProps {
  initialMessages?: Message[]
  onSend: (text: string, images?: ImageAttachment[]) => Promise<{ text?: string; toolCalls?: unknown[]; error?: string; projectCreated?: boolean; gddUpdated?: boolean; success?: boolean }>
  /** Dedicated callback for GDD confirmation — always routes through GD Agent regardless of projectPhase */
  onGddConfirm?: (text: string) => Promise<{ text?: string; toolCalls?: unknown[]; error?: string; projectCreated?: boolean; gddUpdated?: boolean; success?: boolean }>
  projectPhase?: 'gd' | 'code'
  onGddUpdated?: () => void
  /**
   * The currently-viewed project path. `null` means no project exists yet
   * (pre-project GD thread). Used as the SessionStore key so only events
   * for this project mutate our rendered state.
   */
  projectPath?: string | null
}

export function ChatPanel({
  initialMessages,
  onSend,
  onGddConfirm,
  projectPhase = 'gd',
  onGddUpdated,
  projectPath,
}: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages ?? DEFAULT_WELCOME)
  const [isLoading, setIsLoading] = useState(false)
  const [pendingGddConfirm, setPendingGddConfirm] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const coderLogRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const onGddUpdatedRef = useRef(onGddUpdated)
  onGddUpdatedRef.current = onGddUpdated

  // Key used to store per-project session state. Normalizes null to the
  // pre-project sentinel so the store can still serve a snapshot.
  const storeKey = projectPath ?? PRE_PROJECT_KEY

  // Bind the SessionStore entry for this project. Re-subscribing on
  // projectPath change ensures background-project events never repaint the
  // current view.
  const state = useSyncExternalStore<ProjectSessionState>(
    useCallback((cb) => sessionStore.subscribe(storeKey, cb), [storeKey]),
    useCallback(() => sessionStore.getSnapshot(storeKey), [storeKey]),
    useCallback(() => sessionStore.getSnapshot(storeKey), [storeKey]),
  )

  // Sync messages when initialMessages prop changes (e.g. opening a different project)
  useEffect(() => {
    setMessages(initialMessages ?? DEFAULT_WELCOME)
  }, [initialMessages])

  // Auto-scroll coder logs to bottom
  useEffect(() => {
    for (const [, el] of coderLogRefs.current) {
      if (el) el.scrollTop = el.scrollHeight
    }
  }, [state.batches])

  // Auto-scroll chat
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, state.streamingText, state.batches])

  /**
   * Mount-time subscription:
   *
   *   Step 1 — Register the live `onAgentStream` listener FIRST. If we were
   *            to subscribe (Step 2) before attaching this handler, any
   *            events emitted by the main process between the subscribe
   *            call and the snapshot arrival would be dropped (no listener
   *            attached yet, and they would not appear in the snapshot
   *            either — they were emitted AFTER `getSnapshot()` captured
   *            its view).
   *
   *   Step 2 — Fetch the CoderBuffer snapshot for this project and hydrate
   *            it through the store. The store's internal seq dedupe
   *            discards any event already applied in Step 1.
   *
   * The order is load-bearing; do not reverse.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || !window.miniplay?.onAgentStream) return

    const unsub = window.miniplay.onAgentStream((event) => {
      // Cross-project filter — discard events not intended for the currently
      // displayed project. For pre-project GD turns the backend sends
      // `projectPath: null`; we accept those only while we're in the
      // pre-project view.
      const targetKey = event.projectPath == null ? PRE_PROJECT_KEY : event.projectPath
      if (targetKey !== storeKey) return

      sessionStore.ingestEvent(storeKey, event)

      if (event.type === 'gdd-updated') {
        onGddUpdatedRef.current?.()
        setPendingGddConfirm(true)
      }
    })

    // Hydrate only when this is a real project (pre-project bucket has no
    // backend CoderBuffer since no coder runs exist yet).
    if (projectPath) {
      sessionStore.hydrateFromBackend(projectPath).catch((err) => {
        console.error('[ChatPanel] hydrateFromBackend failed:', err)
      })
    }

    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey])

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
    // Reset transient session state (streaming text, non-coder tool calls,
    // completed batches). In-flight batches are preserved so parallel Coder
    // runs are not lost when the user sends a follow-up message.
    sessionStore.beginUserTurn(storeKey)

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
    }
  }, [storeKey])

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

  const handleStop = useCallback(() => {
    if (!projectPath) return
    sessionStore.cancel(projectPath)
  }, [projectPath])

  // Filter batches that have started (have received at least one status/output event)
  const visibleBatches = state.batches.filter(b => b.started)

  return (
    <>
      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.map(msg => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

        {/* Streaming text (GD Agent phase) */}
        {isLoading && state.streamingText && (
          <div className="flex justify-start">
            <div className="rounded-xl px-3.5 py-2.5 max-w-[90%] bg-slate-100 text-slate-800 mr-8">
              <div className="flex items-center gap-1.5 mb-1 text-violet-500">
                <Sparkles className="w-3.5 h-3.5" />
                <span className="text-[10px] font-medium">GD Agent</span>
              </div>
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{state.streamingText}<span className="inline-block w-3.5 h-3.5 ml-1 align-middle rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" /></div>
            </div>
          </div>
        )}

        {/* GD Agent tool calls (non-coder tools only) */}
        {state.activeToolCalls.size > 0 && (
          <div className="space-y-1.5">
            {Array.from(state.activeToolCalls.entries()).map(([id, tc]) => (
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
        {visibleBatches.map((batch) => {
          const isRunning = !batch.done && !batch.cancelled
          return (
            <div key={batch.batchId} className="flex justify-start">
              <div className="rounded-xl px-3.5 py-2.5 max-w-[90%] bg-emerald-50 text-slate-800 mr-8">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 text-emerald-600">
                    <Terminal className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-medium">Code Agent</span>
                  </div>
                  {/* Stop button — only while running, only when we have a real projectPath */}
                  {isRunning && projectPath && (
                    <button
                      onClick={handleStop}
                      className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded bg-white/60 hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors"
                      title="Stop this Coder task"
                    >
                      <StopCircle className="w-3 h-3" />
                      Stop
                    </button>
                  )}
                </div>

                {/* Coder status line */}
                <div className="flex items-center gap-2 text-xs text-slate-600 mb-2">
                  {batch.cancelled ? (
                    <span className="w-3.5 h-3.5 rounded-full bg-amber-100 flex items-center justify-center">
                      <svg className="w-2 h-2 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </span>
                  ) : batch.status === 'done' ? (
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
                    {batch.cancelled ? 'Cancelled' :
                      batch.status
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
          )
        })}

        {/* Loading indicator (no streaming text yet) */}
        {isLoading && !state.streamingText && state.activeToolCalls.size === 0 && visibleBatches.length === 0 && (
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
