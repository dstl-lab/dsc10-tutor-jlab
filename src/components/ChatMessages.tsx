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
  isWaiting?: boolean;
}

export default function ChatMessages({
  messages,
  isWaiting = false
}: IChatMessagesProps) {
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
        const enableInsertForPython = message.author === 'tutor';

        return (
          <div
            key={index}
            className={cn('flex flex-col', messageClasses[message.author])}
          >
            <Markdown
              text={message.text}
              enableInsertForPython={enableInsertForPython}
            />
          </div>
        );
      })}
      {isWaiting && (
        <div className={cn('flex flex-col', messageClasses.tutor)}>
          <TutorTyping />
        </div>
      )}
    </div>
  );
}

function TutorTyping() {
  return (
    <div className="inline-flex items-center gap-1">
      <span
        className="inline-block h-2 w-2 animate-pulse rounded-full bg-current opacity-80"
        style={{ animationDelay: '0s' }}
      />
      <span
        className="inline-block h-2 w-2 animate-pulse rounded-full bg-current opacity-80"
        style={{ animationDelay: '0.12s' }}
      />
      <span
        className="inline-block h-2 w-2 animate-pulse rounded-full bg-current opacity-80"
        style={{ animationDelay: '0.24s' }}
      />
    </div>
  );
}
