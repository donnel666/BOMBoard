/// <reference types="vite/client" />

declare const __BOMBOARD_VERSION__: string

declare module '*.yaml' {
  const value: Record<string, unknown>
  export default value
}
