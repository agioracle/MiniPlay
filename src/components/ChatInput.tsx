'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { ImagePlus, X, Sparkles, Terminal } from 'lucide-react'

export interface ImageAttachment {
  name: string
  mimeType: string
  base64: string
}

interface ChatInputProps {
  onSend: (text: string, images?: ImageAttachment[]) => void
  disabled?: boolean
  projectPhase?: 'gd' | 'code'
}

/** Convert a File object to an ImageAttachment */
async function fileToAttachment(file: File): Promise<ImageAttachment | null> {
  if (!file.type.startsWith('image/')) return null
  const buffer = await file.arrayBuffer()
  const base64 = btoa(
    new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
  )
  return { name: file.name, mimeType: file.type, base64 }
}

/** Convert a list of Files to ImageAttachments */
async function filesToAttachments(files: File[]): Promise<ImageAttachment[]> {
  const results = await Promise.all(files.map(fileToAttachment))
  return results.filter((r): r is ImageAttachment => r !== null)
}

export function ChatInput({ onSend, disabled, projectPhase = 'gd' }: ChatInputProps) {
  const [text, setText] = useState('')
  const [images, setImages] = useState<ImageAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionIndex, setMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropRef = useRef<HTMLDivElement>(null)

  const mentionOptions = [
    { id: 'gd', label: 'GD Agent', prefix: '@gd ', icon: <Sparkles className="w-3.5 h-3.5 text-violet-500" /> },
    { id: 'code', label: 'Code Agent', prefix: '@code ', icon: <Terminal className="w-3.5 h-3.5 text-emerald-600" /> },
  ]

  const addImages = useCallback(async (files: File[]) => {
    const newImages = await filesToAttachments(files)
    if (newImages.length > 0) {
      setImages(prev => [...prev, ...newImages])
    }
  }, [])

  const selectMention = useCallback((option: typeof mentionOptions[0]) => {
    // Replace the trailing @ with the full prefix
    setText(prev => {
      const beforeAt = prev.replace(/@$/, '')
      return beforeAt + option.prefix
    })
    setShowMentionMenu(false)
    textareaRef.current?.focus()
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim()
    if ((!trimmed && images.length === 0) || disabled) return
    onSend(trimmed, images.length > 0 ? images : undefined)
    setText('')
    setImages([])
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [text, images, disabled, onSend])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Mention menu keyboard navigation
    if (showMentionMenu) {
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIndex(prev => (prev - 1 + mentionOptions.length) % mentionOptions.length)
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIndex(prev => (prev + 1) % mentionOptions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        selectMention(mentionOptions[mentionIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowMentionMenu(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value
    setText(newText)

    // Show mention menu when user types @ at the start or after whitespace in code phase
    if (projectPhase === 'code') {
      const cursorPos = e.target.selectionStart || 0
      const charBefore = newText[cursorPos - 2] // char before the @
      const lastChar = newText[cursorPos - 1]

      if (lastChar === '@' && (cursorPos === 1 || charBefore === ' ' || charBefore === '\n')) {
        setShowMentionMenu(true)
        setMentionIndex(0)
      } else if (showMentionMenu) {
        // Close if user typed something else after @
        const textAfterLastAt = newText.slice(newText.lastIndexOf('@') + 1)
        if (!textAfterLastAt.match(/^(p|pm|c|co|cod|code)?$/i)) {
          setShowMentionMenu(false)
        }
      }
    }
  }

  const handleInput = () => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 120)}px`
    }
  }

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      await addImages(Array.from(e.target.files))
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [addImages])

  const removeImage = useCallback((index: number) => {
    setImages(prev => prev.filter((_, i) => i !== index))
  }, [])

  // Clipboard paste — capture images from Ctrl/Cmd+V
  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return

    const imageFiles: File[] = []
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file) imageFiles.push(file)
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault()
      await addImages(imageFiles)
    }
  }, [addImages])

  // Drag & drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    // Only set false if leaving the drop zone (not entering a child)
    const rect = dropRef.current?.getBoundingClientRect()
    if (rect && (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom)) {
      setIsDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files) {
      await addImages(Array.from(e.dataTransfer.files))
    }
  }, [addImages])

  return (
    <div
      ref={dropRef}
      className={`border-t border-slate-200 p-3 transition-colors ${isDragging ? 'bg-indigo-50' : ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Drag overlay hint */}
      {isDragging && (
        <div className="flex items-center justify-center py-2 mb-2 rounded-lg border-2 border-dashed border-indigo-300 text-xs text-indigo-500">
          Drop images here
        </div>
      )}

      {/* Image previews */}
      {images.length > 0 && (
        <div className="flex gap-2 mb-2 px-1 overflow-x-auto">
          {images.map((img, i) => (
            <div key={i} className="relative shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-slate-200 bg-slate-50">
              <img
                src={`data:${img.mimeType};base64,${img.base64}`}
                alt={img.name}
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => removeImage(i)}
                className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/50 flex items-center justify-center hover:bg-black/70 transition-colors"
              >
                <X className="w-2.5 h-2.5 text-white" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="relative">
        {/* @ Mention popup */}
        {showMentionMenu && projectPhase === 'code' && (
          <div className="absolute bottom-full left-0 mb-1 ml-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[160px] z-10">
            {mentionOptions.map((opt, i) => (
              <button
                key={opt.id}
                onClick={() => selectMention(opt)}
                className={`w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors ${
                  i === mentionIndex ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {opt.icon}
                <span className="font-medium">{opt.label}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2 bg-white border border-slate-200 rounded-xl shadow-sm px-3 py-2">
        {/* Image upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled}
          className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 disabled:opacity-30 transition-colors"
          title="Attach image"
        >
          <ImagePlus className="w-4 h-4" />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={handleFileSelect}
        />

        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          onPaste={handlePaste}
          placeholder={projectPhase === 'code' ? 'Tell Code Agent what to build... (@gd to talk to GD Agent)' : 'Describe your game idea...'}
          disabled={disabled}
          className="flex-1 bg-transparent resize-none text-sm text-slate-900 placeholder:text-slate-400 outline-none max-h-[120px]"
        />
        <button
          onClick={handleSubmit}
          disabled={disabled || (!text.trim() && images.length === 0)}
          className="shrink-0 p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
          </svg>
        </button>
        </div>
      </div>
    </div>
  )
}
