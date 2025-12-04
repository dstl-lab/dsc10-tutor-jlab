import { useNotebook } from '@/contexts/NotebookContext';
import React from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type MarkdownProps = {
  text: string;
  // If true, Markdown will render an "Insert code below"
  enableInsertForPython?: boolean;
};

export default function Markdown({
  text,
  enableInsertForPython = false
}: MarkdownProps) {
  const notebook = useNotebook();
  // Code block & inline code renderer which can render optional actions
  function CodeComponent({
    inline,
    className,
    children
  }: {
    inline?: boolean;
    className?: string;
    children?: React.ReactNode;
  }) {
    if (inline) {
      return (
        <code className="rounded bg-gray-200 px-1 py-0.5 text-sm">
          {children}
        </code>
      );
    }

    // Extract language from className like "language-python"
    const language = className?.toString().split('-')[1] ?? '';
    const codeString = Array.isArray(children)
      ? String(children.join(''))
      : String(children ?? '');

    // If enabled and we have notebook insert support, render an insert button
    const showInsert =
      enableInsertForPython &&
      notebook.insertCodeBelowActiveCell &&
      (language || '').toLowerCase().startsWith('py');

    return (
      <div>
        <pre className="overflow-x-auto rounded-md bg-gray-900 p-3 text-white">
          <code className={className}>{children}</code>
        </pre>
        {showInsert && (
          <div className="mt-2">
            <button
              type="button"
              aria-label={`Insert ${language} code into notebook below active cell`}
              className="rounded bg-jp-brand-color1 px-2 py-1 text-white hover:opacity-90 focus:ring-2 focus:ring-jp-brand-color1 focus:ring-offset-2 focus:outline-none"
              onClick={() => notebook.insertCodeBelowActiveCell?.(codeString)}
            >
              Insert code below cell
            </button>
          </div>
        )}
      </div>
    );
  }

  const components: Components = {
    h1: ({ children }: any) => (
      <h1 className="my-2 text-lg leading-tight font-semibold">{children}</h1>
    ),
    h2: ({ children }: any) => (
      <h2 className="my-2 text-base leading-tight font-semibold">{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 className="my-2 text-base leading-tight font-semibold">{children}</h3>
    ),
    p: ({ children }: any) => <p className="my-2">{children}</p>,
    ul: ({ children }: any) => (
      <ul className="my-2 ml-5 list-disc space-y-1">{children}</ul>
    ),
    ol: ({ children }: any) => (
      <ol className="my-2 ml-5 list-decimal space-y-1">{children}</ol>
    ),
    li: ({ children }: any) => <li className="leading-tight">{children}</li>,
    code: CodeComponent as any
  };

  /**
   * ReactMarkdown escapes HTML by default (safe). We include remark-gfm for richer features.
   * Uses remark-gfm so tables, task-lists, and other GFM are supported.
   * ReactMarkdown Doc: https://github.com/remarkjs/react-markdown
   * remark-gfm Doc: https://github.com/remarkjs/remark-gfm
   */
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
}
