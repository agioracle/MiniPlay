'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronRight, ChevronDown, Image, Volume2, File, RefreshCw, Plus, Replace, Trash2, X } from 'lucide-react'

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface AssetNode {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  children?: AssetNode[]
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'])
const AUDIO_EXTS = new Set(['.mp3', '.ogg', '.wav', '.aac'])

function getExt(name: string) {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

type AssetCategory = 'image' | 'audio' | 'other'

function getAssetCategory(name: string): AssetCategory {
  const ext = getExt(name)
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (AUDIO_EXTS.has(ext)) return 'audio'
  return 'other'
}

function getDirCategory(dirPath: string): AssetCategory | null {
  const normalised = dirPath.replace(/\\/g, '/').toLowerCase()
  if (/\/images(\/|$)/.test(normalised)) return 'image'
  if (/\/audio(\/|$)/.test(normalised)) return 'audio'
  return null
}

function validateCategoryMatch(fileName: string, targetDir: string): string | null {
  const fileCat = getAssetCategory(fileName)
  const dirCat = getDirCategory(targetDir)
  if (dirCat === 'image' && fileCat !== 'image') return 'Only image files are allowed in images/ directory'
  if (dirCat === 'audio' && fileCat !== 'audio') return 'Only audio files are allowed in audio/ directory'
  if (fileCat === 'image' && dirCat !== null && dirCat !== 'image') return 'Image files should be placed in images/ directory'
  if (fileCat === 'audio' && dirCat !== null && dirCat !== 'audio') return 'Audio files should be placed in audio/ directory'
  return null
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

async function fileToBase64(file: globalThis.File): Promise<string> {
  const buffer = await file.arrayBuffer()
  return btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''))
}

function getAcceptFilter(dirPath: string): string {
  const cat = getDirCategory(dirPath)
  if (cat === 'image') return 'image/*'
  if (cat === 'audio') return 'audio/*'
  return '*/*'
}

function getAcceptFilterForExt(ext: string): string {
  if (IMAGE_EXTS.has(ext)) return `image/${ext.slice(1)}`
  if (AUDIO_EXTS.has(ext)) return `audio/${ext.slice(1)}`
  return '*/*'
}

/* ------------------------------------------------------------------ */
/*  FileIcon                                                          */
/* ------------------------------------------------------------------ */

function FileIcon({ name }: { name: string }) {
  const cat = getAssetCategory(name)
  if (cat === 'image') return <Image className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
  if (cat === 'audio') return <Volume2 className="w-3.5 h-3.5 text-amber-500 shrink-0" />
  return <File className="w-3.5 h-3.5 text-slate-400 shrink-0" />
}

/* ------------------------------------------------------------------ */
/*  TreeNode                                                          */
/* ------------------------------------------------------------------ */

interface TreeNodeProps {
  node: AssetNode
  depth: number
  onRefresh: () => void
  onError: (msg: string) => void
  draggedFile: string | null
  setDraggedFile: (path: string | null) => void
  deleteConfirm: string | null
  setDeleteConfirm: (path: string | null) => void
  selectedFile: string | null
  onSelect: (node: AssetNode | null) => void
}

function TreeNode({ node, depth, onRefresh, onError, draggedFile, setDraggedFile, deleteConfirm, setDeleteConfirm, selectedFile, onSelect }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 2)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const isDir = node.type === 'directory'

  /* --- Drag source (files only) --- */
  const handleDragStart = (e: React.DragEvent) => {
    if (isDir) return
    e.dataTransfer.setData('text/plain', node.path)
    e.dataTransfer.effectAllowed = 'move'
    setDraggedFile(node.path)
  }

  const handleDragEnd = () => {
    setDraggedFile(null)
  }

  /* --- Drop target (directories only) --- */
  const handleDragOver = (e: React.DragEvent) => {
    if (!isDir) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (!isDir || !window.miniplay) return

    const srcPath = e.dataTransfer.getData('text/plain')
    if (!srcPath) return

    const fileName = srcPath.split('/').pop() || ''
    const validationErr = validateCategoryMatch(fileName, node.path)
    if (validationErr) {
      onError(validationErr)
      return
    }

    const result = await window.miniplay.assetsMove({ src: srcPath, dest: node.path })
    if (!result.success) {
      onError(result.error || 'Move failed')
    } else {
      onRefresh()
    }
  }

  /* --- Add file to directory --- */
  const handleAddClick = () => {
    fileInputRef.current?.click()
  }

  const handleAddFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !window.miniplay) return
    if (fileInputRef.current) fileInputRef.current.value = ''

    const validationErr = validateCategoryMatch(file.name, node.path)
    if (validationErr) {
      onError(validationErr)
      return
    }

    const base64 = await fileToBase64(file)
    const result = await window.miniplay.assetsAdd({
      dirPath: node.path,
      fileName: file.name,
      fileBase64: base64,
      fileMimeType: file.type,
    })
    if (!result.success) {
      onError(result.error || 'Add failed')
    } else {
      onRefresh()
    }
  }

  /* --- Replace file --- */
  const handleReplaceClick = () => {
    replaceInputRef.current?.click()
  }

  const handleReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !window.miniplay) return
    if (replaceInputRef.current) replaceInputRef.current.value = ''

    const base64 = await fileToBase64(file)
    const result = await window.miniplay.assetsReplace({
      targetPath: node.path,
      newFileBase64: base64,
      newFileName: file.name,
      newFileMimeType: file.type,
    })
    if (!result.success) {
      onError(result.error || 'Replace failed')
    } else {
      onRefresh()
    }
  }

  /* --- Delete file --- */
  const handleDeleteClick = () => {
    setDeleteConfirm(node.path)
  }

  const handleDeleteConfirm = async () => {
    if (!window.miniplay) return
    const result = await window.miniplay.assetsDelete({ filePath: node.path })
    if (!result.success) {
      onError(result.error || 'Delete failed')
    } else {
      onRefresh()
    }
    setDeleteConfirm(null)
  }

  const paddingLeft = 12 + depth * 16

  /* --- Directory row --- */
  if (isDir) {
    return (
      <div>
        <div
          className={`group flex items-center gap-1.5 py-1 px-2 cursor-pointer select-none hover:bg-slate-50 transition-colors rounded ${
            isDragOver ? 'bg-indigo-50 ring-1 ring-indigo-300' : ''
          }`}
          style={{ paddingLeft }}
          onClick={() => setExpanded(!expanded)}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {expanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
          <span className="text-xs font-medium text-slate-700 truncate flex-1">{node.name}</span>
          <button
            onClick={(e) => { e.stopPropagation(); handleAddClick() }}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-200 transition-all"
            title="Add file"
          >
            <Plus className="w-3 h-3 text-slate-500" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept={getAcceptFilter(node.path)}
            className="hidden"
            onChange={handleAddFile}
          />
        </div>
        {expanded && node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            onRefresh={onRefresh}
            onError={onError}
            draggedFile={draggedFile}
            setDraggedFile={setDraggedFile}
            deleteConfirm={deleteConfirm}
            setDeleteConfirm={setDeleteConfirm}
            selectedFile={selectedFile}
            onSelect={onSelect}
          />
        ))}
      </div>
    )
  }

  /* --- File row --- */
  const isBeingDragged = draggedFile === node.path
  const isDeleteTarget = deleteConfirm === node.path
  const isSelected = selectedFile === node.path
  const ext = getExt(node.name)
  const cat = getAssetCategory(node.name)
  const isPreviewable = cat === 'image' || cat === 'audio'

  return (
    <>
      <div
        className={`group flex items-center gap-1.5 py-1 px-2 select-none transition-colors rounded cursor-pointer ${
          isBeingDragged ? 'opacity-40' : ''
        } ${isSelected ? 'bg-indigo-50' : 'hover:bg-slate-50'}`}
        style={{ paddingLeft }}
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onClick={() => isPreviewable ? onSelect(isSelected ? null : node) : undefined}
      >
        <FileIcon name={node.name} />
        <span className="text-xs text-slate-600 truncate flex-1" title={node.path}>
          {node.name}
        </span>
        {node.size !== undefined && (
          <span className="text-[10px] text-slate-300 shrink-0 mr-1">{formatSize(node.size)}</span>
        )}
        <button
          onClick={handleReplaceClick}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-200 transition-all"
          title="Replace"
        >
          <Replace className="w-3 h-3 text-slate-500" />
        </button>
        <button
          onClick={handleDeleteClick}
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-red-100 transition-all"
          title="Delete"
        >
          <Trash2 className="w-3 h-3 text-red-400" />
        </button>
        <input
          ref={replaceInputRef}
          type="file"
          accept={getAcceptFilterForExt(ext)}
          className="hidden"
          onChange={handleReplaceFile}
        />
      </div>

      {/* Inline delete confirmation */}
      {isDeleteTarget && (
        <div className="flex items-center gap-2 py-1.5 px-3 bg-red-50 border border-red-200 rounded mx-2 mb-1" style={{ marginLeft: paddingLeft }}>
          <span className="text-xs text-red-700 flex-1">Delete <span className="font-medium">{node.name}</span>?</span>
          <button
            onClick={() => setDeleteConfirm(null)}
            className="px-2 py-0.5 text-[10px] text-slate-500 hover:text-slate-700 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDeleteConfirm}
            className="px-2 py-0.5 text-[10px] font-medium text-white bg-red-500 hover:bg-red-600 rounded transition-colors"
          >
            Delete
          </button>
        </div>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  AssetsPanel                                                       */
/* ------------------------------------------------------------------ */

export function AssetsPanel() {
  const [tree, setTree] = useState<AssetNode[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draggedFile, setDraggedFile] = useState<string | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<AssetNode | null>(null)
  const [previewData, setPreviewData] = useState<{ base64: string; mimeType: string } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const errorTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const loadTree = useCallback(async () => {
    if (!window.miniplay?.assetsList) return
    setLoading(true)
    try {
      const result = await window.miniplay.assetsList()
      setTree(result.tree || [])
    } catch {
      showError('Failed to load assets')
    } finally {
      setLoading(false)
    }
  }, [])

  const showError = useCallback((msg: string) => {
    setError(msg)
    if (errorTimer.current) clearTimeout(errorTimer.current)
    errorTimer.current = setTimeout(() => setError(null), 4000)
  }, [])

  const handleSelect = useCallback(async (node: AssetNode | null) => {
    if (!node) {
      setSelectedNode(null)
      setPreviewData(null)
      return
    }
    setSelectedNode(node)
    setPreviewLoading(true)
    setPreviewData(null)
    try {
      const result = await window.miniplay?.assetsRead?.({ filePath: node.path })
      if (result?.base64 && result?.mimeType) {
        setPreviewData({ base64: result.base64, mimeType: result.mimeType })
      }
    } catch {
      // ignore
    } finally {
      setPreviewLoading(false)
    }
  }, [])

  useEffect(() => {
    loadTree()
  }, [loadTree])

  const totalFiles = countFiles(tree)

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-700">Assets</span>
          <span className="text-[10px] text-slate-400">{totalFiles} files</span>
        </div>
        <button
          onClick={loadTree}
          disabled={loading}
          className="p-1 rounded hover:bg-slate-100 transition-colors disabled:opacity-30"
          title="Refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 text-slate-400 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Tree */}
      <div className={`overflow-y-auto py-1 ${selectedNode ? 'flex-1 min-h-0' : 'flex-1'}`}>
        {loading && tree.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <span className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          </div>
        ) : tree.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-slate-400">
            No public/ directory found
          </div>
        ) : (
          tree.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              onRefresh={loadTree}
              onError={showError}
              draggedFile={draggedFile}
              setDraggedFile={setDraggedFile}
              deleteConfirm={deleteConfirm}
              setDeleteConfirm={setDeleteConfirm}
              selectedFile={selectedNode?.path ?? null}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>

      {/* Error toast */}
      {error && (
        <div className="mx-3 mb-2 px-3 py-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      )}

      {/* Asset Preview */}
      {selectedNode && (
        <AssetPreview
          node={selectedNode}
          data={previewData}
          loading={previewLoading}
          onClose={() => { setSelectedNode(null); setPreviewData(null) }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  AssetPreview                                                      */
/* ------------------------------------------------------------------ */

interface AssetPreviewProps {
  node: AssetNode
  data: { base64: string; mimeType: string } | null
  loading: boolean
  onClose: () => void
}

function AssetPreview({ node, data, loading, onClose }: AssetPreviewProps) {
  const cat = getAssetCategory(node.name)
  const dataUrl = data ? `data:${data.mimeType};base64,${data.base64}` : null
  const [dimensions, setDimensions] = useState<{ w: number; h: number } | null>(null)

  // Reset dimensions when node changes
  useEffect(() => {
    setDimensions(null)
  }, [node.path])

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    setDimensions({ w: img.naturalWidth, h: img.naturalHeight })
  }

  return (
    <div className="border-t border-slate-200 shrink-0">
      {/* Preview header */}
      <div className="flex items-center justify-between px-3 py-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileIcon name={node.name} />
          <span className="text-[11px] font-medium text-slate-600 truncate">{node.name}</span>
          {node.size !== undefined && (
            <span className="text-[10px] text-slate-300 shrink-0">{formatSize(node.size)}</span>
          )}
          {dimensions && (
            <span className="text-[10px] text-slate-300 shrink-0">{dimensions.w} x {dimensions.h}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-slate-100 transition-colors shrink-0"
        >
          <X className="w-3 h-3 text-slate-400" />
        </button>
      </div>

      {/* Preview content */}
      <div className="px-3 pb-3">
        {loading ? (
          <div className="flex items-center justify-center h-32 bg-slate-50 rounded-lg">
            <span className="w-4 h-4 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          </div>
        ) : !dataUrl ? (
          <div className="flex items-center justify-center h-20 bg-slate-50 rounded-lg text-xs text-slate-400">
            Unable to load preview
          </div>
        ) : cat === 'image' ? (
          <div className="flex items-center justify-center bg-[repeating-conic-gradient(#f1f5f9_0%_25%,#fff_0%_50%)] bg-[length:16px_16px] rounded-lg overflow-hidden max-h-48">
            <img
              src={dataUrl}
              alt={node.name}
              className="max-w-full max-h-48 object-contain"
              onLoad={handleImageLoad}
            />
          </div>
        ) : cat === 'audio' ? (
          <div className="bg-slate-50 rounded-lg p-3">
            <audio
              controls
              src={dataUrl}
              className="w-full h-8"
              style={{ minHeight: 32 }}
            >
              Your browser does not support the audio element.
            </audio>
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Count total files in tree recursively */
function countFiles(nodes: AssetNode[]): number {
  let count = 0
  for (const n of nodes) {
    if (n.type === 'file') count++
    if (n.children) count += countFiles(n.children)
  }
  return count
}
