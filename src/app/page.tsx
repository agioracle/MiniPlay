'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { SetupWizard } from '@/components/setup/SetupWizard'
import { EnvCheckScreen } from '@/components/EnvCheckScreen'
import { WaveDotsBackground } from '@/components/WaveDotsBackground'
import { TopBar } from '@/components/TopBar'
import { ChatPanel } from '@/components/ChatPanel'
import { RightPanel, type RightPanelHandle } from '@/components/RightPanel'
import { ProjectCard } from '@/components/ProjectCard'
import { HeroSection } from '@/components/HeroSection'
import { SettingsDialog } from '@/components/SettingsDialog'
import type { Message } from '@/components/ChatMessage'
import type { ImageAttachment } from '@/components/ChatInput'
import { sessionStore } from '@/lib/sessionStore'

type AppView = 'loading' | 'setup' | 'env-check' | 'home' | 'workspace'
type ProjectPhase = 'gd' | 'code'

interface ProjectEntry {
  name: string
  path: string
  template: string
  lastOpened: string
  versionCount: number
  thumbnail: string | null
}

export default function Home() {
  const [view, setView] = useState<AppView>('loading')
  const [projects, setProjects] = useState<ProjectEntry[]>([])
  const [restoredMessages, setRestoredMessages] = useState<Message[] | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<ProjectEntry | null>(null)
  const [projectPhase, setProjectPhase] = useState<ProjectPhase>('gd')
  const [settingsOpen, setSettingsOpen] = useState(false)
  /**
   * The project currently foregrounded in the workspace view.
   * `null` on home and during the pre-project GD phase (no project exists yet).
   */
  const [activeProjectPath, setActiveProjectPath] = useState<string | null>(null)
  /**
   * Projects that currently have a running Coder task. Driven by the
   * `coder:running-changed` broadcast plus an initial `coder:running-list`
   * fetch when the home view mounts. Used to render the Running badge on
   * ProjectCard.
   */
  const [runningPaths, setRunningPaths] = useState<Set<string>>(new Set())
  const rightPanelRef = useRef<RightPanelHandle>(null)

  const handleGddUpdated = useCallback(() => {
    // Switch RightPanel to GDD tab when GDD is updated
    rightPanelRef.current?.switchToGdd()
  }, [])

  const loadProjects = useCallback(async () => {
    if (window.miniplay?.projectList) {
      const list = await window.miniplay.projectList()
      setProjects(list)
    }
  }, [])

  useEffect(() => {
    async function init() {
      if (typeof window === 'undefined' || !window.miniplay) {
        setView('home')
        return
      }
      try {
        const hydrated = await window.miniplay.hydrationCheck()
        if (!hydrated) {
          setView('setup')
          return
        }
        await loadProjects()
        setView('env-check')
      } catch {
        setView('home')
      }
    }
    init()
  }, [])

  // Subscribe to the global running-list broadcast once, regardless of view.
  // Keeping this at the top level means we never miss a transition (e.g. a
  // Coder task finishing while the user is on the home screen).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.miniplay) return

    let disposed = false

    // Seed with the current snapshot so the badge is correct immediately,
    // not only after the next change.
    window.miniplay.coderRunningList?.().then((res) => {
      if (disposed) return
      if (res && Array.isArray(res.runningPaths)) {
        setRunningPaths(new Set(res.runningPaths))
      }
    }).catch(() => { /* best-effort */ })

    const unsub = window.miniplay.onCoderRunningChanged?.((data) => {
      setRunningPaths(new Set(data.runningPaths || []))
    })

    return () => {
      disposed = true
      unsub?.()
    }
  }, [])

  const handleNewGame = useCallback(() => {
    setRestoredMessages(null)
    setProjectPhase('gd')
    setActiveProjectPath(null)
    setView('workspace')
  }, [])

  const handleOpenProject = useCallback(async (project: ProjectEntry) => {
    if (!window.miniplay?.projectOpen) {
      setView('workspace')
      return
    }
    try {
      const data = await window.miniplay.projectOpen(project.path)
      if (data.error) {
        console.error('Failed to open project:', data.error)
        return
      }
      // Convert stored messages to UI messages
      const msgs: Message[] = data.messages.map((m: any) => ({
        id: m.id,
        role: m.role === 'tool' ? 'system' : m.role,
        content: m.content,
        timestamp: m.timestamp,
        toolCalls: m.toolCalls,
        images: m.images,
      }))
      setRestoredMessages(msgs)
      setProjectPhase('code') // Existing project → skip PM, go directly to Code Agent
      setActiveProjectPath(data.projectPath)
      // `data.hasRunningCoder` is surfaced by the backend as a hint that a
      // Coder task is still in-flight for this project. The ChatPanel will
      // hydrate from CoderBuffer on mount either way (it always calls
      // `coder:subscribe`), so we don't need to branch on it here — but we
      // log it for observability while diagnosing parallel-session issues.
      if (data.hasRunningCoder) {
        console.log('[Home] Opening project with running Coder:', data.projectPath)
      }
      setView('workspace')
    } catch (err) {
      console.error('Failed to open project:', err)
    }
  }, [])

  const handleBackToHome = useCallback(async () => {
    setRestoredMessages(null)
    setProjectPhase('gd')
    // Deactivate (not close): keep the CoderSession alive in the background,
    // only drop foreground state and stop the Vite preview server. A running
    // Coder task will continue writing to its buffer; the badge on the home
    // card will remain green until the task finishes.
    window.miniplay?.projectDeactivate?.()
    // Clear any buffered pre-project messages (those keyed to `__none__`).
    // Project-scoped pendingMessages are retained so they flush next time we
    // open that project.
    window.miniplay?.agentClearPending?.()
    setActiveProjectPath(null)
    if (window.miniplay?.projectList) {
      const list = await window.miniplay.projectList()
      setProjects(list)
    }
    setView('home')
  }, [])

  const handleDeleteProject = useCallback(async (project: ProjectEntry) => {
    if (!window.miniplay?.projectDelete) return
    try {
      // projectDelete goes through the full close-then-delete path in the
      // backend: it kills the CoderSession first (SIGTERM → 3s → SIGKILL),
      // then removes files. That ordering is critical to avoid the
      // child-writing-to-deleted-dir race.
      const result = await window.miniplay.projectDelete(project.path)
      if (result.success) {
        setProjects(prev => prev.filter(p => p.path !== project.path))
        setRunningPaths(prev => {
          if (!prev.has(project.path)) return prev
          const next = new Set(prev)
          next.delete(project.path)
          return next
        })
        // Drop renderer-side in-memory session state so the deleted project's
        // batches/transcript don't linger until a full reload. The backend has
        // already cleared its CoderBuffer via closeSession; this takes care of
        // the renderer mirror.
        sessionStore.forgetProject(project.path)
      } else {
        console.error('Failed to delete project:', result.error)
      }
    } catch (err) {
      console.error('Failed to delete project:', err)
    } finally {
      setDeleteConfirm(null)
    }
  }, [])

  // GD phase: send to GD Agent (Game Designer LLM) with optional images as base64
  const handleGdSend = useCallback(async (text: string, images?: ImageAttachment[]) => {
    if (!window.miniplay?.agentSend) {
      return { text: `[Dev mode] You said: ${text}` }
    }
    const result = await window.miniplay.agentSend({ message: text, images })
    if (result.projectCreated) {
      console.log('[Phase] Project created → switching to Code Agent phase')
      setProjectPhase('code')
      // After `create_project` runs, ask the backend for the freshly-bound
      // active project so ChatPanel/RightPanel can re-key their session
      // state from the sentinel `__none__` bucket to the real path.
      try {
        const active = await window.miniplay.projectActive?.()
        if (active) setActiveProjectPath(active)
      } catch {
        // best-effort
      }
    }
    return result
  }, [])

  // Code phase: send directly to Code Agent, save images to project dir and pass paths
  const handleCoderSend = useCallback(async (text: string, images?: ImageAttachment[]) => {
    if (!window.miniplay?.coderSend) {
      return { error: 'Coder Agent not available' }
    }
    const result = await window.miniplay.coderSend({ message: text, images })
    return result
  }, [])

  // Unified send handler for code phase: supports @gd to route to GD Agent
  const handleCodePhaseSend = useCallback(async (text: string, images?: ImageAttachment[]) => {
    const gdMatch = text.match(/^@gd\s+([\s\S]*)$/i)
    if (gdMatch) {
      // Route to GD Agent with the text after @gd
      return handleGdSend(gdMatch[1].trim(), images)
    }
    // Default: route to Code Agent
    return handleCoderSend(text, images)
  }, [handleGdSend, handleCoderSend])

  if (view === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen">
        <span className="w-6 h-6 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
      </div>
    )
  }

  if (view === 'setup') {
    return <SetupWizard onComplete={async () => { await loadProjects(); setView('home') }} />
  }

  if (view === 'env-check') {
    return <EnvCheckScreen onContinue={() => { setView('home') }} />
  }

  if (view === 'home') {
    return (
      <div className="relative flex flex-col h-screen bg-slate-50">
        <WaveDotsBackground />
        <header
          className="relative z-10 flex items-center justify-between h-12 px-4 border-b border-slate-200 bg-white/60 backdrop-blur-sm"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="w-20 shrink-0" />
          <h1 className="text-sm font-semibold tracking-wide text-slate-800">MiniPlay</h1>
          <button
            onClick={() => setSettingsOpen(true)}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            title="Settings"
          >
            <svg className="w-4 h-4 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a6.759 6.759 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </header>

        <main className="relative z-10 flex-1 overflow-y-auto p-8">
          <div className="max-w-3xl mx-auto">
            <HeroSection />
            <h2 className="text-2xl font-serif text-slate-900 mb-6">Your Games</h2>

            <div className="grid grid-cols-3 gap-4">
              {/* New Game card */}
              <button
                onClick={handleNewGame}
                className="p-4 rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 bg-white hover:bg-indigo-50/50 transition-all flex flex-col items-center justify-center min-h-45 group"
              >
                <div className="w-12 h-12 rounded-full bg-indigo-50 group-hover:bg-indigo-100 flex items-center justify-center mb-3 transition-colors">
                  <svg className="w-6 h-6 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-slate-600 group-hover:text-indigo-600">New Game</span>
              </button>

              {/* Existing projects */}
              {projects.map(p => (
                <ProjectCard
                  key={p.path}
                  project={p}
                  running={runningPaths.has(p.path)}
                  onClick={() => handleOpenProject(p)}
                  onDelete={() => setDeleteConfirm(p)}
                />
              ))}
            </div>

            {projects.length === 0 && (
              <p className="text-sm text-slate-500 mt-8 text-center">
                No games yet. Click &quot;New Game&quot; to start creating!
              </p>
            )}
          </div>
        </main>

        {/* Settings dialog */}
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        {/* Delete confirmation dialog */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50" onClick={() => setDeleteConfirm(null)}>
            <div className="absolute inset-0 bg-black/30" />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div
                className="pointer-events-auto bg-white rounded-2xl p-6 w-90 card-shadow"
                onClick={e => e.stopPropagation()}
              >
                <h3 className="text-lg font-serif text-slate-900 mb-2">Delete Project</h3>
                <p className="text-sm text-slate-600 mb-1">
                  Are you sure you want to delete <span className="font-medium">&quot;{deleteConfirm.name}&quot;</span>?
                </p>
                <p className="text-xs text-slate-400 mb-5">
                  This will permanently remove all project files, conversation history, and version history.
                  {runningPaths.has(deleteConfirm.path) && (
                    <>
                      {' '}
                      <span className="text-amber-600">
                        A Coder task is currently running — it will be terminated first.
                      </span>
                    </>
                  )}
                </p>
                <div className="flex justify-end gap-2">
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDeleteProject(deleteConfirm)}
                    className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // Workspace view
  return (
    <div className="flex flex-col h-screen">
      <TopBar onBack={handleBackToHome} />
      <main className="flex flex-1 min-h-0">
        <div className="w-[40%] border-r border-slate-200 flex flex-col bg-[#F8F8F7]">
          <ChatPanel
            initialMessages={restoredMessages ?? undefined}
            onSend={projectPhase === 'gd' ? handleGdSend : handleCodePhaseSend}
            onGddConfirm={handleGdSend}
            projectPhase={projectPhase}
            onGddUpdated={handleGddUpdated}
            projectPath={activeProjectPath}
          />
        </div>
        <div className="w-[60%]">
          <RightPanel
            ref={rightPanelRef}
            autoPreview={restoredMessages !== null}
            projectPath={activeProjectPath}
          />
        </div>
      </main>
    </div>
  )
}
