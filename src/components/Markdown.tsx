import React from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type MarkdownProps = {
  text: string;
};

// Code block & inline code renderer
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

  return (
    <pre className="overflow-x-auto rounded-md bg-gray-900 p-3 text-white">
      <code className={className}>{children}</code>
    </pre>
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

export default function Markdown({ text }: MarkdownProps) {
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
