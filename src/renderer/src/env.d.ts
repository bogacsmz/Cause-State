import type { CsBridge } from '@shared/ipc'

declare global {
  interface Window {
    cs: CsBridge
  }
}

export {}
