import * as React from 'react';
import { useState } from 'react';

import ChatMessages from './ChatMessages';
import NotebookInfo from './NotebookInfo';
import ChatMessageBox from './ChatMessageBox';
import { useNotebook } from '@/contexts/NotebookContext';
import ChatPlaceholder from './ChatPlaceholder';
import { type IMessage } from './types';
import { askTutor } from '@/api';

export default function Chat() {
  const notebook = useNotebook();
  const [messages, setMessages] = useState<IMessage[]>([]);

  const handleMessageSubmit = async (text: string) => {
    setMessages(prev => [...prev, { author: 'user', text }]);
    const tutorMessage = await askTutor({ student_question: text });
    setMessages(prev => [
      ...prev,
      { author: 'tutor', text: tutorMessage.tutor_response }
    ]);
  };

  if (!notebook.notebookName) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <ChatPlaceholder />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-2">
      <ChatMessages messages={messages} />
      <ChatMessageBox onSubmit={handleMessageSubmit} />
      <NotebookInfo />
    </div>
  );
}
