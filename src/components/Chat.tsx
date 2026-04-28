import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import {
  askTutorStream,
  getPracticeProblems,
  getRandomExamQuestion,
  type IAskTutorParams
} from '@/api';

import { logEvent } from '@/api/logger';
import {
  ACTIVE_EXPERIMENT,
  assignVariant,
  getStudentKey,
  hashStudentKey
} from '@/utils/abTesting';
import { Button } from '@/components/ui/button';
import { useNotebook } from '@/contexts/NotebookContext';
import { enhanceQuestion } from '@/utils/enhancedQuestionUtils';
import { chatgptOverride, tutorInstruction } from '@/utils/prompts';
import ChatMessageBox from './ChatMessageBox';
import ChatMessages from './ChatMessages';
import ChatPlaceholder from './ChatPlaceholder';
import ToggleMode from './ToggleMode';
import { type IMessage } from './types';

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
  const initialNotebookSnapshotRef = useRef<string | undefined>(undefined);
  const abortStreamRef = useRef<(() => void) | null>(null);
  const examModeStartTimestampRef = useRef<number | null>(null);

  type FrontendPromptMode = 'tutor' | 'chatgpt' | 'none';
  const [mode, setMode] = useState<FrontendPromptMode>('tutor');
  const [suggestion, setSuggestion] = useState('');
  const [messageBoxKey, setMessageBoxKey] = useState(0);

  const studentKey = getStudentKey();
  const [variant] = useState<'A' | 'B'>(() =>
    ACTIVE_EXPERIMENT && studentKey
      ? assignVariant(studentKey, ACTIVE_EXPERIMENT)
      : 'B'
  );
  // const [variant] = useState<'A' | 'B'>(() => 'B');
  const studentKeyHashRef = useRef<string>(
    studentKey ? hashStudentKey(studentKey) : 'unknown'
  );

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

  const isPracticeRequest = (query: string): boolean => {
    const q = query.toLowerCase();
    return q.includes('practice problems') || q.includes('practice');
  };

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

    const wasFollowUpQuestion = !!(
      suggestion && text.trim() === suggestion.trim()
    );
    if (wasFollowUpQuestion) {
      logEvent({
        event_type: 'follow_up_question',
        payload: {
          question: text,
          mode,
          conversation_id: conversationId,
          notebook: notebookName,
          ...(ACTIVE_EXPERIMENT === 'exp_follow_up' && {
            experiment_id: ACTIVE_EXPERIMENT,
            variant
          })
        }
      });
    }
    setSuggestion('');
    setMessages(prev => [...prev, { author: 'user', text }]);
    setIsWaiting(true);

    try {
      const isPracticeIntent = isPracticeRequest(text);

      // Log the start of every experiment turn. This is the denominator for
      // all experiment metrics. is_practice_intent identifies eligible turns
      // for the practice problems experiment specifically.
      if (ACTIVE_EXPERIMENT) {
        logEvent({
          event_type: 'exp_turn_start',
          payload: {
            experiment_id: ACTIVE_EXPERIMENT,
            variant,
            student_key_hash: studentKeyHashRef.current,
            is_practice_intent: isPracticeIntent,
            conversation_id: conversationId,
            notebook: notebookName
          }
        });
      }

      // Practice problems are only active when no experiment is running, or when the
      // active experiment specifically targets practice problems and the student is
      // variant B. All other experiments suppress this feature entirely so they
      // don't interfere with each other.
      const shouldGetPracticeProblems =
        isPracticeIntent &&
        (!ACTIVE_EXPERIMENT ||
          (ACTIVE_EXPERIMENT === 'exp_practice_problems' && variant === 'B'));

      const shouldActivateExamMode =
        !ACTIVE_EXPERIMENT ||
        (ACTIVE_EXPERIMENT === 'exp_exam_mode' && variant === 'B');
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
          const examEndTimestamp = new Date().toISOString();
          const durationMs = examModeStartTimestampRef.current
            ? Date.now() - examModeStartTimestampRef.current
            : null;
          examModeStartTimestampRef.current = null;
          logEvent({
            event_type: 'exam_mode_ended',
            payload: {
              notebook: notebookName,
              conversation_id: conversationId,
              timestamp: examEndTimestamp,
              ...(durationMs !== null && {
                duration_seconds: Math.round(durationMs / 1000)
              })
            }
          });
          if (ACTIVE_EXPERIMENT === 'exp_exam_mode') {
            logEvent({
              event_type: 'exp_exam_mode_duration',
              payload: {
                experiment_id: ACTIVE_EXPERIMENT,
                variant,
                student_key_hash: studentKeyHashRef.current,
                notebook: notebookName,
                timestamp: examEndTimestamp,
                ...(durationMs !== null && {
                  duration_seconds: Math.round(durationMs / 1000)
                })
              }
            });
          }
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
        if (!shouldActivateExamMode) {
          setMessages(prev => [
            ...prev,
            {
              author: 'tutor',
              text: 'Exam mode is not available.'
            }
          ]);
          setIsWaiting(false);
          return;
        }
        const examStartTimestamp = new Date().toISOString();
        examModeStartTimestampRef.current = Date.now();
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
            conversation_id: conversationId,
            timestamp: examStartTimestamp
          }
        });
        if (ACTIVE_EXPERIMENT === 'exp_exam_mode') {
          logEvent({
            event_type: 'exp_exam_mode_activated',
            payload: {
              experiment_id: ACTIVE_EXPERIMENT,
              variant,
              student_key_hash: studentKeyHashRef.current,
              notebook: notebookName,
              timestamp: examStartTimestamp
            }
          });
        }
        await issueExamQuestion(text);
        return;
      }

      if (!isExamModeActive && shouldGetPracticeProblems) {
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

        if (ACTIVE_EXPERIMENT === 'exp_practice_problems') {
          logEvent({
            event_type: 'exp_practice_impression',
            payload: {
              experiment_id: ACTIVE_EXPERIMENT,
              variant,
              student_key_hash: studentKeyHashRef.current,
              problem_count: practiceResponse.count,
              notebook: notebookName
            }
          });
        }

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

      let streamedTutorResponse = '';

      await new Promise<void>((resolve, reject) => {
        let finalConversationId: string | undefined;

        const isBackendGatedExperiment =
          ACTIVE_EXPERIMENT === 'exp_relevant_lectures' ||
          ACTIVE_EXPERIMENT === 'exp_follow_up';

        const abort = askTutorStream(
          {
            ...tutorRequest,
            ...(isBackendGatedExperiment &&
              ACTIVE_EXPERIMENT && {
                experiment_id: ACTIVE_EXPERIMENT,
                variant
              })
          },
          event => {
            if (event.type === 'token') {
              streamedTutorResponse += event.text;
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
              if (
                !ACTIVE_EXPERIMENT ||
                (ACTIVE_EXPERIMENT === 'exp_relevant_lectures' &&
                  variant === 'B')
              ) {
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
                if (ACTIVE_EXPERIMENT === 'exp_relevant_lectures') {
                  logEvent({
                    event_type: 'exp_lectures_impression',
                    payload: {
                      experiment_id: ACTIVE_EXPERIMENT,
                      variant,
                      student_key_hash: studentKeyHashRef.current,
                      lecture_count: event.relevant_lectures.length,
                      notebook: notebookName
                    }
                  });
                }
              }
            } else if (event.type === 'follow_up') {
              if (
                !ACTIVE_EXPERIMENT ||
                (ACTIVE_EXPERIMENT === 'exp_follow_up' && variant === 'B')
              ) {
                setSuggestion(event.text);
                if (ACTIVE_EXPERIMENT === 'exp_follow_up') {
                  logEvent({
                    event_type: 'exp_follow_up_impression',
                    payload: {
                      experiment_id: ACTIVE_EXPERIMENT,
                      variant,
                      student_key_hash: studentKeyHashRef.current,
                      notebook: notebookName
                    }
                  });
                }
              }
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

              if (isExamModeActive) {
                setExamModeConversation(prev => [
                  ...prev,
                  `Student: ${text}`,
                  `Tutor: ${streamedTutorResponse}`
                ]);
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
    examModeStartTimestampRef.current = null;
    setSuggestion('');
    setMessageBoxKey(k => k + 1);
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
      <ChatMessages
        messages={messages}
        isWaiting={isWaiting}
        variant={variant}
        experimentId={ACTIVE_EXPERIMENT ?? undefined}
      />
      <ChatMessageBox
        key={messageBoxKey}
        onSubmit={handleMessageSubmit}
        disabled={isWaiting}
        suggestion={suggestion}
      />
    </div>
  );
}
