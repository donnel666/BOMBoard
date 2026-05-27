import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { unzipSync } from 'fflate'
import { useTranslation } from 'react-i18next'
import {
  classifyBomCoordinateFile,
  parseBomCoordinateProject,
  parseGerber2DProject,
  selectGerber2DFiles,
  type BomCoordinateComponent,
  type Gerber2DInputFile,
} from '@bomboard/parsers'
import {
  createBoardViewer,
  loadFootprintLibraryForComponents,
  type BoardViewer,
  type BoardViewerSelectionChange,
  type BoardViewerSide,
} from '@bomboard/viewer'

import { appVersion } from './version'
import './App.css'

interface ComponentRow {
  designators: string[]
  designatorLabel: string
  comment: string
  footprint: string
  side: ComponentRowSide
}

interface ProjectImportFile {
  name: string
  bytes: Uint8Array
  file?: File
}

interface PersistedProjectFile {
  name: string
  bytes: Uint8Array
}

interface PersistedProject {
  version: 1
  sourceName: string
  savedAt: number
  files: PersistedProjectFile[]
}

interface PersistedProjectState {
  side: BoardViewerSide
  selectedDesignator: string | null
  bomSearch: string
}

interface OpenProjectOptions {
  persist?: boolean
  restoredState?: PersistedProjectState | null
}

interface UpdateInfo {
  version: string
  url: string
  source: UpdateReleaseSourceId
  feedUrl?: string
}

type UpdateReleaseSourceId = 'gitee' | 'github'

interface UpdateReleaseSource {
  id: UpdateReleaseSourceId
  latestUrl: string
  headers?: HeadersInit
  readTag: (release: Record<string, unknown>) => string | null
  readUrl: (release: Record<string, unknown>, tag: string) => string | null
  readFeedUrl?: (release: Record<string, unknown>, tag: string) => string | null
}

interface UpdateInstallResult {
  ok: boolean
  error?: string
}

type Translate = (key: string, options?: Record<string, unknown>) => string
type ImportStatus = 'idle' | 'loading' | 'ready' | 'failed'
type UpdateInstallStatus = 'idle' | 'installing' | 'failed'
type PassiveKind = 'resistor' | 'capacitor' | 'inductor'
type ComponentRowSide = BoardViewerSide | 'unknown' | 'mixed'
type ComponentSelectionMode = 'group' | 'single'

interface PassiveSortKey {
  kind: PassiveKind | null
  packageAreaMm2: number | null
  packageLabel: string
  valueBaseUnit: number | null
}

interface SmdPackageInfo {
  areaMm2: number
  label: string
}

const passiveKindOrder: Record<PassiveKind, number> = {
  resistor: 0,
  capacitor: 1,
  inductor: 2,
}

const passiveKindByDesignatorPrefix: Record<string, PassiveKind> = {
  R: 'resistor',
  RN: 'resistor',
  RP: 'resistor',
  C: 'capacitor',
  CN: 'capacitor',
  L: 'inductor',
  FB: 'inductor',
}

const smdPackageSizes: Record<string, SmdPackageInfo> = {
  '01005': { areaMm2: 0.4 * 0.2, label: '01005' },
  '0201': { areaMm2: 0.6 * 0.3, label: '0201' },
  '0402': { areaMm2: 1.0 * 0.5, label: '0402' },
  '0603': { areaMm2: 1.6 * 0.8, label: '0603' },
  '0805': { areaMm2: 2.0 * 1.25, label: '0805' },
  '1008': { areaMm2: 2.5 * 2.0, label: '1008' },
  '1206': { areaMm2: 3.2 * 1.6, label: '1206' },
  '1210': { areaMm2: 3.2 * 2.5, label: '1210' },
  '1806': { areaMm2: 4.5 * 1.6, label: '1806' },
  '1812': { areaMm2: 4.5 * 3.2, label: '1812' },
  '2010': { areaMm2: 5.0 * 2.5, label: '2010' },
  '2512': { areaMm2: 6.3 * 3.2, label: '2512' },
  '0201M': { areaMm2: 0.25 * 0.125, label: '0201 metric' },
  '0402M': { areaMm2: 0.4 * 0.2, label: '0402 metric' },
  '0603M': { areaMm2: 0.6 * 0.3, label: '0603 metric' },
  '1005': { areaMm2: 1.0 * 0.5, label: '1005 metric' },
  '1608': { areaMm2: 1.6 * 0.8, label: '1608 metric' },
  '2012': { areaMm2: 2.0 * 1.25, label: '2012 metric' },
  '3216': { areaMm2: 3.2 * 1.6, label: '3216 metric' },
  '3225': { areaMm2: 3.2 * 2.5, label: '3225 metric' },
  '4532': { areaMm2: 4.5 * 3.2, label: '4532 metric' },
  '5025': { areaMm2: 5.0 * 2.5, label: '5025 metric' },
  '6432': { areaMm2: 6.3 * 3.2, label: '6432 metric' },
}

const persistedProjectDbName = 'bomboard-project-cache'
const persistedProjectDbVersion = 1
const persistedProjectStoreName = 'projects'
const persistedProjectKey = 'current'
const persistedProjectStateKey = 'bomboard.currentProjectState'
const openSourceProjectUrl = 'https://github.com/donnel666/BOMBoard'
const updateReleaseSources: readonly UpdateReleaseSource[] = [
  {
    id: 'gitee',
    latestUrl: 'https://gitee.com/api/v5/repos/donnel/BOMBoard/releases/latest',
    headers: {
      Accept: 'application/json',
    },
    readTag: release => stringField(release, 'tagName') ?? stringField(release, 'tag_name'),
    readUrl: (release, tag) => (
      stringField(release, 'htmlUrl')
      ?? stringField(release, 'html_url')
      ?? `https://gitee.com/donnel/BOMBoard/releases/tag/${encodeURIComponent(tag)}`
    ),
    readFeedUrl: (_release, tag) => (
      `https://gitee.com/donnel/BOMBoard/releases/download/${encodeURIComponent(tag)}/`
    ),
  },
  {
    id: 'github',
    latestUrl: 'https://api.github.com/repos/donnel666/BOMBoard/releases/latest',
    headers: {
      Accept: 'application/vnd.github+json',
    },
    readTag: release => stringField(release, 'tag_name'),
    readUrl: release => stringField(release, 'html_url'),
  },
]

function App() {
  const { t } = useTranslation()
  const translate = useCallback<Translate>((key, options) => t(key, options), [t])
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewerRef = useRef<BoardViewer | null>(null)
  const componentListRef = useRef<HTMLDivElement | null>(null)
  const zipInputRef = useRef<HTMLInputElement | null>(null)
  const directoryInputRef = useRef<HTMLInputElement | null>(null)
  const importRunRef = useRef(0)
  const [status, setStatus] = useState<ImportStatus>('loading')
  const [statusMessage, setStatusMessage] = useState(t('status.checkingSavedWorkspace'))
  const [error, setError] = useState<string | null>(null)
  const [projectName, setProjectName] = useState<string | null>(null)
  const [selectedDesignator, setSelectedDesignator] = useState<string | null>(null)
  const [highlightedDesignators, setHighlightedDesignators] = useState<readonly string[]>([])
  const [components, setComponents] = useState<ComponentRow[]>([])
  const [bomSearch, setBomSearch] = useState('')
  const [side, setSide] = useState<BoardViewerSide>('top')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false)
  const [updateInstallStatus, setUpdateInstallStatus] = useState<UpdateInstallStatus>('idle')
  const [updateInstallError, setUpdateInstallError] = useState<string | null>(null)
  const [directorySupported] = useState(() => canSelectDirectory())

  useEffect(() => {
    const input = directoryInputRef.current
    if (!input || !directorySupported) return

    input.setAttribute('webkitdirectory', '')
    input.setAttribute('directory', '')
    ;(input as HTMLInputElement & { webkitdirectory?: boolean }).webkitdirectory = true
  }, [directorySupported])

  useEffect(() => {
    return () => {
      importRunRef.current += 1
      viewerRef.current?.destroy()
      viewerRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false

    void checkForAppUpdate(appVersion)
      .then(info => {
        if (!cancelled) setUpdateInfo(info)
      })
      .catch(() => {
        if (!cancelled) setUpdateInfo(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const highlighted = useMemo(
    () => new Set(highlightedDesignators),
    [highlightedDesignators]
  )
  const bomSearchActive = useMemo(
    () => searchTokens(bomSearch).length > 0,
    [bomSearch]
  )
  const sideComponents = useMemo(
    () => filterComponentRowsBySide(components, side),
    [components, side]
  )
  const filteredComponents = useMemo(
    () => filterComponentRows(bomSearchActive ? components : sideComponents, bomSearch),
    [bomSearch, bomSearchActive, components, sideComponents]
  )

  const syncSelection = useCallback((event: BoardViewerSelectionChange) => {
    setSelectedDesignator(event.state.selectedDesignator)
    setHighlightedDesignators(event.state.highlightedDesignators)
  }, [])

  useEffect(() => {
    if (!selectedDesignator) return

    const list = componentListRef.current
    if (!list) return

    const selectedRow = Array.from(list.querySelectorAll<HTMLElement>('.component-row'))
      .find(row => (row.dataset.designators ?? '').split('\t').includes(selectedDesignator))
    selectedRow?.scrollIntoView({ block: 'nearest' })
  }, [filteredComponents, selectedDesignator])

  const openProject = useCallback(async (
    sourceName: string,
    loadFiles: () => Promise<readonly ProjectImportFile[]>,
    options: OpenProjectOptions = {}
  ) => {
    const restoredState = options.restoredState ?? null
    const runId = importRunRef.current + 1
    importRunRef.current = runId
    viewerRef.current?.destroy()
    viewerRef.current = null

    if (options.persist !== false) clearPersistedProjectState()
    setProjectName(sourceName)
    setStatus('loading')
    setStatusMessage(translate('status.reading', { sourceName }))
    setError(null)
    setSelectedDesignator(null)
    setHighlightedDesignators([])
    setComponents([])
    setBomSearch(restoredState?.bomSearch ?? '')
    setSide(restoredState?.side ?? 'top')

    try {
      const files = await loadFiles()
      if (importRunRef.current !== runId) return

      setStatusMessage(translate('status.validatingProjectFiles'))
      const project = await parseLocalProject(files, translate)
      if (importRunRef.current !== runId) return

      if (!containerRef.current) {
        throw new Error(translate('errors.viewerContainerUnavailable'))
      }

      setStatusMessage(translate('status.loadingFootprintLibrary'))
      const footprintLibrary = await loadFootprintLibraryForComponents(
        project.bomCoordinates.components,
        { baseUrl: `${import.meta.env.BASE_URL}footprints` }
      )
      if (importRunRef.current !== runId) return

      setStatusMessage(translate('status.renderingBoard'))
      const viewer = await createBoardViewer({
        container: containerRef.current,
        gerber: project.gerber,
        bomCoordinates: project.bomCoordinates,
        footprintLibrary,
        side: restoredState?.side ?? 'top',
        showSideControls: false,
        onSelectionChange: syncSelection,
      })
      if (importRunRef.current !== runId) {
        viewer.destroy()
        return
      }

      viewerRef.current = viewer
      setComponents(createComponentRows(project.bomCoordinates.components))
      if (restoredState?.selectedDesignator) {
        viewer.selectComponent(restoredState.selectedDesignator)
      }

      if (options.persist !== false) {
        setStatusMessage(translate('status.savingProject'))
        try {
          await clearPersistedProject(translate)
          await savePersistedProject(sourceName, files, translate)
        } catch (persistError) {
          setError(
            translate('errors.projectOpenedPersistFailed', { error: errorMessage(persistError) })
          )
        }
        if (importRunRef.current !== runId) return
      }

      setSide(viewer.getState().side)
      setStatus('ready')
      setStatusMessage(translate('status.ready'))
    } catch (unknownError) {
      if (importRunRef.current !== runId) return

      viewerRef.current?.destroy()
      viewerRef.current = null
      setProjectName(null)
      setStatus('failed')
      setError(errorMessage(unknownError))
      setStatusMessage(translate('status.projectCouldNotOpen'))
      setComponents([])
    }
  }, [syncSelection, translate])

  const handleZipInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null
    event.currentTarget.value = ''
    if (!file) return

    void openProject(file.name, () => loadZipPackage(file))
  }

  const handleDirectoryInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    if (files.length === 0) return

    const sourceName = directoryNameFromFiles(files, translate('import.selectedDirectory'))
    void openProject(sourceName, () => loadDirectoryFiles(files))
  }

  useEffect(() => {
    let disposed = false

    async function restorePersistedProject() {
      try {
        const persistedProject = await readPersistedProject(translate)
        if (disposed) return

        if (persistedProject === null) {
          setStatus('idle')
          setStatusMessage(translate('status.defaultImportPrompt'))
          return
        }

        const restoredState = readPersistedProjectState()
        await openProject(
          persistedProject.sourceName,
          () => Promise.resolve(persistedProject.files.map(file => ({
            name: file.name,
            bytes: file.bytes,
          }))),
          { persist: false, restoredState }
        )
      } catch (restoreError) {
        if (disposed) return
        setStatus('failed')
        setStatusMessage(translate('status.projectCouldNotOpen'))
        setError(
          translate('errors.failedRestore', { error: errorMessage(restoreError) })
        )
      }
    }

    void restorePersistedProject()

    return () => {
      disposed = true
    }
  }, [openProject, translate])

  useEffect(() => {
    if (status !== 'ready' || projectName === null) return

    writePersistedProjectState({
      side,
      selectedDesignator,
      bomSearch,
    })
  }, [bomSearch, projectName, selectedDesignator, side, status])

  const closeProject = () => {
    importRunRef.current += 1
    viewerRef.current?.destroy()
    viewerRef.current = null
    void clearPersistedProject(translate).catch(clearError => {
      setError(errorMessage(clearError))
    })
    clearPersistedProjectState()
    setProjectName(null)
    setStatus('idle')
    setStatusMessage(translate('status.defaultImportPrompt'))
    setError(null)
    setSelectedDesignator(null)
    setHighlightedDesignators([])
    setComponents([])
    setBomSearch('')
    setSide('top')
  }

  const changeSide = (nextSide: BoardViewerSide) => {
    const viewer = viewerRef.current
    if (!viewer) return

    setSide(nextSide)
    void viewer.setSide(nextSide).catch(unknownError => {
      setError(errorMessage(unknownError))
    })
  }

  const openUpdateDialog = () => {
    if (!updateInfo) return
    setUpdateInstallStatus('idle')
    setUpdateInstallError(null)
    setUpdateDialogOpen(true)
  }

  const closeUpdateDialog = () => {
    if (updateInstallStatus === 'installing') return
    setUpdateDialogOpen(false)
    setUpdateInstallStatus('idle')
    setUpdateInstallError(null)
  }

  const confirmUpdateInstall = () => {
    if (!updateInfo || updateInstallStatus === 'installing') return

    setUpdateInstallStatus('installing')
    setUpdateInstallError(null)

    void installAppUpdate(updateInfo).then(result => {
      if (result.ok) return

      setUpdateInstallStatus('failed')
      setUpdateInstallError(result.error ?? translate('updates.failedGeneric'))
    })
  }

  const selectBomComponent = (
    component: ComponentRow,
    designator: string,
    mode: ComponentSelectionMode
  ) => {
    const viewer = viewerRef.current
    if (!viewer) return

    const run = async () => {
      if (isBoardViewerSide(component.side) && viewer.getState().side !== component.side) {
        await viewer.setSide(component.side)
        setSide(viewer.getState().side)
      }

      if (mode === 'single') {
        viewer.selectSingleComponent(designator)
      } else {
        viewer.selectComponent(designator)
      }
    }

    void run().catch(unknownError => {
      setError(errorMessage(unknownError))
    })
  }

  const renderComponentRows = () => {
    if (components.length === 0) {
      return (
        <div className="empty-component-list">
          {status === 'ready'
            ? t('componentPanel.noPlacedComponents')
            : t('componentPanel.noProjectOpen')}
        </div>
      )
    }

    if (!bomSearchActive && sideComponents.length === 0) {
      return (
        <div className="empty-component-list">
          {t('componentPanel.noPlacedComponents')}
        </div>
      )
    }

    if (filteredComponents.length === 0) {
      return (
        <div className="empty-component-list">
          {t('componentPanel.noSearchMatches')}
        </div>
      )
    }

    return filteredComponents.map(component => {
      const selected = component.designators.includes(selectedDesignator ?? '')
      const matched = component.designators.some(designator => highlighted.has(designator))
      const crossSideLabel = bomSearchActive
        && isBoardViewerSide(component.side)
        && component.side !== side
        ? t(`controls.${component.side}`)
        : null
      const groupSelected = selected
        && component.designators.every(designator => highlighted.has(designator))
        && highlightedDesignators.every(designator => component.designators.includes(designator))

      return (
        <div
          key={component.designatorLabel}
          data-designators={component.designators.join('\t')}
          className={[
            'component-row',
            groupSelected ? 'is-selected' : '',
            matched ? 'is-matched' : '',
            crossSideLabel ? 'is-cross-side' : '',
          ].filter(Boolean).join(' ')}
        >
          <div
            className="component-designators"
            aria-label={t('aria.componentDesignators', { label: component.designatorLabel })}
          >
            {crossSideLabel && (
              <span className="component-side-badge">{crossSideLabel}</span>
            )}
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
                      selectBomComponent(component, designator, 'single')
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
              if (selected) {
                viewerRef.current?.clearSelection()
              } else {
                const primaryDesignator = component.designators[0]
                if (primaryDesignator) selectBomComponent(component, primaryDesignator, 'group')
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
    })
  }

  return (
    <main className="board-app">
      <section className="viewer-shell">
        <div ref={containerRef} className="viewer-canvas" />

        {projectName && status === 'ready' && (
          <div className="project-title" title={projectName}>
            {projectName}
          </div>
        )}

        {status === 'ready' && (
          <div className="viewer-actions" aria-label={t('aria.boardViewControls')}>
            <div className="side-switch" role="group" aria-label={t('aria.boardSide')}>
              <button
                type="button"
                className={side === 'top' ? 'is-active' : ''}
                aria-pressed={side === 'top'}
                onClick={() => changeSide('top')}
              >
                {t('controls.top')}
              </button>
              <button
                type="button"
                className={side === 'bottom' ? 'is-active' : ''}
                aria-pressed={side === 'bottom'}
                onClick={() => changeSide('bottom')}
              >
                {t('controls.bottom')}
              </button>
            </div>
            <button
              type="button"
              className="close-project-button"
              aria-label={t('aria.closeProject')}
              title={t('aria.closeProject')}
              onClick={closeProject}
            >
              X
            </button>
          </div>
        )}

        {status !== 'ready' && (
          <div className="viewer-status" role={status === 'loading' ? 'status' : 'region'}>
            <strong>{status === 'loading' ? t('status.loadingProject') : t('import.openProject')}</strong>
            <span>
              {status === 'loading'
                ? statusMessage
                : t('import.localProjectPrompt')}
            </span>
            {!directorySupported && status !== 'loading' && (
              <span>{t('import.directoryUnsupported')}</span>
            )}
            {error && <span className="viewer-error">{error}</span>}
            {status !== 'loading' && (
              <div className="import-actions">
                <button
                  type="button"
                  className="primary-import-button"
                  onClick={() => zipInputRef.current?.click()}
                >
                  {t('import.selectZip')}
                </button>
                {directorySupported && (
                  <button
                    type="button"
                    className="secondary-import-button"
                    onClick={() => directoryInputRef.current?.click()}
                  >
                    {t('import.selectDirectory')}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        <input
          ref={zipInputRef}
          className="hidden-file-input"
          type="file"
          accept=".zip,application/zip,application/x-zip-compressed"
          onChange={handleZipInput}
        />
        <input
          ref={directoryInputRef}
          className="hidden-file-input"
          type="file"
          multiple
          onChange={handleDirectoryInput}
        />
      </section>

      <aside className="component-panel">
        <div className="panel-header">
          <div className="panel-heading">
            <div className="panel-title-text">
              <p className="panel-label">{projectName ?? t('componentPanel.noProjectLoaded')}</p>
              <h1>{status === 'ready' ? t('componentPanel.components') : t('app.name')}</h1>
            </div>
            <a
              className="bom-github-link"
              href={openSourceProjectUrl}
              target="_blank"
              rel="noreferrer"
              aria-label={t('aria.openSourceProject')}
              title={t('aria.openSourceProject')}
            >
              <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.09.68-.22.68-.49 0-.24-.01-1.04-.01-1.89-2.51.47-3.16-.63-3.36-1.2-.11-.29-.6-1.2-1.03-1.44-.35-.19-.85-.66-.01-.67.79-.01 1.35.74 1.54 1.05.9 1.55 2.34 1.11 2.91.85.09-.67.35-1.11.64-1.37-2.22-.26-4.55-1.14-4.55-5.06 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.3 9.3 0 0 1 12 7.01c.85 0 1.7.12 2.5.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.93-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.59.69.49A10.08 10.08 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"
                />
              </svg>
            </a>
            <button
              type="button"
              className="app-version-badge"
              disabled={!updateInfo}
              title={t('app.versionTitle', { version: appVersion })}
              onClick={openUpdateDialog}
            >
              <span>v{appVersion}</span>
              {updateInfo && <strong>{t('updates.new')}</strong>}
            </button>
          </div>
          <span className="count-badge">{filteredComponents.length}</span>
        </div>

        <div className="selection-summary">
          <span>{t('componentPanel.selected')}</span>
          <strong>{selectedDesignator ?? t('componentPanel.none')}</strong>
          <span>{t('componentPanel.matchedCount', { count: highlightedDesignators.length })}</span>
        </div>

        <div className="component-search">
          <input
            type="search"
            value={bomSearch}
            disabled={components.length === 0}
            placeholder={t('componentPanel.searchPlaceholder')}
            aria-label={t('aria.searchBom')}
            onChange={event => setBomSearch(event.currentTarget.value)}
          />
          {bomSearch && (
            <button
              type="button"
              aria-label={t('aria.clearBomSearch')}
              title={t('aria.clearBomSearch')}
              onClick={() => setBomSearch('')}
            >
              X
            </button>
          )}
        </div>

        <div ref={componentListRef} className="component-list">
          {renderComponentRows()}
        </div>
      </aside>

      {updateDialogOpen && updateInfo && (
        <div className="update-dialog-backdrop" role="presentation" onMouseDown={closeUpdateDialog}>
          <section
            className="update-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="update-dialog-title"
            onMouseDown={event => event.stopPropagation()}
          >
            <div>
              <p>{t('updates.dialogEyebrow')}</p>
              <h2 id="update-dialog-title">{t('updates.dialogTitle', { version: updateInfo.version })}</h2>
            </div>
            <span>{t('updates.dialogBody')}</span>
            {updateInstallStatus === 'failed' && updateInstallError && (
              <strong className="update-dialog-error">{updateInstallError}</strong>
            )}
            <div className="update-dialog-actions">
              <button
                type="button"
                className="secondary-import-button"
                disabled={updateInstallStatus === 'installing'}
                onClick={closeUpdateDialog}
              >
                {t('updates.cancel')}
              </button>
              <button
                type="button"
                className="primary-import-button"
                disabled={updateInstallStatus === 'installing'}
                onClick={confirmUpdateInstall}
              >
                {updateInstallStatus === 'installing' ? t('updates.installing') : t('updates.confirm')}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}

async function loadZipPackage(file: File): Promise<ProjectImportFile[]> {
  const files = unzipImportFiles(new Uint8Array(await file.arrayBuffer()))
  return expandNestedZipFiles(files)
}

async function loadDirectoryFiles(files: readonly File[]): Promise<ProjectImportFile[]> {
  const loaded = await Promise.all(files.map(async file => ({
    name: normalizePath(file.webkitRelativePath || file.name),
    bytes: new Uint8Array(await file.arrayBuffer()),
    file,
  })))

  return expandNestedZipFiles(loaded.filter(isImportFile))
}

async function savePersistedProject(
  sourceName: string,
  files: readonly ProjectImportFile[],
  t: Translate
): Promise<void> {
  await writePersistedProject({
    version: 1,
    sourceName,
    savedAt: Date.now(),
    files: files.map(file => ({
      name: file.name,
      bytes: file.bytes,
    })),
  }, t)
}

async function readPersistedProject(t: Translate): Promise<PersistedProject | null> {
  if (!canUseIndexedDb()) return null

  const db = await openPersistedProjectDb(t)

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(persistedProjectStoreName, 'readonly')
    const request = transaction.objectStore(persistedProjectStoreName).get(persistedProjectKey)

    request.onsuccess = () => {
      const project = request.result
      resolve(isPersistedProject(project) ? project : null)
    }
    request.onerror = () => reject(request.error ?? new Error(t('errors.failedReadSavedProject')))
    transaction.oncomplete = () => db.close()
    transaction.onabort = () => {
      db.close()
      reject(transaction.error ?? new Error(t('errors.savedProjectReadAborted')))
    }
  })
}

async function writePersistedProject(project: PersistedProject, t: Translate): Promise<void> {
  const db = await openPersistedProjectDb(t)

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(persistedProjectStoreName, 'readwrite')
    const request = transaction.objectStore(persistedProjectStoreName).put(project, persistedProjectKey)

    request.onerror = () => reject(request.error ?? new Error(t('errors.failedSaveProject')))
    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
    transaction.onabort = () => {
      db.close()
      reject(transaction.error ?? new Error(t('errors.savedProjectWriteAborted')))
    }
  })
}

async function clearPersistedProject(t: Translate): Promise<void> {
  if (!canUseIndexedDb()) return

  const db = await openPersistedProjectDb(t)

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(persistedProjectStoreName, 'readwrite')
    const request = transaction.objectStore(persistedProjectStoreName).delete(persistedProjectKey)

    request.onerror = () => reject(request.error ?? new Error(t('errors.failedClearSavedProject')))
    transaction.oncomplete = () => {
      db.close()
      resolve()
    }
    transaction.onabort = () => {
      db.close()
      reject(transaction.error ?? new Error(t('errors.savedProjectClearAborted')))
    }
  })
}

function openPersistedProjectDb(t: Translate): Promise<IDBDatabase> {
  if (!canUseIndexedDb()) {
    return Promise.reject(new Error(t('errors.indexedDbUnavailable')))
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(persistedProjectDbName, persistedProjectDbVersion)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(persistedProjectStoreName)) {
        db.createObjectStore(persistedProjectStoreName)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error(t('errors.failedOpenProjectStorage')))
  })
}

function canUseIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isPersistedProject(value: unknown): value is PersistedProject {
  if (typeof value !== 'object' || value === null) return false

  const project = value as Partial<PersistedProject>
  return project.version === 1
    && typeof project.sourceName === 'string'
    && typeof project.savedAt === 'number'
    && Array.isArray(project.files)
    && project.files.every(isPersistedProjectFile)
}

function isPersistedProjectFile(value: unknown): value is PersistedProjectFile {
  if (typeof value !== 'object' || value === null) return false

  const file = value as Partial<PersistedProjectFile>
  return typeof file.name === 'string' && file.bytes instanceof Uint8Array
}

function readPersistedProjectState(): PersistedProjectState | null {
  try {
    const raw = localStorage.getItem(persistedProjectStateKey)
    if (!raw) return null

    const state = JSON.parse(raw) as Partial<PersistedProjectState>
    if (!isBoardViewerSide(state.side)) return null

    return {
      side: state.side,
      selectedDesignator: typeof state.selectedDesignator === 'string'
        ? state.selectedDesignator
        : null,
      bomSearch: typeof state.bomSearch === 'string' ? state.bomSearch : '',
    }
  } catch {
    return null
  }
}

function writePersistedProjectState(state: PersistedProjectState): void {
  try {
    localStorage.setItem(persistedProjectStateKey, JSON.stringify(state))
  } catch {
    // Ignore UI-state persistence failures; the project data remains the source of truth.
  }
}

function clearPersistedProjectState(): void {
  try {
    localStorage.removeItem(persistedProjectStateKey)
  } catch {
    // Ignore storage cleanup failures because closing the in-memory project is still valid.
  }
}

function isBoardViewerSide(value: unknown): value is BoardViewerSide {
  return value === 'top' || value === 'bottom'
}

async function parseLocalProject(files: readonly ProjectImportFile[], t: Translate) {
  if (files.length === 0) {
    throw new Error(t('errors.missingReadableFiles'))
  }

  const bomFile = selectBomCoordinateFile(files, 'bom')
  if (!bomFile) {
    throw new Error(t('errors.missingBomFile'))
  }

  const coordinateFile = selectBomCoordinateFile(files, 'coordinates')
  if (!coordinateFile) {
    throw new Error(t('errors.missingCoordinateFile'))
  }

  const gerberFiles = files.map(toGerberInputFile)
  const gerberSelection = selectGerber2DFiles(gerberFiles)

  if (gerberSelection.tracespaceFiles.length === 0) {
    throw new Error(t('errors.missingGerberFiles'))
  }

  if (gerberSelection.drillFiles.length === 0) {
    throw new Error(t('errors.missingDrillFile'))
  }

  const bomCoordinates = parseBomCoordinateProject({
    bom: { name: bomFile.name, bytes: bomFile.bytes },
    coordinates: { name: coordinateFile.name, bytes: coordinateFile.bytes },
  })

  if (bomCoordinates.bom.components.length === 0) {
    throw new Error(t('errors.emptyBomDesignators'))
  }

  if (bomCoordinates.coordinates.placements.length === 0) {
    throw new Error(t('errors.emptyCoordinatePlacements'))
  }

  const gerber = await parseGerber2DProject(gerberFiles)
  return { bomCoordinates, gerber }
}

function filterComponentRows(rows: readonly ComponentRow[], query: string): ComponentRow[] {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return [...rows]

  return rows.filter(row => tokens.every(token => componentRowMatchesSearch(row, token)))
}

function filterComponentRowsBySide(
  rows: readonly ComponentRow[],
  side: BoardViewerSide
): ComponentRow[] {
  return rows.filter(row => row.side === side)
}

function componentRowMatchesSearch(row: ComponentRow, token: string): boolean {
  const fields = [
    row.designatorLabel,
    ...row.designators,
    row.comment,
    row.footprint,
    row.side,
  ]

  return fields.some(field => fuzzySearchMatch(field, token))
}

function searchTokens(query: string): string[] {
  return query
    .split(/[\s,;|/]+/)
    .map(normalizeSearchText)
    .filter(Boolean)
}

function fuzzySearchMatch(value: string, normalizedToken: string): boolean {
  const normalizedValue = normalizeSearchText(value)
  if (!normalizedValue) return false
  return normalizedValue.includes(normalizedToken)
    || isOrderedSubsequence(normalizedToken, normalizedValue)
}

function normalizeSearchText(value: string): string {
  return value
    .toUpperCase()
    .replaceAll(/[ΩΩ]/g, 'R')
    .replaceAll(/[µΜμ]/g, 'U')
    .replace(/[^A-Z0-9]+/g, '')
}

function isOrderedSubsequence(needle: string, haystack: string): boolean {
  let needleIndex = 0
  for (const character of haystack) {
    if (character === needle[needleIndex]) needleIndex += 1
    if (needleIndex === needle.length) return true
  }

  return false
}

function selectBomCoordinateFile(
  files: readonly ProjectImportFile[],
  kind: 'bom' | 'coordinates'
): ProjectImportFile | null {
  const matches = files
    .filter(file => classifyBomCoordinateFile({ name: file.name, bytes: file.bytes }).kind === kind)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    }))

  return matches[0] ?? null
}

function toGerberInputFile(file: ProjectImportFile): Gerber2DInputFile {
  const name = baseName(file.name)
  const text = new TextDecoder('utf-8').decode(file.bytes)
  const sourceFile = file.file ?? new File(
    [new Blob([copyBytes(file.bytes)], { type: 'text/plain' })],
    name,
    { type: 'text/plain' }
  )

  return {
    name: file.name,
    text,
    file: sourceFile,
  }
}

function isImportFile(file: ProjectImportFile): boolean {
  const name = normalizePath(file.name)
  const fileName = baseName(name)
  if (!name || name.endsWith('/')) return false
  if (name.startsWith('__MACOSX/') || name.includes('/__MACOSX/')) return false
  if (fileName.startsWith('.')) return false
  return true
}

function expandNestedZipFiles(
  files: readonly ProjectImportFile[],
  depth = 0
): ProjectImportFile[] {
  if (depth > 2) return [...files]

  return files.flatMap(file => {
    if (!isZipFileName(file.name)) return [file]

    try {
      return expandNestedZipFiles(unzipImportFiles(file.bytes, zipEntryPrefix(file.name)), depth + 1)
    } catch {
      return []
    }
  })
}

function unzipImportFiles(bytes: Uint8Array, prefix = ''): ProjectImportFile[] {
  const unzipped = unzipSync(bytes)
  return Object.entries(unzipped)
    .map(([name, entryBytes]) => ({
      name: normalizePath(`${prefix}${name}`),
      bytes: entryBytes,
    }))
    .filter(isImportFile)
}

function isZipFileName(name: string): boolean {
  return baseName(name).toLowerCase().endsWith('.zip')
}

function zipEntryPrefix(name: string): string {
  const normalized = normalizePath(name)
  const parentPath = normalized.includes('/')
    ? `${normalized.slice(0, normalized.lastIndexOf('/') + 1)}`
    : ''
  const zipName = baseName(normalized).replace(/\.zip$/i, '')
  return `${parentPath}${zipName}/`
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+/, '')
}

function baseName(pathOrName: string): string {
  return pathOrName.split('/').pop() ?? pathOrName
}

function directoryNameFromFiles(files: readonly File[], fallbackName: string): string {
  const relativePath = files.find(file => file.webkitRelativePath)?.webkitRelativePath
  const directoryName = relativePath?.split('/').find(Boolean)
  return directoryName || fallbackName
}

function canSelectDirectory(): boolean {
  if (typeof document === 'undefined') return false
  return 'webkitdirectory' in document.createElement('input')
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
  const side = placement?.side ?? 'unknown'

  if (comment && footprint) return `identity:${side}|${comment}|${footprint}`
  return `component:${side}|${component.designator}`
}

function normalizeComparable(value: string): string {
  return value.trim().toUpperCase()
}

function mergeSide(left: ComponentRowSide, right: ComponentRowSide): ComponentRowSide {
  if (left === right) return left
  if (left === 'unknown') return right
  if (right === 'unknown') return left
  return 'mixed'
}

function compareComponentRows(left: ComponentRow, right: ComponentRow): number {
  const passiveSort = comparePassiveComponentRows(left, right)
  if (passiveSort !== 0) return passiveSort

  const comment = left.comment.localeCompare(right.comment, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
  if (comment !== 0) return comment

  const footprint = left.footprint.localeCompare(right.footprint, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
  if (footprint !== 0) return footprint

  return compareDesignators(left.designators[0] ?? '', right.designators[0] ?? '')
}

function comparePassiveComponentRows(left: ComponentRow, right: ComponentRow): number {
  const leftKey = passiveSortKey(left)
  const rightKey = passiveSortKey(right)

  if (leftKey.kind === null && rightKey.kind === null) return 0
  if (leftKey.kind !== null && rightKey.kind === null) return -1
  if (leftKey.kind === null && rightKey.kind !== null) return 1
  if (leftKey.kind === null || rightKey.kind === null) return 0

  const leftKind = leftKey.kind
  const rightKind = rightKey.kind
  const kindOrder = passiveKindOrder[leftKind] - passiveKindOrder[rightKind]
  if (kindOrder !== 0) return kindOrder

  const packageOrder = compareNullableNumbers(leftKey.packageAreaMm2, rightKey.packageAreaMm2)
  if (packageOrder !== 0) return packageOrder

  const packageLabel = leftKey.packageLabel.localeCompare(rightKey.packageLabel, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
  if (packageLabel !== 0) return packageLabel

  return compareNullableNumbers(leftKey.valueBaseUnit, rightKey.valueBaseUnit)
}

function passiveSortKey(row: ComponentRow): PassiveSortKey {
  const kind = passiveKindForRow(row)
  if (kind === null) {
    return {
      kind,
      packageAreaMm2: null,
      packageLabel: '',
      valueBaseUnit: null,
    }
  }

  const packageInfo = parseSmdPackageInfo(row.footprint) ?? parseSmdPackageInfo(row.comment)
  if (!isSurfaceMountPassiveRow(row, packageInfo)) {
    return {
      kind: null,
      packageAreaMm2: null,
      packageLabel: '',
      valueBaseUnit: null,
    }
  }

  return {
    kind,
    packageAreaMm2: packageInfo?.areaMm2 ?? null,
    packageLabel: packageInfo?.label ?? '',
    valueBaseUnit: parsePassiveValue(kind, row.comment),
  }
}

function isSurfaceMountPassiveRow(row: ComponentRow, packageInfo: SmdPackageInfo | null): boolean {
  if (packageInfo !== null) return true

  const searchable = `${row.footprint} ${row.comment}`.toUpperCase()
  return /\b(?:SMD|SMT|CHIP|MLCC)\b/.test(searchable)
}

function passiveKindForRow(row: ComponentRow): PassiveKind | null {
  const prefix = designatorPrefix(row.designators[0] ?? '')
  const prefixKind = prefix ? passiveKindByDesignatorPrefix[prefix] : undefined
  if (prefixKind) return prefixKind

  const searchable = `${row.comment} ${row.footprint}`.toLowerCase()
  if (/\bres(?:istor)?\b/.test(searchable)) return 'resistor'
  if (/\bcap(?:acitor)?\b/.test(searchable)) return 'capacitor'
  if (/\bind(?:uctor)?\b/.test(searchable)) return 'inductor'
  return null
}

function designatorPrefix(designator: string): string | null {
  const match = designator.match(/^[A-Za-z]+/)
  return match?.[0]?.toUpperCase() ?? null
}

function parseSmdPackageInfo(text: string): SmdPackageInfo | null {
  const normalized = text.toUpperCase()
  const candidates: SmdPackageInfo[] = []
  const dimensionPackage = parseDimensionPackageInfo(normalized)
  if (dimensionPackage) candidates.push(dimensionPackage)

  for (const match of normalized.matchAll(/(?:^|[^0-9])(\d{4})\s*(?:METRIC|M)(?=$|[^A-Z0-9])/g)) {
    const token = match[1] ?? ''
    const metricPackage = smdPackageSizes[`${token}M`] ?? smdPackageSizes[token]
    if (metricPackage) candidates.push(metricPackage)
  }

  for (const token of knownSmdPackageTokens()) {
    const tokenPattern = new RegExp(`(?:^|[^0-9])${token}(?=$|[^0-9])`)
    if (tokenPattern.test(normalized)) candidates.push(smdPackageSizes[token])
  }

  return candidates
    .filter((candidate): candidate is SmdPackageInfo => Boolean(candidate))
    .sort((left, right) => left.areaMm2 - right.areaMm2 || left.label.localeCompare(right.label))[0] ?? null
}

function parseDimensionPackageInfo(text: string): SmdPackageInfo | null {
  const mmMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:MM)?\s*[X*]\s*(\d+(?:\.\d+)?)\s*MM\b/)
  const decimalMatch = text.match(/(\d+\.\d+)\s*[X*]\s*(\d+\.\d+)/)
  const match = mmMatch ?? decimalMatch
  if (!match) return null

  const length = Number.parseFloat(match[1] ?? '')
  const width = Number.parseFloat(match[2] ?? '')
  if (!Number.isFinite(length) || !Number.isFinite(width) || length <= 0 || width <= 0) return null

  const smaller = Math.min(length, width)
  const larger = Math.max(length, width)
  return {
    areaMm2: smaller * larger,
    label: `${larger}x${smaller}mm`,
  }
}

function knownSmdPackageTokens(): string[] {
  return Object.keys(smdPackageSizes)
    .filter(token => !token.endsWith('M'))
    .sort((left, right) => right.length - left.length || left.localeCompare(right))
}

function parsePassiveValue(kind: PassiveKind, text: string): number | null {
  const normalized = normalizePassiveValueText(text)
  if (!normalized || /\b(?:DNP|DNI|NC|OPEN|N\/A|NA)\b/.test(normalized)) return null

  switch (kind) {
    case 'resistor':
      return parseResistanceOhms(normalized)
    case 'capacitor':
      return parseCapacitanceFarads(normalized)
    case 'inductor':
      return parseInductanceHenries(normalized)
  }
}

function normalizePassiveValueText(text: string): string {
  return text
    .toUpperCase()
    .replaceAll(',', '.')
    .replaceAll(/[ΩΩ]/g, 'R')
    .replaceAll(/[µΜμ]/g, 'U')
}

function parseResistanceOhms(text: string): number | null {
  const decimalMarker = parseDecimalMarkerValue(text, 'RKM', unit => {
    if (unit === 'K') return 1_000
    if (unit === 'M') return 1_000_000
    return 1
  })
  if (decimalMarker !== null) return decimalMarker

  const direct = text.match(/(?:^|[^A-Z0-9.])(\d+(?:\.\d+)?)\s*(R|OHMS?|K(?:OHMS?)?|M(?:OHMS?)?|MEG)(?=$|[^A-Z0-9])/)
  if (direct) {
    const amount = Number.parseFloat(direct[1] ?? '')
    if (!Number.isFinite(amount)) return null
    return amount * resistanceMultiplier(direct[2] ?? 'R')
  }

  const bare = text.trim().match(/^(\d+(?:\.\d+)?)$/)
  if (!bare) return null

  const amount = Number.parseFloat(bare[1] ?? '')
  return Number.isFinite(amount) ? amount : null
}

function parseCapacitanceFarads(text: string): number | null {
  const decimalMarker = parseDecimalMarkerValue(text, 'PNUMF', capacitanceMultiplier)
  if (decimalMarker !== null) return decimalMarker

  const direct = text.match(/(?:^|[^A-Z0-9.])(\d+(?:\.\d+)?)\s*(PF|NF|UF|MF|F|P|N|U|M)(?=$|[^A-Z0-9])/)
  if (direct) {
    const amount = Number.parseFloat(direct[1] ?? '')
    if (!Number.isFinite(amount)) return null
    return amount * capacitanceMultiplier(direct[2] ?? 'F')
  }

  const eiaCode = text.trim().match(/^(\d{2})(\d)$/)
  if (!eiaCode) return null

  const significant = Number.parseInt(eiaCode[1] ?? '', 10)
  const multiplier = Number.parseInt(eiaCode[2] ?? '', 10)
  if (!Number.isFinite(significant) || !Number.isFinite(multiplier)) return null
  return significant * 10 ** multiplier * 1e-12
}

function parseInductanceHenries(text: string): number | null {
  const decimalMarker = parseDecimalMarkerValue(text, 'NUMH', inductanceMultiplier)
  if (decimalMarker !== null) return decimalMarker

  const resistorStyleDecimal = parseDecimalMarkerValue(text, 'R', () => 1e-6)
  if (resistorStyleDecimal !== null) return resistorStyleDecimal

  const direct = text.match(/(?:^|[^A-Z0-9.])(\d+(?:\.\d+)?)\s*(NH|UH|MH|H|N|U|M)(?=$|[^A-Z0-9])/)
  if (direct) {
    const amount = Number.parseFloat(direct[1] ?? '')
    if (!Number.isFinite(amount)) return null
    return amount * inductanceMultiplier(direct[2] ?? 'H')
  }

  const eiaCode = text.trim().match(/^(\d{2})(\d)$/)
  if (eiaCode) {
    const significant = Number.parseInt(eiaCode[1] ?? '', 10)
    const multiplier = Number.parseInt(eiaCode[2] ?? '', 10)
    if (!Number.isFinite(significant) || !Number.isFinite(multiplier)) return null
    return significant * 10 ** multiplier * 1e-6
  }

  const bare = text.trim().match(/^(\d+(?:\.\d+)?)$/)
  if (!bare) return null

  const amount = Number.parseFloat(bare[1] ?? '')
  return Number.isFinite(amount) ? amount * 1e-6 : null
}

function parseDecimalMarkerValue(
  text: string,
  unitCharacters: string,
  multiplierForUnit: (unit: string) => number
): number | null {
  const pattern = new RegExp(`(?:^|[^A-Z0-9.])(\\d*)([${unitCharacters}])(\\d+)(?=$|[^A-Z0-9])`)
  const match = text.match(pattern)
  if (!match) return null

  const whole = match[1] ? Number.parseInt(match[1], 10) : 0
  const fraction = Number.parseFloat(`0.${match[3] ?? ''}`)
  if (!Number.isFinite(whole) || !Number.isFinite(fraction)) return null
  return (whole + fraction) * multiplierForUnit(match[2] ?? '')
}

function resistanceMultiplier(unit: string): number {
  if (unit.startsWith('K')) return 1_000
  if (unit.startsWith('M') || unit === 'MEG') return 1_000_000
  return 1
}

function capacitanceMultiplier(unit: string): number {
  if (unit.startsWith('P')) return 1e-12
  if (unit.startsWith('N')) return 1e-9
  if (unit.startsWith('U')) return 1e-6
  if (unit.startsWith('M')) return 1e-3
  return 1
}

function inductanceMultiplier(unit: string): number {
  if (unit.startsWith('N')) return 1e-9
  if (unit.startsWith('U')) return 1e-6
  if (unit.startsWith('M')) return 1e-3
  return 1
}

function compareNullableNumbers(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0
  if (left !== null && right === null) return -1
  if (left === null && right !== null) return 1
  if (left === null || right === null) return 0

  const difference = left - right
  if (Math.abs(difference) < 1e-18) return 0
  return difference < 0 ? -1 : 1
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

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

async function installAppUpdate(updateInfo: UpdateInfo): Promise<UpdateInstallResult> {
  const desktopUpdater = getDesktopUpdater()
  if (desktopUpdater) return desktopUpdater.install(updateInfo)

  window.location.assign(updateInfo.url)
  return { ok: true }
}

interface BomBoardWindow {
  bomboard?: {
    updater?: {
      install: (updateInfo: UpdateInfo) => Promise<UpdateInstallResult>
    }
  }
}

function getDesktopUpdater() {
  return (window as Window & BomBoardWindow).bomboard?.updater ?? null
}

async function checkForAppUpdate(currentVersion: string): Promise<UpdateInfo | null> {
  const current = parseComparableVersion(currentVersion)
  if (!current) return null

  for (const source of updateReleaseSources) {
    const updateInfo = await checkReleaseSourceForUpdate(source, current).catch(() => null)
    if (updateInfo) return updateInfo
  }

  return null
}

async function checkReleaseSourceForUpdate(
  source: UpdateReleaseSource,
  current: ComparableVersion
): Promise<UpdateInfo | null> {
  const response = await fetch(source.latestUrl, {
    cache: 'no-store',
    headers: source.headers,
  })
  if (!response.ok) return null

  const release = await response.json() as Record<string, unknown>
  const tag = source.readTag(release)
  if (!tag) return null

  const url = source.readUrl(release, tag)
  if (!url) {
    return null
  }

  const latest = parseComparableVersion(tag)
  if (!latest || compareVersions(latest, current) <= 0) return null

  return {
    version: formatVersionTag(latest.raw),
    url,
    source: source.id,
    feedUrl: source.readFeedUrl?.(release, tag) ?? undefined,
  }
}

function stringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key]
  return typeof field === 'string' && field.length > 0 ? field : null
}

interface ComparableVersion {
  raw: string
  major: number
  minor: number
  patch: number
  prerelease: string | null
}

function parseComparableVersion(value: string): ComparableVersion | null {
  const normalized = value.trim().replace(/^refs\/tags\//, '').replace(/^v/i, '')
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/)
  if (!match) return null

  const major = Number.parseInt(match[1] ?? '', 10)
  const minor = Number.parseInt(match[2] ?? '', 10)
  const patch = Number.parseInt(match[3] ?? '', 10)
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null

  return {
    raw: normalized,
    major,
    minor,
    patch,
    prerelease: match[4] ?? null,
  }
}

function compareVersions(left: ComparableVersion, right: ComparableVersion): number {
  const numericDifference =
    left.major - right.major
    || left.minor - right.minor
    || left.patch - right.patch
  if (numericDifference !== 0) return numericDifference

  if (left.prerelease === null && right.prerelease !== null) return 1
  if (left.prerelease !== null && right.prerelease === null) return -1
  if (left.prerelease === right.prerelease) return 0

  return (left.prerelease ?? '').localeCompare(right.prerelease ?? '', undefined, { numeric: true })
}

function formatVersionTag(version: string): string {
  return version.startsWith('v') || version.startsWith('V') ? version : `v${version}`
}

export default App
