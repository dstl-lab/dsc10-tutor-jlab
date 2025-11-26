import * as React from 'react';
import { cn } from '@/utils';
import { type IMessage } from './types';
import Markdown from './Markdown';

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
          {/* Render Markdown for all messages (user, tutor, system) */}
          <Markdown text={message.text} />
        </div>
      ))}
    </div>
  );
}
