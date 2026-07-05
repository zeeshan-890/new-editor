/// <reference types="electron-vite/node" />

interface Window {
  electronAPI: import('../preload/index').ElectronAPI
}
