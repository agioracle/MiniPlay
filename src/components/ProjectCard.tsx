'use client'

interface ProjectEntry {
  name: string
  path: string
  template: string
  lastOpened: string
  versionCount: number
}

export function ProjectCard({
  project,
  onClick,
  onDelete,
}: {
  project: ProjectEntry
  onClick: () => void
  onDelete: () => void
}) {
  const date = new Date(project.lastOpened)
  const timeAgo = getTimeAgo(date)

  return (
    <div className="relative group">
      <button
        onClick={onClick}
        className="w-full text-left p-4 rounded-xl border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 shadow-sm hover:shadow-md transition-all"
      >
        {/* Thumbnail placeholder */}
        <div className="w-full aspect-[16/9] rounded-lg bg-slate-100 mb-3 flex items-center justify-center overflow-hidden">
          <span className="text-2xl">🎮</span>
        </div>

        <h3 className="text-sm font-medium text-slate-800 group-hover:text-slate-900 truncate">
          {project.name}
        </h3>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[11px] text-slate-400">{timeAgo}</span>
          <span className="text-[11px] text-slate-400">·</span>
          <span className="text-[11px] text-slate-400">v{project.versionCount}</span>
        </div>
      </button>

      {/* Delete button — visible on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-white/80 border border-slate-200 flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:border-red-200 transition-all"
        title="Delete project"
      >
        <svg className="w-3.5 h-3.5 text-slate-400 hover:text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      </button>
    </div>
  )
}

function getTimeAgo(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString()
}
