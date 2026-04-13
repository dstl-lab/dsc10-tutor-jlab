import * as React from 'react';
import { Button } from '@/components/ui/button';
import { type ILectureCell } from '@/api';
import { logEvent } from '@/api/logger';
import { cn } from '@/utils';
import { useNotebook } from '@/contexts/NotebookContext';
import Markdown from './Markdown';

interface IRelevantLecturesProps {
  lectures: ILectureCell[];
  variant?: 'A' | 'B';
  experimentId?: string;
}

export default function RelevantLectures({
  lectures,
  variant,
  experimentId
}: IRelevantLecturesProps) {
  const { commands } = useNotebook();
  const [expandedIndices, setExpandedIndices] = React.useState<Set<number>>(
    new Set()
  );

  if (!lectures || lectures.length === 0) {
    return null;
  }

  const getLectureTitle = (filename: string): string => {
    const stem = filename.replace('.ipynb', '');
    const match = stem.match(/\d+/);
    if (match) {
      return `Lecture ${parseInt(match[0], 10)}`;
    }
    return stem;
  };

  const toggleExpanded = (index: number, lecture: ILectureCell) => {
    const newSet = new Set(expandedIndices);
    const isExpanding = !newSet.has(index);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setExpandedIndices(newSet);

    logEvent({
      event_type: 'lecture_dropdown_toggle',
      payload: {
        lecture: getLectureTitle(lecture.lecture),
        cell_index: lecture.cell_index,
        expanded: isExpanding,
        ...(experimentId && { experiment_id: experimentId, variant })
      }
    });
  };

  const openILectureCell = async (lecture: ILectureCell) => {
    if (!commands) {
      console.error('JupyterLab commands not available');
      return;
    }

    logEvent({
      event_type: 'lecture_open_in_notebook',
      payload: {
        lecture: getLectureTitle(lecture.lecture),
        path: lecture.path,
        cell_index: lecture.cell_index,
        ...(experimentId && { experiment_id: experimentId, variant })
      }
    });

    try {
      const widget = await commands.execute('docmanager:open', {
        path: lecture.path
      });

      if (widget && widget.content) {
        await widget.revealed;
        const notebook = widget.content;
        notebook.activeCellIndex = lecture.cell_index;

        if (typeof notebook.scrollToItem === 'function') {
          await notebook.scrollToItem(lecture.cell_index);
        } else {
          const cells = notebook.node?.querySelectorAll('.jp-Cell');
          if (cells && cells[lecture.cell_index]) {
            cells[lecture.cell_index].scrollIntoView({ block: 'center' });
          }
        }
      }
    } catch (error) {
      console.error('Failed to open lecture notebook:', error);
    }
  };

  return (
    <div className="mt-4 space-y-2 rounded-md border border-jp-border-color0 bg-white p-3">
      <h3 className="text-sm font-semibold text-gray-700">
        Relevant Lecture Content
      </h3>

      <div className="space-y-2">
        {lectures.map((lecture, idx) => (
          <div
            key={`${lecture.path}-${lecture.cell_index}`}
            className="overflow-hidden rounded-md border border-gray-200"
          >
            <button
              onClick={() => toggleExpanded(idx, lecture)}
              className="flex w-full items-center justify-between bg-gray-50 px-3 py-2 transition-colors hover:bg-gray-100"
            >
              <span className="text-sm font-medium text-gray-800">
                {getLectureTitle(lecture.lecture)}
              </span>
              <span
                className={cn(
                  'inline-block transition-transform',
                  expandedIndices.has(idx) ? 'rotate-180' : ''
                )}
              >
                ▼
              </span>
            </button>

            {expandedIndices.has(idx) && (
              <div className="space-y-2 border-t border-gray-200 bg-gray-50 px-3 py-2">
                <div className="max-h-40 overflow-auto rounded border border-gray-200 bg-white p-2 text-xs">
                  {lecture.cell_type === 'code' ? (
                    <pre className="break-words whitespace-pre-wrap text-gray-700">
                      {lecture.preview}
                    </pre>
                  ) : (
                    <Markdown text={lecture.preview} />
                  )}
                </div>
                <Button
                  className="w-full py-1 text-xs"
                  onClick={() => openILectureCell(lecture)}
                >
                  Open in Notebook
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
