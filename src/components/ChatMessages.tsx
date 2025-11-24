import * as React from 'react';
import ReactMarkdown, { Components } from 'react-markdown';
import { cn } from '@/utils';
import { type IMessage } from './types';

const messageClasses = {
  user: cn('max-w-[90%] self-end rounded-md bg-jp-brand-color1 p-2 text-white'),
  tutor: cn('max-w-[90%] self-start rounded-md bg-gray-100 p-2'),
  system: cn(
    'max-w-[90%] self-start rounded-md border border-jp-border-color0 p-2'
  )
};

interface IChatMessagesProps {
  messages: IMessage[];
}

// Code component for ReactMarkdown
const MarkdownCode: React.FC<{
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
}> = ({ inline, children }) => {
  if (inline) {
    return <code className="rounded bg-gray-200 px-1 py-0.5">{children}</code>;
  }

  return (
    <code className="block overflow-x-auto rounded bg-gray-900 p-2 text-white">
      {children}
    </code>
  );
};

// Components object for ReactMarkdown
const markdownComponents: Components = {
  code: MarkdownCode
};

export default function ChatMessages({ messages }: IChatMessagesProps) {
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
      {messages.map((message, index) => (
        <div
          key={index}
          className={cn('flex flex-col', messageClasses[message.author])}
        >
          {message.author === 'tutor' ? (
            <ReactMarkdown components={markdownComponents}>
              {message.text}
            </ReactMarkdown>
          ) : (
            message.text
          )}
        </div>
      ))}
    </div>
  );
}
