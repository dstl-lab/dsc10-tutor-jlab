import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import {
  askTutorStream,
  getPracticeProblems,
  getRandomExamQuestion,
  type IAskTutorParams
} from '@/api';

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

const PRACTICE_PATTERNS = practicePatternsJson.map(
  (pattern: string) => new RegExp(pattern, 'i')
);

const EXAM_TRIGGER_PATTERN =
  /\b(?:exam\s+mode|exam\s+(?:question|problem)|midterm|final(?:\s+exam)?)\b/i;
const EXAM_NEXT_PATTERN = /^\s*(?:next|next\s+question)\s*$/i;
const EXAM_END_PATTERN =
  /\b(?:end|exit|leave|stop|quit|turn\s+off|disable)\s+exam(?:\s+mode)?\b|^\s*end\s+exam\s*$/i;

export default function Chat() {
  const {
    notebookName,
    getNearestMarkdownCell,
    getSanitizedNotebook,
    getStructuredContext
  } = useNotebook();
  const [messages, setMessages] = useState<IMessage[]>([]);
  const [isExamModeActive, setIsExamModeActive] = useState(false);
  const [examModeConversation, setExamModeConversation] = useState<string[]>(
    []
  );
  const [pendingExamAnswer, setPendingExamAnswer] = useState<string | null>(
    null
  );
  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined
  );
  const [isWaiting, setIsWaiting] = useState(false);
  const [shouldResetNext, setShouldResetNext] = useState(false);
  const [notebookLoaded, setNotebookLoaded] = useState(false);
  const loggedNotebookJsonForConversationIdRef = useRef<string | undefined>(
    undefined
  );
  const acceptedFollowUpRef = useRef<string | null>(null);
  const initialNotebookSnapshotRef = useRef<string | undefined>(undefined);
  const abortStreamRef = useRef<(() => void) | null>(null);

  type FrontendPromptMode = 'tutor' | 'chatgpt' | 'none';
  const [mode, setMode] = useState<FrontendPromptMode>('tutor');
  const [suggestion, setSuggestion] = useState('');

  useEffect(() => {
    if (!notebookName || notebookLoaded) {
      return;
    }

    const checkNotebook = () => {
      const sanitized = getSanitizedNotebook();

      if (sanitized.cells.length <= 1) {
        setTimeout(checkNotebook, 100);
        return;
      }

      const sanitizedJson = JSON.stringify(sanitized);

      initialNotebookSnapshotRef.current = sanitizedJson;

      const confirmationMessage = `📓 **Notebook: ${sanitized.notebookName}**
        ${sanitized.cells.length} cells loaded. I'm ready to help!`;

      setMessages([
        {
          author: 'tutor',
          text: confirmationMessage
        }
      ]);

      setNotebookLoaded(true);

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
    };

    checkNotebook();
  }, [notebookName, notebookLoaded, getSanitizedNotebook]);
  const isExamModeStartRequest = (query: string): boolean =>
    EXAM_TRIGGER_PATTERN.test(query);

  const isExamModeNextRequest = (query: string): boolean =>
    EXAM_NEXT_PATTERN.test(query);

  const isExamModeEndRequest = (query: string): boolean =>
    EXAM_END_PATTERN.test(query);

  const formatExamQuestion = (problem: {
    exam_name: string;
    exam_type: string;
    text: string;
    images: string[];
    source_url: string;
  }): string => {
    const typeLabel =
      problem.exam_type === 'midterm'
        ? 'Midterm'
        : problem.exam_type === 'final'
          ? 'Final Exam'
          : 'Exam';
    const parts: string[] = [
      `### 📝 ${typeLabel} Question — ${problem.exam_name}\n`,
      problem.text
    ];
    if (problem.images.length > 0) {
      parts.push('\n**Figures:**');
      problem.images.forEach((imgUrl, index) => {
        parts.push(`![Exam figure ${index + 1}](${imgUrl})`);
        parts.push(`[Open figure ${index + 1}](${imgUrl})`);
      });
    }
    parts.push(`\n[See the Full Question](${problem.source_url})`);
    return parts.join('\n');
  };

  const isPracticeRequest = (
    query: string
  ): { isPractice: boolean; topic?: string } => {
    for (const pattern of PRACTICE_PATTERNS) {
      const match = query.match(pattern);
      if (match && match[1]) {
        const topic = match[1].trim();
        if (topic.length > 2) {
          return { isPractice: true, topic };
        }
      }
    }

  useEffect(() => {
    return () => {
      abortStreamRef.current?.();
    };
  }, []);

  const withPendingExamAnswerContext = (question: string): string => {
    if (!pendingExamAnswer) {
      return question;
    }

    return [
      'Answer for the question shown immediately before this message (the student cannot see this):',
      pendingExamAnswer,
      '',
      'Student follow-up question:',
      question
    ].join('\n');
  };

  const handleMessageSubmit = async (text: string) => {
    const issueExamQuestion = async (studentText: string) => {
      const examResponse = await getRandomExamQuestion({
        conversation_id: shouldResetNext ? undefined : conversationId,
        student_question: studentText
      });
      const examModeMessage = formatExamQuestion(examResponse.problem);

      if (shouldResetNext) {
        setShouldResetNext(false);
      }

      if (examResponse.conversation_id) {
        setConversationId(examResponse.conversation_id);
      }

      logEvent({
        event_type: 'exam_question_request',
        payload: {
          original_query: studentText,
          exam_name: examResponse.problem.exam_name,
          notebook: notebookName
        }
      });

      setExamModeConversation(prev => [
        ...prev,
        `Student: ${studentText}`,
        `Tutor: ${examModeMessage}`
      ]);

      setPendingExamAnswer(examResponse.problem.answer ?? null);

      setMessages(prev => [
        ...prev,
        { author: 'tutor', text: examModeMessage }
      ]);
    };

    const wasFollowUpViaTab = acceptedFollowUpRef.current === text.trim();
    if (wasFollowUpViaTab) {
      logEvent({
        event_type: 'follow_up_question',
        payload: {
          question: text,
          mode,
          conversation_id: conversationId,
          notebook: notebookName
        }
      });
      acceptedFollowUpRef.current = null;
    }
    setSuggestion('');
    setMessages(prev => [...prev, { author: 'user', text }]);
    setIsWaiting(true);

    try {
      if (isExamModeActive) {
        if (isExamModeEndRequest(text)) {
          setIsExamModeActive(false);
          setPendingExamAnswer(null);
          setExamModeConversation([]);
          setMessages(prev => [
            ...prev,
            {
              author: 'tutor',
              text: 'Exam mode ended. You are back in normal tutor mode.'
            }
          ]);
          logEvent({
            event_type: 'exam_mode_ended',
            payload: {
              notebook: notebookName,
              conversation_id: conversationId
            }
          });
          return;
        }

        if (isExamModeNextRequest(text)) {
          await issueExamQuestion(text);
          return;
        }
      } else if (isExamModeNextRequest(text) || isExamModeEndRequest(text)) {
        setMessages(prev => [
          ...prev,
          {
            author: 'tutor',
            text: 'Exam mode is not active. Ask for exam mode to start, then use `next` to move to another question.'
          }
        ]);
        return;
      } else if (isExamModeStartRequest(text)) {
        setIsExamModeActive(true);
        setMessages(prev => [
          ...prev,
          {
            author: 'tutor',
            text: 'Exam mode activated. Ask about this question, type `next` for a new one, or `end exam mode` to exit.'
          }
        ]);
        logEvent({
          event_type: 'exam_mode_started',
          payload: {
            notebook: notebookName,
            conversation_id: conversationId
          }
        });
        await issueExamQuestion(text);
        return;
      }

      const practiceCheck = isPracticeRequest(text);

      if (
        !isExamModeActive &&
        practiceCheck.isPractice &&
        practiceCheck.topic
      ) {
        const practiceResponse = await getPracticeProblems({
          // Backend will extract the best-matching topic from this prompt
          // using its `topic_to_lecture.json` mapping.
          topic_query: text
        });

        logEvent({
          event_type: 'practice_problems_request',
          payload: {
            original_query: text,
            topic_query: text,
            notebook: notebookName,
            problem_count: practiceResponse.count,
            formatted_response: practiceResponse.formatted_response
          }
        });

        setMessages(prev => [
          ...prev,
          { author: 'tutor', text: practiceResponse.formatted_response }
        ]);
        setIsWaiting(false);
        return;
      }

      const promptToSend =
        mode === 'tutor' ? tutorInstruction : chatgptOverride;

      const backendPromptMode =
        mode === 'tutor' ? 'append' : mode === 'chatgpt' ? 'override' : 'none';

      const questionForTutor = isExamModeActive
        ? withPendingExamAnswerContext(text)
        : withPendingExamAnswerContext(
            enhanceQuestion(text, getNearestMarkdownCell())
          );

      const tutorRequest: IAskTutorParams = isExamModeActive
        ? {
            student_question: questionForTutor,
            conversation_id: conversationId,
            notebook_json: '{}',
            exam_mode_conversation:
              examModeConversation.length > 0
                ? examModeConversation.join('\n\n')
                : undefined,
            reset_conversation: shouldResetNext || undefined,
            prompt_mode: 'none' as const
          }
        : {
            student_question: questionForTutor,
            conversation_id: conversationId,
            notebook_json: JSON.stringify(getSanitizedNotebook()),
            structured_context: (() => {
              const structuredContext = getStructuredContext();
              return structuredContext
                ? JSON.stringify(structuredContext)
                : undefined;
            })(),
            exam_mode_conversation: undefined,
            prompt: promptToSend,
            prompt_mode: backendPromptMode,
            reset_conversation: shouldResetNext || undefined
          };

      logEvent({
        event_type: 'tutor_query',
        payload: {
          question: text,
          mode,
          conversation_id: conversationId,
          notebook: notebookName
        }
      });

      setMessages(prev => [
        ...prev,
        { author: 'tutor', text: '', isStreaming: true }
      ]);

      const resetFlag = shouldResetNext || undefined;

      await new Promise<void>((resolve, reject) => {
        let finalConversationId: string | undefined;

        const abort = askTutorStream(
          tutorRequest,
          event => {
            if (event.type === 'token') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.author === 'tutor') {
                  updated[updated.length - 1] = {
                    ...last,
                    text: last.text + event.text,
                    isStreaming: true
                  };
                }
                return updated;
              });
            } else if (event.type === 'lectures') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.author === 'tutor') {
                  updated[updated.length - 1] = {
                    ...last,
                    relevantLectures: event.relevant_lectures
                  };
                }
                return updated;
              });
            } else if (event.type === 'follow_up') {
              setSuggestion(event.text);
            } else if (event.type === 'done') {
              finalConversationId = event.conversation_id;
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last?.author === 'tutor') {
                  updated[updated.length - 1] = { ...last, isStreaming: false };
                }
                return updated;
              });

              if (finalConversationId) {
                setConversationId(finalConversationId);
              }

              setMessages(prev => {
                const last = prev[prev.length - 1];
                const responseText = last?.text ?? '';

                logEvent({
                  event_type: 'tutor_response',
                  payload: {
                    conversation_id: finalConversationId,
                    response: responseText,
                    mode,
                    notebook: notebookName
                  }
                });

                const resolvedId = finalConversationId || conversationId;
                const isFirstTurn =
                  !!resolvedId &&
                  loggedNotebookJsonForConversationIdRef.current !== resolvedId;

                const turnPayload: Record<string, unknown> = {
                  student_message: text,
                  tutor_response: responseText,
                  prompt_mode: backendPromptMode,
                  toggle_mode: mode,
                  timestamp: new Date().toISOString(),
                  conversation_id: resolvedId
                };

                if (isFirstTurn) {
                  turnPayload.initial_notebook_json = JSON.stringify(
                    getSanitizedNotebook()
                  );
                  loggedNotebookJsonForConversationIdRef.current =
                    resolvedId ?? undefined;
                }

                logEvent({
                  event_type: 'tutor_notebook_info',
                  payload: turnPayload
                });
                return prev;
              });

              resolve();
            } else if (event.type === 'error') {
              console.error('[Tutor] Stream error:', event.message);
            }
          },
          err => reject(err)
        );

        abortStreamRef.current = abort;
      });

      setMessages(prev => [
        ...prev,
        {
          author: 'tutor',
          text: tutorMessage.tutor_response,
          relevantLectures: tutorMessage.relevant_lectures
        }
      ]);

      if (isExamModeActive) {
        setExamModeConversation(prev => [
          ...prev,
          `Student: ${text}`,
          `Tutor: ${tutorMessage.tutor_response}`
        ]);
      }

      if (tutorMessage.follow_up) {
        setSuggestion(tutorMessage.follow_up);
      if (shouldResetNext) {
        setShouldResetNext(false);
      }
    } catch (error) {
      console.error('Error asking tutor:', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An error occurred while contacting the tutor. Please try again.';
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.author === 'tutor' && last.isStreaming) {
          updated[updated.length - 1] = {
            author: 'tutor',
            text: `Error: ${errorMessage}`,
            isStreaming: false
          };
        } else {
          updated.push({ author: 'tutor', text: `Error: ${errorMessage}` });
        }
        return updated;
      });
    } finally {
      abortStreamRef.current = null;
      setIsWaiting(false);
    }
  };

  const handleNewConversation = () => {
    abortStreamRef.current?.();
    abortStreamRef.current = null;
    setMessages([]);
    setIsExamModeActive(false);
    setExamModeConversation([]);
    setPendingExamAnswer(null);
    setConversationId(undefined);
    setIsWaiting(false);
    loggedNotebookJsonForConversationIdRef.current = undefined;
    acceptedFollowUpRef.current = null;
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
      <ChatMessageBox
        onSubmit={handleMessageSubmit}
        disabled={isWaiting}
        suggestion={suggestion}
        onSuggestionAccept={suggestionText => {
          acceptedFollowUpRef.current = suggestionText;
          setSuggestion('');
        }}
      />
    </div>
  );
}
