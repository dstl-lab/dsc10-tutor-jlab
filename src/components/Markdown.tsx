import { logEvent } from '@/api/logger';
import { useNotebook } from '@/contexts/NotebookContext';
import React from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

type MarkdownProps = {
  text: string;
  // If true, Markdown will render an "Insert code below"
  enableInsertForPython?: boolean;
  // A/B experiment context — passed through from Chat.tsx when relevant
  variant?: 'A' | 'B';
  experimentId?: string;
};

export default function Markdown({
  text,
  enableInsertForPython = false,
  variant,
  experimentId
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

    // Limiting to 20 chars reliably captures operators and simple examples (e.g. `+`, `np.log10`)
    const INLINE_CODE_MAX_LENGTH = 20;

    const isSingleLine =
      typeof codeString === 'string' &&
      !codeString.includes('\n') &&
      codeString.length <= INLINE_CODE_MAX_LENGTH;

    if (isSingleLine) {
      return (
        <code className="rounded bg-gray-200 px-1 py-0.5 text-sm">
          {children}
        </code>
      );
    }

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
    code: CodeComponent as any,
    a: ({ href, children }: any) => {
      const handleClick = () => {
        if (experimentId === 'exp_practice_problems') {
          logEvent({
            event_type: 'exp_practice_click',
            payload: {
              experiment_id: experimentId,
              variant,
              markdown_link_click: true
            }
          });
        }
      };

      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="hover:text-blue-800"
          style={{ color: '#2563eb', textDecoration: 'underline' }}
          onClick={handleClick}
        >
          {children}
        </a>
      );
    }
  };

  /**
   * ReactMarkdown escapes HTML by default (safe). We include remark-gfm for richer features.
   * Uses remark-gfm so tables, task-lists, and other GFM are supported.
   * Uses remark-math + rehype-katex for LaTeX math rendering ($...$ and $$...$$).
   * Uses rehype-raw + rehype-sanitize to render raw HTML (e.g. <details>/<summary>)
   * while preventing XSS.
   * ReactMarkdown Doc: https://github.com/remarkjs/react-markdown
   * remark-gfm Doc: https://github.com/remarkjs/remark-gfm
   */
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeKatex]}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
}
