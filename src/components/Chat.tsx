import * as React from 'react';
import { useState, useRef } from 'react';

import { askTutor } from '@/api';
import { logEvent } from '@/api/logger';
import { Button } from '@/components/ui/button';
import { useNotebook } from '@/contexts/NotebookContext';
import { chatgptOverride, tutorInstruction } from '@/utils/prompts';
import { enhanceQuestion } from '@/utils/enhancedQuestionUtils';
import ChatMessageBox from './ChatMessageBox';
import ChatMessages from './ChatMessages';
import ChatPlaceholder from './ChatPlaceholder';
import ToggleMode from './ToggleMode';
import { type IMessage } from './types';

export default function Chat() {
  const { notebookName, getNotebookJson, getNearestMarkdownCell } =
    useNotebook();
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined
  );
  const [isWaiting, setIsWaiting] = useState(false);
  const [shouldResetNext, setShouldResetNext] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isCollapsing, setIsCollapsing] = useState(false);
  const loggedNotebookJsonForConversationIdRef = useRef<string | undefined>(
    undefined
  );

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

      const nearestMarkdown = getNearestMarkdownCell();
      const enhancedQuestion = enhanceQuestion(text, nearestMarkdown);
      const notebookJson = getNotebookJson();

      logEvent({
        event_type: 'tutor_query',
        payload: {
          question: text,
          mode,
          conversation_id: conversationId,
          notebook: notebookName
        }
      });

      const tutorMessage = await askTutor({
        student_question: enhancedQuestion,
        conversation_id: conversationId,
        notebook_json: notebookJson,
        prompt: promptToSend,
        prompt_mode: backendPromptMode,
        reset_conversation: shouldResetNext || undefined
      });

      if (shouldResetNext) {
        setShouldResetNext(false);
      }

      if (tutorMessage.conversation_id) {
        setConversationId(tutorMessage.conversation_id);
      }

      logEvent({
        event_type: 'tutor_response',
        payload: {
          conversation_id: tutorMessage.conversation_id,
          response: tutorMessage.tutor_response,
          mode,
          notebook: notebookName
        }
      });

      const finalConversationId =
        tutorMessage.conversation_id || conversationId;

      const isFirstTurn =
        !!finalConversationId &&
        loggedNotebookJsonForConversationIdRef.current !== finalConversationId;

      const turnPayload: Record<string, unknown> = {
        student_message: text,
        tutor_response: tutorMessage.tutor_response,
        prompt_mode: backendPromptMode,
        toggle_mode: mode,
        timestamp: new Date().toISOString(),
        conversation_id: finalConversationId
      };

      if (isFirstTurn) {
        turnPayload.initial_notebook_json = notebookJson;
        loggedNotebookJsonForConversationIdRef.current = finalConversationId;
      }

      logEvent({
        event_type: 'tutor_notebook_info',
        payload: turnPayload
      });

      setSuggestions(tutorMessage.follow_up_questions ?? []);
      setMessages(prev => [
        ...prev,
        { author: 'tutor', text: tutorMessage.tutor_response }
      ]);
    } catch (error) {
      console.error('Error asking tutor:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An error occurred while contacting the tutor. Please try again.';
      setMessages(prev => [
        ...prev,
        { author: 'tutor', text: `Error: ${errorMessage}` }
      ]);
    } finally {
      setIsWaiting(false);
    }
  };

  const handleSuggestionClick = (question: string) => {
    setIsCollapsing(true);
    setTimeout(() => {
      handleMessageSubmit(question);
      setSuggestions([]);
      setIsCollapsing(false);
    }, 250);
  };

  const handleNewConversation = () => {
    setMessages([]);
    setConversationId(undefined);
    setIsWaiting(false);
    setSuggestions([]);
    setIsCollapsing(false);
    loggedNotebookJsonForConversationIdRef.current = undefined;

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
      {suggestions.length > 0 && (
        <div
          className={`flex flex-wrap gap-2 mb-2 transition-all duration-[250ms] ease-out ${
            isCollapsing ? 'opacity-0 scale-95' : ''
          }`}
        >
          {suggestions.map((q, index) => (
            <button
              key={index}
              type="button"
              className="rounded-full border border-[#cdd8ff] bg-[#f0f4ff] px-3 py-2 text-[13px] cursor-pointer transition-all duration-200 ease-out hover:bg-[#e0eaff] hover:-translate-y-px"
              onClick={() => handleSuggestionClick(q)}
            >
              {q}
            </button>
          ))}
        </div>
      )}
      <ChatMessageBox onSubmit={handleMessageSubmit} disabled={isWaiting} />
    </div>
  );
}
