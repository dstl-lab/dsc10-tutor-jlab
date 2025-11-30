import { useNotebook } from '@/contexts/NotebookContext';
import { cn } from '@/utils';
import * as React from 'react';
import Markdown from './Markdown';
import { type IMessage } from './types';

const messageClasses = {
  user: cn('max-w-[90%] self-end rounded-md bg-jp-brand-color1 p-2 text-white'),
  tutor: cn('max-w-[90%] self-start'),
  system: cn(
    'max-w-[90%] self-start rounded-md border border-jp-border-color0 p-2'
  )
};

interface IChatMessagesProps {
  messages: IMessage[];
}

export default function ChatMessages({ messages }: IChatMessagesProps) {
  const notebook = useNotebook();
  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
        <div className={cn('flex flex-col', messageClasses.system)}>
          Send a message to the tutor to start chatting!
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
      {messages.map((message, index) => {
        return (
          <div
            key={index}
            className={cn('flex flex-col', messageClasses[message.author])}
          >
            {renderMessageWithInserts(message, index, notebook)}
          </div>
        );
      })}
    </div>
  );
}

function renderMessageWithInserts(
  message: IMessage,
  keyPrefix: number,
  notebook: ReturnType<typeof useNotebook>
) {
  // Only process code-block inserts for tutor messages
  if (message.author !== 'tutor') {
    return <Markdown text={message.text} />;
  }

  const nodes: React.ReactNode[] = [];
  const regex = /```(\w+)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = regex.exec(message.text)) !== null) {
    const [fullMatch, lang, code] = match;
    const matchStart = match.index;

    // Push preceding text
    if (matchStart > lastIndex) {
      const textSegment = message.text.slice(lastIndex, matchStart);
      nodes.push(<Markdown key={`md-${keyPrefix}-${i}`} text={textSegment} />);
      i++;
    }

    // Render code block
    const language = (lang || '').toLowerCase();
    nodes.push(
      <div
        key={`code-${keyPrefix}-${i}`}
        className="my-2 rounded-md border bg-gray-50 p-2"
      >
        <pre className="text-sm whitespace-pre-wrap">
          <code>{code}</code>
        </pre>
        {language === 'python' && notebook.insertCodeBelowActiveCell && (
          <div className="mt-2">
            <button
              className="rounded bg-jp-brand-color1 px-2 py-1 text-white"
              onClick={() => notebook.insertCodeBelowActiveCell?.(code)}
            >
              Insert code below
            </button>
          </div>
        )}
      </div>
    );
    i++;

    lastIndex = match.index + fullMatch.length;
  }

  // Push remaining text
  if (lastIndex < message.text.length) {
    const remaining = message.text.slice(lastIndex);
    nodes.push(<Markdown key={`md-${keyPrefix}-${i}`} text={remaining} />);
  }

  // If no code blocks were found, just render the markdown
  if (nodes.length === 0) {
    return <Markdown text={message.text} />;
  }

  return <>{nodes}</>;
}
