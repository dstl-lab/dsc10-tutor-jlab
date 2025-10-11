import * as React from 'react';
import { cn } from '@/utils';

const userMessageClasses = cn(
  'max-w-[90%] self-end rounded-md bg-jp-brand-color1 p-2 text-white'
);

const tutorMessageClasses = cn('max-w-[90%] self-start');

const messages = [
  {
    author: 'user',
    text: 'how do i read in a CSV file?'
  },
  {
    author: 'tutor',
    text: 'try pd.read_csv()!'
  }
];

export default function ChatMessages() {
  return (
    <div className="flex flex-1 flex-col gap-2 overflow-y-auto">
      {messages.map((message, index) => {
        const isUser = message.author === 'user';
        return (
          <div
            key={index}
            className={cn(
              'flex flex-col',
              isUser ? userMessageClasses : tutorMessageClasses
            )}
          >
            {message.text}
          </div>
        );
      })}
    </div>
  );
}
