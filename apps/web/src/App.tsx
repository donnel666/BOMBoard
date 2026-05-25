import { useEffect, useMemo, useRef, useState } from 'react'
import {
  parseBomCoordinateProject,
  parseGerber2DProject,
  type BomCoordinateComponent,
  type Gerber2DInputFile,
} from '@bomboard/parsers'
import {
  createBoardViewer,
  type BoardViewer,
  type BoardViewerSelectionChange,
} from '@bomboard/viewer'

import './App.css'

interface SampleManifest {
  bomFile: string
  coordinateFile: string
  gerberFiles: string[]
}

interface ComponentRow {
  designators: string[]
  designatorLabel: string
  comment: string
  footprint: string
  side: string
}

function App() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<BoardViewer | null>(null)
  const [status, setStatus] = useState('Loading sample data')
  const [error, setError] = useState<string | null>(null)
  const [selectedDesignator, setSelectedDesignator] = useState<string | null>(null)
  const [highlightedDesignators, setHighlightedDesignators] = useState<readonly string[]>([])
  const [components, setComponents] = useState<ComponentRow[]>([])

  useEffect(() => {
    let disposed = false

    async function loadViewer() {
      try {
        const sample = await loadSampleProject()
        if (disposed || !containerRef.current) return

        setComponents(
          createComponentRows(sample.bomCoordinates.components)
        )

        const viewer = await createBoardViewer({
          container: containerRef.current,
          gerber: sample.gerber,
          bomCoordinates: sample.bomCoordinates,
          onSelectionChange: syncSelection,
        })

        if (disposed) {
          viewer.destroy()
          return
        }

        viewerRef.current = viewer
        setStatus('Ready')
      } catch (unknownError) {
        if (!disposed) {
          setError(unknownError instanceof Error ? unknownError.message : String(unknownError))
          setStatus('Failed')
        }
      }
    }

    function syncSelection(event: BoardViewerSelectionChange) {
      setSelectedDesignator(event.state.selectedDesignator)
      setHighlightedDesignators(event.state.highlightedDesignators)
    }

    void loadViewer()

    return () => {
      disposed = true
      viewerRef.current?.destroy()
      viewerRef.current = null
    }
  }, [])

  const highlighted = useMemo(
    () => new Set(highlightedDesignators),
    [highlightedDesignators]
  )

  return (
    <main className="board-app">
      <section className="viewer-shell">
        <div ref={containerRef} className="viewer-canvas" />
        {status !== 'Ready' && (
          <div className="viewer-status" role="status">
            <strong>{status}</strong>
            {error && <span>{error}</span>}
          </div>
        )}
      </section>

      <aside className="component-panel">
        <div className="panel-header">
          <div>
            <p className="panel-label">Sample Board</p>
            <h1>BOMBoard</h1>
          </div>
          <span className="count-badge">{components.length}</span>
        </div>

        <div className="selection-summary">
          <span>Selected</span>
          <strong>{selectedDesignator ?? 'None'}</strong>
          <span>{highlightedDesignators.length} matched</span>
        </div>

        <div className="component-list">
          {components.map(component => {
            const selected = component.designators.includes(selectedDesignator ?? '')
            const matched = component.designators.some(designator => highlighted.has(designator))
            const groupSelected = selected
              && component.designators.every(designator => highlighted.has(designator))
              && highlightedDesignators.every(designator => component.designators.includes(designator))

            return (
              <div
                key={component.designatorLabel}
                className={[
                  'component-row',
                  groupSelected ? 'is-selected' : '',
                  matched ? 'is-matched' : '',
                ].filter(Boolean).join(' ')}
              >
                <div className="component-designators" aria-label={`${component.designatorLabel} components`}>
                  {component.designators.map(designator => {
                    const tagSelected = selectedDesignator === designator
                    const tagOnlySelected = tagSelected
                      && highlightedDesignators.length === 1
                      && highlightedDesignators[0] === designator

                    return (
                      <button
                        type="button"
                        key={designator}
                        className={[
                          'component-tag',
                          tagSelected ? 'is-selected' : '',
                          highlighted.has(designator) ? 'is-matched' : '',
                        ].filter(Boolean).join(' ')}
                        onClick={() => {
                          if (tagOnlySelected) {
                            viewerRef.current?.clearSelection()
                          } else {
                            viewerRef.current?.selectSingleComponent(designator)
                          }
                        }}
                      >
                        {designator}
                      </button>
                    )
                  })}
                </div>

                <button
                  type="button"
                  className="component-identity"
                  onClick={() => {
                    if (groupSelected) {
                      viewerRef.current?.clearSelection()
                    } else {
                      viewerRef.current?.selectComponent(component.designators[0] ?? null)
                    }
                  }}
                >
                  <span className="component-meta">
                    {component.comment || component.footprint}
                  </span>
                  <span className="component-footprint">{component.footprint}</span>
                </button>
              </div>
            )
          })}
        </div>
      </aside>
    </main>
  )
}

async function loadSampleProject() {
  const manifest = await fetchJson<SampleManifest>('/sample-data/manifest.json')
  const [bomBytes, coordinateBytes, gerberFiles] = await Promise.all([
    fetchBytes(`/sample-data/${manifest.bomFile}`),
    fetchBytes(`/sample-data/${manifest.coordinateFile}`),
    Promise.all(manifest.gerberFiles.map(loadGerberFile)),
  ])

  const bomCoordinates = parseBomCoordinateProject({
    bom: { name: manifest.bomFile, bytes: bomBytes },
    coordinates: { name: manifest.coordinateFile, bytes: coordinateBytes },
  })
  const gerber = await parseGerber2DProject(gerberFiles)

  return { bomCoordinates, gerber }
}

function createComponentRows(components: readonly BomCoordinateComponent[]): ComponentRow[] {
  const groups = new Map<string, ComponentRow>()

  for (const component of components) {
    if (!component.placement) continue

    const key = componentRowKey(component)
    const row = groups.get(key) ?? {
      designators: [],
      designatorLabel: '',
      comment: component.bom?.comment ?? component.placement.comment,
      footprint: component.bom?.footprint ?? component.placement.footprint,
      side: component.placement.side,
    }

    row.designators.push(component.designator)
    row.side = mergeSide(row.side, component.placement.side)
    groups.set(key, row)
  }

  return Array.from(groups.values())
    .map(row => {
      const designators = [...row.designators].sort(compareDesignators)
      return {
        ...row,
        designators,
        designatorLabel: designators.join(', '),
      }
    })
    .sort(compareComponentRows)
}

function componentRowKey(component: BomCoordinateComponent): string {
  const placement = component.placement
  const comment = normalizeComparable(component.bom?.comment ?? placement?.comment ?? '')
  const footprint = normalizeComparable(component.bom?.footprint ?? placement?.footprint ?? '')

  if (comment && footprint) return `identity:${comment}|${footprint}`
  return `component:${component.designator}`
}

function normalizeComparable(value: string): string {
  return value.trim().toUpperCase()
}

function mergeSide(left: string, right: string): string {
  if (left === right) return left
  if (left === 'unknown') return right
  if (right === 'unknown') return left
  return 'mixed'
}

function compareComponentRows(left: ComponentRow, right: ComponentRow): number {
  const footprint = left.footprint.localeCompare(right.footprint, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
  if (footprint !== 0) return footprint

  return compareDesignators(left.designators[0] ?? '', right.designators[0] ?? '')
}

function compareDesignators(left: string, right: string): number {
  const leftParts = splitDesignator(left)
  const rightParts = splitDesignator(right)

  if (leftParts !== null && rightParts !== null) {
    const prefix = leftParts.prefix.localeCompare(rightParts.prefix)
    if (prefix !== 0) return prefix
    return leftParts.number - rightParts.number
  }

  return left.localeCompare(right)
}

function splitDesignator(designator: string): { prefix: string; number: number } | null {
  const match = designator.match(/^([A-Za-z]+)(\d+)$/)
  if (!match) return null

  return {
    prefix: match[1] ?? '',
    number: Number.parseInt(match[2] ?? '0', 10),
  }
}

async function loadGerberFile(name: string): Promise<Gerber2DInputFile> {
  const bytes = await fetchBytes(`/sample-data/gerber/${encodeURIComponent(name)}`)
  const text = new TextDecoder('utf-8').decode(bytes)

  return {
    name,
    text,
    file: new File([new Blob([copyBytes(bytes)], { type: 'text/plain' })], name, { type: 'text/plain' }),
  }
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load ${url}`)
  return response.json() as Promise<T>
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to load ${url}`)
  return new Uint8Array(await response.arrayBuffer())
}

export default App
