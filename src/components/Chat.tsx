import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import { askTutor } from '@/api';
import { logEvent } from '@/api/logger';
import { Button } from '@/components/ui/button';
import { useNotebook } from '@/contexts/NotebookContext';
import { enhanceQuestion } from '@/utils/enhancedQuestionUtils';
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
    getNearestMarkdownCell,
    getSanitizedNotebook,
    getStructuredContext
  } = useNotebook();
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined
  );
  const [isWaiting, setIsWaiting] = useState(false);
  const [shouldResetNext, setShouldResetNext] = useState(false);
  const [notebookLoaded, setNotebookLoaded] = useState(false);
  const loggedNotebookJsonForConversationIdRef = useRef<string | undefined>(
    undefined
  );
  const initialNotebookSnapshotRef = useRef<string | undefined>(undefined);

  type FrontendPromptMode = 'tutor' | 'chatgpt' | 'none';
  const [mode, setMode] = useState<FrontendPromptMode>('tutor');

  // Detect session start: when notebook is opened and send initial sanitized snapshot
  useEffect(() => {
    if (!notebookName || notebookLoaded) {
      return;
    }

    // Wait for notebook to fully load before capturing
    const timer = setTimeout(() => {
      // Get sanitized notebook snapshot
      const sanitized = getSanitizedNotebook();
      const sanitizedJson = JSON.stringify(sanitized);

      // Store the initial snapshot
      initialNotebookSnapshotRef.current = sanitizedJson;

      // Create confirmation message
      const confirmationMessage = `📓 **Notebook: ${sanitized.notebookName}**
        ${sanitized.cells.length} cells loaded. I'm ready to help you with your code!`;

      setMessages([
        {
          author: 'tutor',
          text: confirmationMessage
        }
      ]);

      setNotebookLoaded(true);

      // Log the session start
      logEvent({
        event_type: 'session_start',
        payload: {
          notebook: sanitized.notebookName,
          cell_count: sanitized.cells.length,
          images_removed: sanitized.imagesRemoved,
          plots_removed: sanitized.plotsRemoved,
          large_outputs_removed: sanitized.largeOutputsRemoved
        }
      });
    }, 500); // Wait 500ms for notebook to fully load

    return () => clearTimeout(timer);
  }, [notebookName, notebookLoaded, getSanitizedNotebook]);

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
      const structuredContext = getStructuredContext();

      logEvent({
        event_type: 'tutor_query',
        payload: {
          question: text,
          mode,
          conversation_id: conversationId,
          notebook: notebookName
        }
      });

      // For the first turn, send the initial notebook snapshot
      const isFirstTurn = !conversationId && initialNotebookSnapshotRef.current;

      const tutorMessage = await askTutor({
        student_question: enhancedQuestion,
        conversation_id: conversationId,
        notebook_json: getNotebookJson(),
        structured_context: structuredContext
          ? JSON.stringify(structuredContext)
          : undefined,
        initial_notebook_snapshot:
          initialNotebookSnapshotRef.current || undefined,
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

      const isFirstTurnForTurn =
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

      if (isFirstTurnForTurn) {
        turnPayload.initial_notebook_json = getNotebookJson();
        loggedNotebookJsonForConversationIdRef.current = finalConversationId;
      }

      logEvent({
        event_type: 'tutor_notebook_info',
        payload: turnPayload
      });

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

  const handleNewConversation = () => {
    setMessages([]);
    setConversationId(undefined);
    setIsWaiting(false);
    loggedNotebookJsonForConversationIdRef.current = undefined;
    // Reset notebook loaded state so confirmation message and snapshot are sent again
    setNotebookLoaded(false);

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
