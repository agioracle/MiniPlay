'use client'

import { useState, useEffect } from 'react'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  onExport: (appid: string, cdn: string) => void
  exporting: boolean
}

export function ExportDialog({ open, onClose, onExport, exporting }: ExportDialogProps) {
  const [appid, setAppid] = useState('')
  const [cdn, setCdn] = useState('')
  const [hasRemoteAssets, setHasRemoteAssets] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    if (!window.miniplay?.exportConfig) return
    setLoading(true)
    window.miniplay.exportConfig().then((config) => {
      setAppid(config.appid || '')
      setCdn(config.cdn || '')
      setHasRemoteAssets(!!config.hasRemoteAssets)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [open])

  if (!open) return null

  const appidValid = appid.trim().length > 0
  const cdnRequired = hasRemoteAssets
  const cdnValid = !cdnRequired || cdn.trim().length > 0
  const canExport = appidValid && cdnValid && !exporting && !loading

  const handleExport = () => {
    if (!canExport) return
    onExport(appid.trim(), cdn.trim())
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/30" onClick={exporting ? undefined : onClose} />

      <div className="relative bg-white border border-slate-200 rounded-2xl p-6 w-[440px] shadow-xl">
        <h2 className="text-lg font-semibold text-slate-900 mb-1">Export WeChat Mini-Game</h2>
        <p className="text-xs text-slate-400 mb-5">Configure export settings before packaging</p>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="w-5 h-5 rounded-full border-2 border-indigo-500 border-t-transparent animate-spin" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* AppID */}
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                WeChat AppID <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={appid}
                onChange={(e) => setAppid(e.target.value)}
                placeholder="wx1234567890abcdef"
                disabled={exporting}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors disabled:opacity-50"
              />
              <p className="text-[10px] text-slate-400 mt-1">
                Get your AppID from <span className="text-slate-500">mp.weixin.qq.com</span> → Development → Development Settings
              </p>
            </div>

            {/* CDN */}
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                CDN URL {cdnRequired && <span className="text-red-400">*</span>}
              </label>
              <input
                type="text"
                value={cdn}
                onChange={(e) => setCdn(e.target.value)}
                placeholder="https://cdn.example.com/games/my-game"
                disabled={exporting}
                className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 transition-colors disabled:opacity-50"
              />
              {cdnRequired ? (
                <div className="mt-1.5 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                  <p className="text-[10px] text-amber-700">
                    Your project has files in <span className="font-mono font-medium">public/remote-assets/</span>.
                    You must provide a CDN URL and upload the remote-assets directory to your CDN before publishing.
                  </p>
                </div>
              ) : (
                <p className="text-[10px] text-slate-400 mt-1">
                  Optional. Required only if your project uses remote assets (audio/images in public/remote-assets/).
                </p>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            disabled={exporting}
            className="px-4 py-2 text-sm text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={!canExport}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors flex items-center gap-1.5"
          >
            {exporting ? (
              <>
                <span className="w-3 h-3 rounded-full border border-white/50 border-t-transparent animate-spin" />
                Exporting...
              </>
            ) : (
              'Export'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
