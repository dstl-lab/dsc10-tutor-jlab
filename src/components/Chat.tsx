import * as React from 'react';
import { useState } from 'react';

import { askTutor } from '@/api';
import { Button } from '@/components/ui/button';
import { useNotebook } from '@/contexts/NotebookContext';
import { chatgptOverride, tutorInstruction } from '@/utils/prompts';
import ChatMessageBox from './ChatMessageBox';
import ChatMessages from './ChatMessages';
import ChatPlaceholder from './ChatPlaceholder';
import ToggleMode from './ToggleMode';
import { type IMessage } from './types';

export default function Chat() {
  const {
    notebookName,
    getNotebookJson,
    getNearestMarkdownCell
  } = useNotebook();
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

      // Get the nearest markdown cell (which likely contains the question)
      const nearestMarkdown = getNearestMarkdownCell();
      

      // Enhance the student question with context about which question they're working on
      // This helps the backend LLM understand the context even if it doesn't use the separate fields
      let enhancedQuestion = text;
      if (nearestMarkdown?.text) {
        // Extract a brief question identifier from the markdown (e.g., "Question 5.1.1")
        const questionMatch = nearestMarkdown.text.match(
          /(?:Question|Q)\s*(\d+\.\d+\.\d+)/i
        );
        if (questionMatch) {
          const questionId = questionMatch[0]; // e.g., "Question 5.1.1"
          // Prepend context to the question
          enhancedQuestion = `[Working on ${questionId}] ${text}`;
        } else {
          // If no question ID found, include a preview of the markdown context
          const contextPreview = nearestMarkdown.text
            .substring(0, 150)
            .replace(/\n/g, ' ');
          enhancedQuestion = `[Context: ${contextPreview}...] ${text}`;
        }
      }

      const tutorMessage = await askTutor({
        student_question: enhancedQuestion,
        conversation_id: conversationId,
        notebook_json: getNotebookJson(),
        prompt: promptToSend,
        prompt_mode: backendPromptMode,
        reset_conversation: shouldResetNext || undefined,
        nearest_markdown_cell_text: nearestMarkdown?.text
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
          className="w-50 px-2 py-0.5 text-xs"
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
