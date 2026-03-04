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

import { INotebookTracker, NotebookActions } from '@jupyterlab/notebook';
import {
  isAutograderExecution,
  parseGraderOutput
} from '@/utils/autograderDetector';
import { logAutograderEvent } from '@/utils/autograderLogger';

export interface INotebookContext {
  notebookName: string;
  notebookPath: string;
  activeCellIndex: number;

  getNotebookJson: () => string;
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
    Omit<INotebookContext, 'getNotebookJson' | 'getNearestMarkdownCell'>
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

  const getTrackerState = useCallback((): Omit<
    INotebookContext,
    'getNotebookJson' | 'getNearestMarkdownCell'
  > => {
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

  useEffect(() => {
    let cleanup: (() => void) | null = null;

    const setupAutograderLogging = () => {
      if (cleanup) {
        cleanup();
        cleanup = null;
      }

      const panel = notebookTracker.currentWidget;
      if (!panel) {
        return;
      }

      const notebook = panel.content;
      const model = notebook.model;
      if (!model) {
        return;
      }

      const lastLoggedExecutionCount = new Map<number, number | null>();

      const handleAutograderExecution = async (
        cellModel: any,
        cellIndex: number
      ) => {
        if (!cellModel || cellModel.type !== 'code') {
          return;
        }

        const detection = isAutograderExecution(cellModel);
        if (!detection.isGrader) {
          return;
        }

        const executionCount = cellModel.executionCount;
        if (!executionCount || executionCount === null) {
          return;
        }

        const lastLogged = lastLoggedExecutionCount.get(cellIndex);
        if (lastLogged === executionCount) {
          return;
        }

        let outputs: any[] = [];
        if (cellModel.outputs) {
          const cellOutputs = cellModel.outputs;
          if (cellOutputs.length !== undefined) {
            for (let j = 0; j < cellOutputs.length; j++) {
              outputs.push(
                cellOutputs.get ? cellOutputs.get(j) : cellOutputs[j]
              );
            }
          } else if (Array.isArray(cellOutputs)) {
            outputs = cellOutputs;
          }
        }

        if (outputs.length === 0) {
          return;
        }

        let fullOutput = '';
        let hasError = false;

        for (let i = 0; i < outputs.length; i++) {
          const output = outputs[i];
          const parsed = parseGraderOutput(output);

          if (parsed.output) {
            fullOutput += parsed.output;
            if (i < outputs.length - 1) {
              fullOutput += '\n';
            }
          }

          if (!parsed.success) {
            hasError = true;
          }
        }

        const overallSuccess = !hasError && fullOutput.length > 0;
        const graderId = detection.graderId || 'unknown';

        lastLoggedExecutionCount.set(cellIndex, executionCount);

        console.log(
          `[Autograder Logger] ✅ Logging autograder info for cell ${cellIndex}:`,
          {
            grader_id: graderId,
            success: overallSuccess
          }
        );

        await logAutograderEvent({
          grader_id: graderId,
          output: fullOutput.trim(),
          success: overallSuccess,
          notebook: panel.title?.label || ''
        });
      };

      const cells = model.cells;

      const setupCellExecutionListeners = () => {
        const cellConnections: Array<{ disconnect: () => void }> = [];

        for (let i = 0; i < cells.length; i++) {
          const cell = cells.get(i);
          if (cell && cell.type === 'code') {
            if ((cell as any).stateChanged) {
              const handler = () => {
                setTimeout(() => {
                  handleAutograderExecution(cell, i);
                }, 200);
              };
              (cell as any).stateChanged.connect(handler);
              cellConnections.push({
                disconnect: () => (cell as any).stateChanged.disconnect(handler)
              });
            }

            if ((cell as any).outputsChanged) {
              const outputHandler = () => {
                setTimeout(() => {
                  handleAutograderExecution(cell, i);
                }, 100);
              };
              (cell as any).outputsChanged.connect(outputHandler);
              cellConnections.push({
                disconnect: () =>
                  (cell as any).outputsChanged.disconnect(outputHandler)
              });
            }
          }
        }

        return cellConnections;
      };

      const connections: Array<{ disconnect: () => void }> = [];
      let cellConnections: Array<{ disconnect: () => void }> = [];

      const handleCellsChanged = (
        sender: any,
        args: {
          type: string;
          newValues?: any[];
          oldValues?: any[];
          newIndex?: number;
        }
      ) => {
        // Re-setup cell execution listeners when cells are added/changed
        cellConnections.forEach(conn => conn.disconnect());
        cellConnections = setupCellExecutionListeners();
      };

      if (model.cells.changed) {
        model.cells.changed.connect(handleCellsChanged);
        connections.push({
          disconnect: () => model.cells.changed.disconnect(handleCellsChanged)
        });
      }

      cellConnections = setupCellExecutionListeners();

      cleanup = () => {
        connections.forEach(conn => conn.disconnect());
        cellConnections.forEach(conn => conn.disconnect());
      };
    };

    setupAutograderLogging();

    const handleNotebookChanged = () => {
      setupAutograderLogging();
    };

    notebookTracker.currentChanged.connect(handleNotebookChanged);

    return () => {
      notebookTracker.currentChanged.disconnect(handleNotebookChanged);
      if (cleanup) {
        cleanup();
      }
    };
  }, [notebookTracker]);

  const fullContextValue: INotebookContext = {
    ...contextValue,
    getNotebookJson,
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
