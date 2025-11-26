import React from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

type MarkdownProps = {
  text: string;
};

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
    return <code className="rounded bg-gray-200 px-1 py-0.5">{children}</code>;
  }

  return (
    <pre className="overflow-x-auto rounded bg-gray-900 p-2 text-white">
      <code className={className}>{children}</code>
    </pre>
  );
}

const components: Components = {
  code: CodeComponent as any
};

export default function Markdown({ text }: MarkdownProps) {
  // ReactMarkdown escapes HTML by default (safe). We include remark-gfm for richer features.
  // Uses remark-gfm so tables, task-lists, and other GFM are supported.
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  );
}
