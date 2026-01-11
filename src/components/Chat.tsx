import * as React from 'react';
import { useState } from 'react';

import { askTutor } from '@/api';
import { Button } from '@/components/ui/button';
import { useNotebook } from '@/contexts/NotebookContext';
import { chatgptOverride, tutorInstruction } from '@/utils/prompts';
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
  const [shouldResetNext, setShouldResetNext] = useState(false);

  // Prompt mode
  type FrontendPromptMode = 'tutor' | 'chatgpt' | 'none';
  const [mode, setMode] = useState<FrontendPromptMode>('tutor');

  const handleMessageSubmit = async (text: string) => {
    setMessages(prev => [...prev, { author: 'user', text }]);
    setIsWaiting(true);
    try {
      const promptToSend =
        mode === 'tutor' ? tutorInstruction : chatgptOverride;

      const backendPromptMode =
        mode === 'tutor' ? 'append' : mode === 'chatgpt' ? 'override' : 'none';

      const tutorMessage = await askTutor({
        student_question: text,
        conversation_id: conversationId,
        notebook_json: getNotebookJson(),
        prompt: promptToSend,
        prompt_mode: backendPromptMode,
        reset_conversation: shouldResetNext || undefined
      });

      // Store the conversation ID from the first response
      if (tutorMessage.conversation_id && !conversationId) {
        setConversationId(tutorMessage.conversation_id);
      }
      // Clear the one-shot reset flag after using it
      if (shouldResetNext) {
        setShouldResetNext(false);
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
    setMessages([]);
    setConversationId(undefined);
    setIsWaiting(false);

    // Flag reset for the next message submission
    // (backend reset is deferred until next user input)
    setShouldResetNext(true);
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
      <div className="flex items-center justify-between gap-0.5 px-1">
        <Button
          className="w-45 !rounded-full px-2 py-0.5"
          onClick={handleNewConversation}
          disabled={isWaiting}
        >
          New Conversation
        </Button>
        <ToggleMode mode={mode} setMode={setMode} disabled={isWaiting} />
      </div>
      <ChatMessages messages={messages} isWaiting={isWaiting} />
      <ChatMessageBox onSubmit={handleMessageSubmit} disabled={isWaiting} />
    </div>
  );
}
