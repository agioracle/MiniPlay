export {};

declare global {
  interface Window {
    miniplay: import('./electron/preload').MiniPlayAPI;
  }
}
