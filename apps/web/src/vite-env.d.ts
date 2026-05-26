/// <reference types="vite/client" />

declare module '*.yaml' {
  const value: Record<string, unknown>
  export default value
}
