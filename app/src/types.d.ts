import type { RendererAPI } from '../electron/types'

declare global {
  interface Window {
    api: RendererAPI
  }
}

export {}

