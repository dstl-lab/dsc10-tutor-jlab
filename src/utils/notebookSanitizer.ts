/**
 * Sanitizes Jupyter notebook JSON to remove images, plots, and other large outputs
 * while preserving the core structure and code/markdown content.
 */

export interface ISanitizedNotebook {
  notebookName: string;
  cells: ISanitizedCell[];
  imagesRemoved: number;
  plotsRemoved: number;
  largeOutputsRemoved: number;
}

export interface ISanitizedCell {
  cell_type: 'code' | 'markdown';
  source: string;
  execution_count?: number | null;
  outputs?: ISanitizedOutput[];
}

export interface ISanitizedOutput {
  output_type: 'stream' | 'display_data' | 'execute_result' | 'error';
  text?: string;
  name?: string;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

interface IRawNotebook {
  notebookName?: string;
  cells?: any[];
  metadata?: any;
}

interface IRawCell {
  cell_type: string;
  source: string | string[];
  outputs?: any[];
  execution_count?: number | null;
  metadata?: any;
}

interface IRawOutput {
  output_type: string;
  data?: Record<string, unknown>;
  metadata?: any;
  text?: string;
  name?: string;
  ename?: string;
  evalue?: string;
  traceback?: string[];
}

const LARGE_OUTPUT_THRESHOLD = 5000; // characters

// MIME types to remove (images, plots, interactive visualizations)
const BLOCKED_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/svg+xml',
  'application/vnd.plotly.v1+json', // Plotly
  'application/vnd.vega.v5+json', // Vega/Altair
  'application/vnd.vegalite.v4+json',
  'application/vnd.vegalite.v5+json',
  'text/html' // HTML outputs (often interactive visualizations)
]);

/**
 * Removes large outputs and blocked MIME types from output data
 */
function sanitizeOutput(output: IRawOutput): ISanitizedOutput | null {
  // Remove outputs with blocked MIME types
  if (output.data) {
    for (const mimeType of Object.keys(output.data)) {
      if (BLOCKED_MIME_TYPES.has(mimeType)) {
        return null;
      }
    }
  }

  // Sanitize based on output type
  const sanitized: ISanitizedOutput = {
    output_type: output.output_type as
      | 'stream'
      | 'display_data'
      | 'execute_result'
      | 'error'
  };

  switch (output.output_type) {
    case 'stream':
      if (output.text) {
        const text = Array.isArray(output.text)
          ? output.text.join('')
          : output.text;
        if (text.length > LARGE_OUTPUT_THRESHOLD) {
          // Truncate large stream outputs
          sanitized.text =
            text.substring(0, LARGE_OUTPUT_THRESHOLD) + '\n... (truncated)';
        } else {
          sanitized.text = text;
        }
        if (output.name) {
          sanitized.name = output.name;
        }
      }
      break;

    case 'execute_result':
      if (output.data) {
        // Prefer text/plain for execute_result
        if (output.data['text/plain']) {
          let text = output.data['text/plain'];
          if (Array.isArray(text)) {
            text = text.join('');
          }
          const textStr = String(text);
          if (textStr.length > LARGE_OUTPUT_THRESHOLD) {
            sanitized.text =
              textStr.substring(0, LARGE_OUTPUT_THRESHOLD) +
              '\n... (truncated)';
          } else {
            sanitized.text = textStr;
          }
        }
      }
      break;

    case 'display_data':
      if (output.data && output.data['text/plain']) {
        let text = output.data['text/plain'];
        if (Array.isArray(text)) {
          text = text.join('');
        }
        const textStr = String(text);
        if (textStr.length > LARGE_OUTPUT_THRESHOLD) {
          sanitized.text =
            textStr.substring(0, LARGE_OUTPUT_THRESHOLD) + '\n... (truncated)';
        } else {
          sanitized.text = textStr;
        }
      }
      break;

    case 'error':
      if (output.ename) {
        sanitized.ename = output.ename;
      }
      if (output.evalue) {
        sanitized.evalue = output.evalue;
      }
      if (output.traceback) {
        sanitized.traceback = output.traceback;
      }
      break;
  }

  return sanitized;
}

/**
 * Sanitizes a single cell, removing large outputs and blocked MIME types
 */
function sanitizeCell(cell: IRawCell): ISanitizedCell {
  const sanitized: ISanitizedCell = {
    cell_type: cell.cell_type as 'code' | 'markdown',
    source:
      typeof cell.source === 'string'
        ? cell.source
        : Array.isArray(cell.source)
          ? cell.source.join('')
          : ''
  };

  if (cell.cell_type === 'code') {
    if (cell.execution_count !== undefined) {
      sanitized.execution_count = cell.execution_count;
    }

    if (cell.outputs && Array.isArray(cell.outputs)) {
      sanitized.outputs = [];
      for (const output of cell.outputs) {
        const sanitizedOutput = sanitizeOutput(output);
        if (sanitizedOutput) {
          sanitized.outputs.push(sanitizedOutput);
        }
      }
    }
  }

  return sanitized;
}

/**
 * Sanitizes a complete notebook JSON object
 * Removes images, plots, and other large outputs
 * Returns metadata about what was removed
 */
export function sanitizeNotebook(notebook: IRawNotebook): ISanitizedNotebook {
  let imagesRemoved = 0;
  let plotsRemoved = 0;
  let largeOutputsRemoved = 0;

  const sanitized: ISanitizedNotebook = {
    notebookName: notebook.notebookName || 'Untitled',
    cells: [],
    imagesRemoved: 0,
    plotsRemoved: 0,
    largeOutputsRemoved: 0
  };

  if (notebook.cells && Array.isArray(notebook.cells)) {
    for (const cell of notebook.cells) {
      if (!cell) {
        continue;
      }

      const original = cell;
      const sanitizedCell = sanitizeCell(cell);

      // Track removed outputs
      if (original.outputs && Array.isArray(original.outputs)) {
        for (const output of original.outputs) {
          if (output.data) {
            for (const mimeType of Object.keys(output.data)) {
              if (mimeType.includes('image')) {
                imagesRemoved++;
              } else if (
                mimeType.includes('plotly') ||
                mimeType.includes('vega') ||
                mimeType.includes('html')
              ) {
                plotsRemoved++;
              }
            }
          }

          // Check if output was truncated
          if (output.text) {
            const text = Array.isArray(output.text)
              ? output.text.join('')
              : output.text;
            if (text.length > LARGE_OUTPUT_THRESHOLD) {
              largeOutputsRemoved++;
            }
          }
        }
      }

      sanitized.cells.push(sanitizedCell);
    }
  }

  sanitized.imagesRemoved = imagesRemoved;
  sanitized.plotsRemoved = plotsRemoved;
  sanitized.largeOutputsRemoved = largeOutputsRemoved;

  return sanitized;
}

/**
 * Gets the active cell info from a notebook
 */
export interface IActiveCellInfo {
  index: number;
  type: 'code' | 'markdown';
  source: string;
  execution_count?: number | null;
  outputs?: ISanitizedOutput[];
}

export function getActiveCellInfo(
  notebook: ISanitizedNotebook,
  activeCellIndex: number
): IActiveCellInfo | null {
  if (activeCellIndex < 0 || activeCellIndex >= notebook.cells.length) {
    return null;
  }

  const cell = notebook.cells[activeCellIndex];
  return {
    index: activeCellIndex,
    type: cell.cell_type,
    source: cell.source,
    execution_count: cell.execution_count,
    outputs: cell.outputs
  };
}

/**
 * Builds structured context for a user request
 */
export interface IStructuredContext {
  notebookName: string;
  markdownInstructions: string[];
  activeCell: IActiveCellInfo;
  removedContent: {
    imagesRemoved: number;
    plotsRemoved: number;
    largeOutputsRemoved: number;
  };
}

export function buildStructuredContext(
  notebook: ISanitizedNotebook,
  activeCellIndex: number,
  nearestMarkdownCell?: { cellIndex: number; text: string } | null
): IStructuredContext | null {
  const activeCell = getActiveCellInfo(notebook, activeCellIndex);
  if (!activeCell) {
    return null;
  }

  const markdownInstructions: string[] = [];

  // Collect markdown instructions from all previous cells
  for (let i = 0; i < activeCellIndex; i++) {
    const cell = notebook.cells[i];
    if (cell.cell_type === 'markdown') {
      markdownInstructions.push(cell.source);
    }
  }

  return {
    notebookName: notebook.notebookName,
    markdownInstructions,
    activeCell,
    removedContent: {
      imagesRemoved: notebook.imagesRemoved,
      plotsRemoved: notebook.plotsRemoved,
      largeOutputsRemoved: notebook.largeOutputsRemoved
    }
  };
}
