import * as React from 'react';
import { useEffect, useRef, useState } from 'react';

import { askTutor, getPracticeProblems, getRandomExamQuestion } from '@/api';
import { logEvent } from '@/api/logger';
import { Button } from '@/components/ui/button';
import { useNotebook } from '@/contexts/NotebookContext';
import { enhanceQuestion } from '@/utils/enhancedQuestionUtils';
import practicePatternsJson from '@/utils/practice_patterns.json';
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

export default function Chat() {
  const {
    notebookName,
    getNearestMarkdownCell,
    getSanitizedNotebook,
    getStructuredContext
  } = useNotebook();
  const [messages, setMessages] = useState<IMessage[]>([]);
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
  const isExamModeRequest = (query: string): boolean =>
    query.trim().toLowerCase() === 'next' || EXAM_TRIGGER_PATTERN.test(query);

  const formatExamQuestion = (problem: {
    exam_name: string;
    exam_type: string;
    text: string;
    choices: string[];
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
    if (problem.choices.length > 0) {
      parts.push('\n**Choices:**');
      problem.choices.forEach(c => parts.push(`- ${c}`));
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

    return { isPractice: false };
  };

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
      if (isExamModeRequest(text)) {
        const examResponse = await getRandomExamQuestion({
          conversation_id: shouldResetNext ? undefined : conversationId,
          student_question: text
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
            original_query: text,
            exam_name: examResponse.problem.exam_name,
            notebook: notebookName
          }
        });

        setExamModeConversation(prev => [
          ...prev,
          `Student: ${text}`,
          `Tutor: ${examModeMessage}`
        ]);

        setPendingExamAnswer(examResponse.problem.answer ?? null);

        setMessages(prev => [
          ...prev,
          { author: 'tutor', text: examModeMessage }
        ]);
        return;
      }

      const practiceCheck = isPracticeRequest(text);

      if (practiceCheck.isPractice && practiceCheck.topic) {
        const practiceResponse = await getPracticeProblems({
          topic_query: practiceCheck.topic
        });

        logEvent({
          event_type: 'practice_problems_request',
          payload: {
            original_query: text,
            topic_query: practiceCheck.topic,
            notebook: notebookName,
            problem_count: practiceResponse.count,
            formatted_response: practiceResponse.formatted_response
          }
        });

        setMessages(prev => [
          ...prev,
          { author: 'tutor', text: practiceResponse.formatted_response }
        ]);
        return;
      }

      const promptToSend =
        mode === 'tutor' ? tutorInstruction : chatgptOverride;

      const backendPromptMode =
        mode === 'tutor' ? 'append' : mode === 'chatgpt' ? 'override' : 'none';

      const nearestMarkdown = getNearestMarkdownCell();
      const enhancedQuestion = enhanceQuestion(text, nearestMarkdown);
      const questionForTutor = withPendingExamAnswerContext(enhancedQuestion);
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

      const tutorMessage = await askTutor({
        student_question: questionForTutor,
        conversation_id: conversationId,
        notebook_json: JSON.stringify(getSanitizedNotebook()),
        structured_context: structuredContext
          ? JSON.stringify(structuredContext)
          : undefined,
        exam_mode_conversation:
          examModeConversation.length > 0
            ? examModeConversation.join('\n\n')
            : undefined,
        prompt: promptToSend,
        prompt_mode: backendPromptMode,
        reset_conversation: shouldResetNext || undefined
      });

      if (shouldResetNext) {
        setShouldResetNext(false);
      }

      if (pendingExamAnswer) {
        setPendingExamAnswer(null);
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
        turnPayload.initial_notebook_json = JSON.stringify(
          getSanitizedNotebook()
        );
        loggedNotebookJsonForConversationIdRef.current = finalConversationId;
      }

      logEvent({
        event_type: 'tutor_notebook_info',
        payload: turnPayload
      });

      setMessages(prev => [
        ...prev,
        {
          author: 'tutor',
          text: tutorMessage.tutor_response,
          relevantLectures: tutorMessage.relevant_lectures
        }
      ]);
      if (tutorMessage.follow_up) {
        setSuggestion(tutorMessage.follow_up);
      }
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
