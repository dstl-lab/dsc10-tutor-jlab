import * as React from 'react';
import { useState } from 'react';

import { askTutor, PromptMode } from '@/api';
import { useNotebook } from '@/contexts/NotebookContext';
import ChatMessageBox from './ChatMessageBox';
import ChatMessages from './ChatMessages';
import ChatPlaceholder from './ChatPlaceholder';
import NotebookInfo from './NotebookInfo';
import ToggleMode from './ToggleMode';
import { type IMessage } from './types';

export default function Chat() {
  const { notebookName, getNotebookJson } = useNotebook();
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined
  );
  const [isWaiting, setIsWaiting] = useState(false);

  // Prompt mode
  const [mode, setMode] = useState<PromptMode>('append');

  const tutorInstruction =
    'Always respond in Markdown. Use headers, bullet points, and code blocks where appropriate.';
  const chatgptOverride =
    'You are a helpful assistant. Answer questions in markdown.';

  const handleMessageSubmit = async (text: string) => {
    setMessages(prev => [...prev, { author: 'user', text }]);
    setIsWaiting(true);
    try {
      const promptToSend =
        mode === 'append' ? tutorInstruction : chatgptOverride;

      const tutorMessage = await askTutor({
        student_question: text,
        conversation_id: conversationId,
        notebook_json: getNotebookJson(),
        prompt: promptToSend,
        prompt_mode: mode
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

  if (!notebookName) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <ChatPlaceholder />
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div className="px-2">
        <ToggleMode
          mode={mode === 'append' ? 'append' : 'override'}
          setMode={setMode}
        />
      </div>

      <ChatMessages messages={messages} isWaiting={isWaiting} />
      <ChatMessageBox onSubmit={handleMessageSubmit} disabled={isWaiting} />
      <NotebookInfo />
    </div>
  );
}
