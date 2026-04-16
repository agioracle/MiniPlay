'use client'

import { useState, useEffect, useCallback } from 'react'
import { SetupWizard } from '@/components/setup/SetupWizard'
import { EnvCheckScreen } from '@/components/EnvCheckScreen'
import { WaveDotsBackground } from '@/components/WaveDotsBackground'
import { TopBar } from '@/components/TopBar'
import { ChatPanel } from '@/components/ChatPanel'
import { RightPanel } from '@/components/RightPanel'
import { ProjectCard } from '@/components/ProjectCard'
import { HeroSection } from '@/components/HeroSection'
import { SettingsDialog } from '@/components/SettingsDialog'
import type { Message } from '@/components/ChatMessage'
import type { ImageAttachment } from '@/components/ChatInput'

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
        // Load project list
        if (window.miniplay.projectList) {
          const list = await window.miniplay.projectList()
          setProjects(list)
        }
        setView('env-check')
      } catch {
        setView('home')
      }
    }
    init()
  }, [])

  const handleNewGame = useCallback(() => {
    setRestoredMessages(null)
    setProjectPhase('gd')
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
      setView('workspace')
    } catch (err) {
      console.error('Failed to open project:', err)
    }
  }, [])

  const handleBackToHome = useCallback(async () => {
    setRestoredMessages(null)
    setProjectPhase('gd')
    // Close active project — clears state and stops preview server
    window.miniplay?.projectClose?.()
    // Clear any buffered pre-project messages
    window.miniplay?.agentClearPending?.()
    if (window.miniplay?.projectList) {
      const list = await window.miniplay.projectList()
      setProjects(list)
    }
    setView('home')
  }, [])

  const handleDeleteProject = useCallback(async (project: ProjectEntry) => {
    if (!window.miniplay?.projectDelete) return
    try {
      const result = await window.miniplay.projectDelete(project.path)
      if (result.success) {
        setProjects(prev => prev.filter(p => p.path !== project.path))
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
    return <SetupWizard onComplete={() => { setView('home') }} />
  }

  if (view === 'env-check') {
    return <EnvCheckScreen onContinue={() => { setView('home') }} />
  }

  if (view === 'home') {
    return (
      <div className="relative flex flex-col h-screen bg-[#FAFAF8]">
        <WaveDotsBackground />
        <header
          className="relative z-10 flex items-center justify-between h-12 px-4 border-b border-slate-200/60 bg-white/60 backdrop-blur-sm"
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
            <h2 className="text-xl font-semibold text-slate-900 mb-6">Your Games</h2>

            <div className="grid grid-cols-3 gap-4">
              {/* New Game card */}
              <button
                onClick={handleNewGame}
                className="p-4 rounded-xl border-2 border-dashed border-slate-300 hover:border-indigo-400 bg-white hover:bg-indigo-50/50 transition-all flex flex-col items-center justify-center min-h-[180px] group"
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
                className="pointer-events-auto bg-white border border-slate-200 rounded-2xl p-6 w-[360px] shadow-xl"
                onClick={e => e.stopPropagation()}
              >
                <h3 className="text-base font-semibold text-slate-900 mb-2">Delete Project</h3>
                <p className="text-sm text-slate-600 mb-1">
                  Are you sure you want to delete <span className="font-medium">&quot;{deleteConfirm.name}&quot;</span>?
                </p>
                <p className="text-xs text-slate-400 mb-5">
                  This will permanently remove all project files, conversation history, and version history.
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
            projectPhase={projectPhase}
          />
        </div>
        <div className="w-[60%]">
          <RightPanel autoPreview={restoredMessages !== null} />
        </div>
      </main>
    </div>
  )
}
