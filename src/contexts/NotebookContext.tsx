/**
 * Provides a React context to track the notebook state (e.g. currently opened
 * notebook file, select cell, etc.).
 *
 * See the INotebookTracker interface in @jupyterlab/notebook for reference.
 *
 * In components, use the useNotebook hook to get the notebook state.
 */

import * as React from 'react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState
} from 'react';

import {
  buildStructuredContext,
  sanitizeNotebook,
  type ActiveCellInfo,
  type SanitizedNotebook,
  type StructuredContext
} from '@/utils/notebookSanitizer';
import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';

export interface INotebookContext {
  notebookName: string;
  notebookPath: string;
  activeCellIndex: number;

  getNotebookJson: () => string;
  getFullNotebookJson: () => any;
  getSanitizedNotebook: () => SanitizedNotebook;
  getStructuredContext: () => StructuredContext | null;
  getActiveCellInfo: () => ActiveCellInfo | null;
  getNearestMarkdownCell: () => { cellIndex: number; text: string } | null;
  insertCodeBelowActiveCell?: (code: string) => void;
}

const NotebookContext = createContext<INotebookContext | null>(null);

interface INotebookProviderProps {
  children: React.ReactNode;
  notebookTracker: INotebookTracker;
}

export function NotebookProvider({
  children,
  notebookTracker
}: INotebookProviderProps) {
  const [contextValue, setContextValue] = useState<
    Omit<
      INotebookContext,
      | 'getNotebookJson'
      | 'getFullNotebookJson'
      | 'getSanitizedNotebook'
      | 'getStructuredContext'
      | 'getActiveCellInfo'
      | 'getNearestMarkdownCell'
    >
  >({
    notebookName: '',
    notebookPath: '',
    activeCellIndex: -1
  });

  const getSelectedCellIndex = useCallback((): number => {
    const panel = notebookTracker.currentWidget;
    if (!panel) {
      return -1;
    }

    const notebook = panel.content;
    return notebook?.activeCellIndex ?? -1;
  }, [notebookTracker]);

  const getTrackerState = useCallback((): {
    notebookName: string;
    notebookPath: string;
    activeCellIndex: number;
  } => {
    const panel = notebookTracker.currentWidget;
    const notebookName = panel?.title?.label ?? '';
    const notebookPath = panel?.context?.path ?? '';
    const activeCellIndex = getSelectedCellIndex();

    return { notebookName, notebookPath, activeCellIndex };
  }, [notebookTracker, getSelectedCellIndex]);

  // const getNotebookJson = useCallback(() => {
  //   const model = notebookTracker.currentWidget?.content?.model;

  //   if (!model?.toJSON) {
  //     return '';
  //   }

  //   return JSON.stringify(model.toJSON());
  // }, [notebookTracker]);
  const getNotebookJson = useCallback(() => {
    const model = notebookTracker.currentWidget?.content?.model;
    if (!model?.cells) {
      return '';
    }

    // Temporary truncation limits
    const MAX_CODE_CHARS_PER_CELL = 1000;
    const MAX_MARKDOWN_CHARS_PER_CELL = 300;
    const MAX_TOTAL_CHARS = 20_000;

    let totalChars = 0;
    const cells: { cell_type: string; source: string }[] = [];

    const cellList = model.cells;

    for (let i = 0; i < cellList.length; i++) {
      const cell = cellList.get(i);
      if (!cell) {
        continue;
      }

      const cellJSON = cell.toJSON();

      let source = Array.isArray(cellJSON.source)
        ? cellJSON.source.join('')
        : (cellJSON.source ?? '');

      if (cellJSON.cell_type === 'markdown') {
        source = source.slice(0, MAX_MARKDOWN_CHARS_PER_CELL);
      } else if (cellJSON.cell_type === 'code') {
        source = source.slice(0, MAX_CODE_CHARS_PER_CELL);
      }

      totalChars += source.length;

      // Stop once we exceed global cap
      if (totalChars > MAX_TOTAL_CHARS) {
        break;
      }

      cells.push({
        cell_type: cellJSON.cell_type,
        source
      });
    }

    return JSON.stringify({
      notebookName: notebookTracker.currentWidget?.title?.label ?? '',
      cells
    });
  }, [notebookTracker]);

  // Get the full notebook JSON including outputs (for initial sanitized snapshot)
  const getFullNotebookJson = useCallback(() => {
    const model = notebookTracker.currentWidget?.content?.model;
    if (!model?.cells) {
      return null;
    }

    const cells: any[] = [];
    const cellList = model.cells;

    for (let i = 0; i < cellList.length; i++) {
      const cell = cellList.get(i);
      if (!cell) {
        continue;
      }

      const cellJSON = cell.toJSON();
      cells.push(cellJSON);
    }

    return {
      notebookName: notebookTracker.currentWidget?.title?.label ?? '',
      cells
    };
  }, [notebookTracker]);

  // Get sanitized notebook (removes images, plots, large outputs)
  const getSanitizedNotebook = useCallback((): SanitizedNotebook => {
    const fullNotebook = getFullNotebookJson();
    if (!fullNotebook) {
      return {
        notebookName: 'Untitled',
        cells: [],
        imagesRemoved: 0,
        plotsRemoved: 0,
        largeOutputsRemoved: 0
      };
    }

    return sanitizeNotebook(fullNotebook);
  }, [getFullNotebookJson]);

  // Get active cell information
  const getActiveCellInfo = useCallback((): ActiveCellInfo | null => {
    const sanitized = getSanitizedNotebook();
    const activeCellIndex = getSelectedCellIndex();

    if (activeCellIndex < 0 || activeCellIndex >= sanitized.cells.length) {
      return null;
    }

    const cell = sanitized.cells[activeCellIndex];
    return {
      index: activeCellIndex,
      type: cell.cell_type,
      source: cell.source,
      execution_count: cell.execution_count,
      outputs: cell.outputs
    };
  }, [getSanitizedNotebook, getSelectedCellIndex]);

  const getNearestMarkdownCell = useCallback(() => {
    const panel = notebookTracker.currentWidget;
    if (!panel) {
      return null;
    }

    const notebook = panel.content;
    const model = notebook.model;
    const activeIndex = getSelectedCellIndex();

    if (!model || activeIndex < 0) {
      return null;
    }

    const cells = model.cells;

    for (let i = activeIndex; i >= 0; i--) {
      const cellModel = cells.get(i);
      if (!cellModel) {
        continue;
      }

      if (cellModel.type !== 'markdown') {
        continue;
      }

      const sharedModel = (cellModel as any).sharedModel;
      const source: string | string[] = sharedModel?.source || '';

      const markdownText = Array.isArray(source)
        ? source.join('').trim()
        : (source || '').trim();

      if (markdownText.length > 0) {
        return {
          cellIndex: i,
          text: markdownText
        };
      }
    }

    return null;
  }, [notebookTracker, getSelectedCellIndex]);

  // Get structured context for a request
  const getStructuredContext = useCallback((): StructuredContext | null => {
    const sanitized = getSanitizedNotebook();
    const activeCellIndex = getSelectedCellIndex();
    const nearestMarkdown = getNearestMarkdownCell();

    return buildStructuredContext(sanitized, activeCellIndex, nearestMarkdown);
  }, [getSanitizedNotebook, getSelectedCellIndex, getNearestMarkdownCell]);

  useEffect(() => {
    setContextValue(getTrackerState());

    const handleCurrentChanged = () => {
      setContextValue(getTrackerState());
    };

    const handleActiveCellChanged = () => {
      const index = getSelectedCellIndex();
      setContextValue(prev => ({ ...prev, activeCellIndex: index }));
    };

    notebookTracker.currentChanged.connect(handleCurrentChanged);
    notebookTracker.activeCellChanged.connect(handleActiveCellChanged);

    return () => {
      notebookTracker.currentChanged.disconnect(handleCurrentChanged);
      notebookTracker.activeCellChanged.disconnect(handleActiveCellChanged);
    };
  }, [getTrackerState, getSelectedCellIndex, notebookTracker]);

  const fullContextValue: INotebookContext = {
    ...contextValue,
    getNotebookJson,
    getFullNotebookJson,
    getSanitizedNotebook,
    getStructuredContext,
    getActiveCellInfo,
    getNearestMarkdownCell
  };

  const insertCodeBelowActiveCell = useCallback(
    (code: string) => {
      const panel = notebookTracker.currentWidget;
      if (!panel) {
        return;
      }

      const nb = panel.content;

      try {
        NotebookActions.insertBelow(nb);

        try {
          NotebookActions.changeCellType(nb, 'code');
        } catch (e) {
          console.debug(
            'changeCellType not available or failed, cell may not be converted to code type',
            e
          );
        }

        const newCell = nb.activeCell;
        if (newCell && newCell.model) {
          const modelAny = newCell.model;
          const shared = modelAny.sharedModel ?? null;

          if (shared) {
            shared.setSource(code);
            console.debug('insertCode: wrote via sharedModel.setSource');
          } else {
            console.warn('insertCode: sharedModel not found', newCell.model);
          }
        }
      } catch (e) {
        console.error('Failed to insert code cell', e);
      }
    },
    [notebookTracker]
  );

  fullContextValue.insertCodeBelowActiveCell = insertCodeBelowActiveCell;

  return (
    <NotebookContext.Provider value={fullContextValue}>
      {children}
    </NotebookContext.Provider>
  );
}

export function useNotebook() {
  const context = useContext(NotebookContext);
  if (!context) {
    throw new Error('useNotebook must be used within an NotebookProvider');
  }
  return context;
}
