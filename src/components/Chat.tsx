import * as React from 'react';
import { useState } from 'react';

import { askTutor } from '@/api';
import { Button } from '@/components/ui/button';
import { useNotebook } from '@/contexts/NotebookContext';
import ChatMessageBox from './ChatMessageBox';
import ChatMessages from './ChatMessages';
import ChatPlaceholder from './ChatPlaceholder';
import NotebookInfo from './NotebookInfo';
import { type IMessage } from './types';

export default function Chat() {
  const { notebookName, getNotebookJson } = useNotebook();
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined
  );
  const [isWaiting, setIsWaiting] = useState(false);

  const handleMessageSubmit = async (text: string) => {
    setMessages(prev => [...prev, { author: 'user', text }]);
    setIsWaiting(true);
    try {
      const tutorMessage = await askTutor({
        student_question: text,
        conversation_id: conversationId,
        notebook_json: getNotebookJson()
      });
      // Store the conversation ID from the first response
      if (tutorMessage.conversation_id && !conversationId) {
        setConversationId(tutorMessage.conversation_id);
      }
      setMessages(prev => [
        ...prev,
        { author: 'tutor', text: tutorMessage.tutor_response }
      ]);
    } finally {
      setIsWaiting(false);
    }
  };

  const handleNewConversation = () => {
    const ok = window.confirm(
      'Start a new conversation? This will clear the current chat and reset the tutor context.'
    );
    if (!ok) {
      return;
    }
    setMessages([]);
    setConversationId(undefined);
    setIsWaiting(false);
  };

  if (!notebookName) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <ChatPlaceholder />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <div />
        <Button onClick={handleNewConversation}>New conversation</Button>
      </div>
      <ChatMessages messages={messages} isWaiting={isWaiting} />
      <ChatMessageBox onSubmit={handleMessageSubmit} disabled={isWaiting} />
      <NotebookInfo />
    </div>
  );
}
