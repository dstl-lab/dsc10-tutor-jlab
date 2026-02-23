import * as React from 'react';
import { Button } from '@/components/ui/button';
import { type LectureCell } from '@/api';
import { cn } from '@/utils';
import { useNotebook } from '@/contexts/NotebookContext';
import Markdown from './Markdown';

interface IRelevantLecturesProps {
  lectures: LectureCell[];
}

export default function RelevantLectures({ lectures }: IRelevantLecturesProps) {
  const { commands } = useNotebook();
  const [expandedIndices, setExpandedIndices] = React.useState<Set<number>>(
    new Set()
  );

  if (!lectures || lectures.length === 0) {
    return null;
  }

  const toggleExpanded = (index: number) => {
    const newSet = new Set(expandedIndices);
    if (newSet.has(index)) {
      newSet.delete(index);
    } else {
      newSet.add(index);
    }
    setExpandedIndices(newSet);
  };

  const openLectureCell = async (lecture: LectureCell) => {
    if (!commands) {
      console.error('JupyterLab commands not available');
      return;
    }
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

  const getLectureTitle = (filename: string): string => {
    const stem = filename.replace('.ipynb', '');
    const match = stem.match(/\d+/);
    if (match) {
      return `Lecture ${parseInt(match[0], 10)}`;
    }
    return stem;
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
              onClick={() => toggleExpanded(idx)}
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
                  onClick={() => openLectureCell(lecture)}
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
