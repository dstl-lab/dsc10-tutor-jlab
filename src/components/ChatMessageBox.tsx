import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface IChatMessageBoxProps {
  onSubmit: (message: string) => void;
  disabled?: boolean;
  /** When set, this text is placed in the input so the user can edit before sending. Cleared via onPrefillApplied. */
  prefillMessage?: string | null;
  /** Called after the prefill has been applied to the input, so the parent can clear prefillMessage. */
  onPrefillApplied?: () => void;
}

export default function ChatMessageBox({
  onSubmit,
  disabled = false,
  prefillMessage = null,
  onPrefillApplied
}: IChatMessageBoxProps) {
  const [message, setMessage] = React.useState('');
  const prevPrefillRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (prefillMessage != null && prefillMessage !== '' && prefillMessage !== prevPrefillRef.current) {
      prevPrefillRef.current = prefillMessage;
      setMessage(prefillMessage);
      onPrefillApplied?.();
    }
    if (prefillMessage == null || prefillMessage === '') {
      prevPrefillRef.current = null;
    }
  }, [prefillMessage, onPrefillApplied]);

  const handleSubmit = React.useCallback(() => {
    if (disabled) {
      return;
    }
    if (message.trim()) {
      onSubmit(message.trim());
      setMessage('');
    }
  }, [message, onSubmit, disabled]);

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (disabled) {
        return;
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit, disabled]
  );

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        autoResize
        className={`max-h-128 ${disabled ? 'pointer-events-none' : ''}`}
        value={message}
        onChange={e => {
          if (disabled) {
            return;
          }
          setMessage(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <Button onClick={handleSubmit} disabled={disabled}>
        Send
      </Button>
    </div>
  );
}
