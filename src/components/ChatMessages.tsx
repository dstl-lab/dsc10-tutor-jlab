import { cn } from '@/utils';
import * as React from 'react';
import { useEffect, useRef } from 'react';
import Markdown from './Markdown';
import RelevantLectures from './RelevantLectures';
import { type IMessage } from './types';

const messageClasses = {
  user: cn(
    'max-w-[90%] self-end rounded-md bg-jp-brand-color1 px-2 py-0.5 text-white'
  ),
  tutor: cn('max-w-[90%] self-start'),
  system: cn(
    'max-w-[90%] self-start rounded-md border border-jp-border-color0 p-2'
  )
};

interface IChatMessagesProps {
  messages: IMessage[];
  isWaiting?: boolean;
  variant?: 'A' | 'B';
  experimentId?: string;
}

export default function ChatMessages({
  messages,
  isWaiting = false,
  variant,
  experimentId
}: IChatMessagesProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isWaiting]);

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
          <div key={index} className="flex flex-col gap-2">
            <div
              className={cn('flex flex-col', messageClasses[message.author])}
            >
              {message.text ? (
                <>
                  <Markdown
                    text={message.text}
                    enableInsertForPython={enableInsertForPython}
                    variant={variant}
                    experimentId={experimentId}
                  />
                  {message.isStreaming && (
                    <span
                      className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-current align-middle opacity-80"
                      aria-hidden="true"
                    />
                  )}
                </>
              ) : message.isStreaming ? (
                <TutorTyping />
              ) : null}
            </div>
            {message.author === 'tutor' &&
              message.relevantLectures &&
              message.relevantLectures.length > 0 && (
                <RelevantLectures
                  lectures={message.relevantLectures}
                  variant={variant}
                  experimentId={experimentId}
                />
              )}
          </div>
        );
      })}
      {isWaiting && !messages.some(m => m.isStreaming) && (
        <div className={cn('flex flex-col', messageClasses.tutor)}>
          <TutorTyping />
        </div>
      )}

      <div ref={bottomRef} />
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
