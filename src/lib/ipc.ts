/**
 * Typed wrapper around window.miniplay IPC API
 * Provides type-safe access from renderer to main process
 */

export function getIPC() {
  if (typeof window === 'undefined' || !window.miniplay) {
    // SSG / non-Electron environment - return stubs
    return {
      echo: async (msg: string) => `[stub] Echo: ${msg}`,
      onStreamMessage: () => () => {},
    }
  }
  return window.miniplay
}
