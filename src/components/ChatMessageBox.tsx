import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/utils';

interface IChatMessageBoxProps {
  onSubmit: (message: string) => void;
  disabled?: boolean;
  suggestion?: string;
}

export default function ChatMessageBox({
  onSubmit,
  disabled = false,
  suggestion = ''
}: IChatMessageBoxProps) {
  const [message, setMessage] = React.useState('');

  // Prefill the composer when a new follow-up arrives so it reads as normal
  // text and the user can Send immediately or edit/delete first.
  React.useEffect(() => {
    if (!suggestion) {
      return;
    }
    setMessage(prev => (prev.trim() === '' ? suggestion : prev));
  }, [suggestion]);

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

  const handleChange = React.useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (disabled) {
        return;
      }
      setMessage(e.target.value);
    },
    [disabled]
  );

  return (
    <div className="flex flex-col gap-1">
      <Textarea
        autoResize
        className={cn('max-h-128', disabled ? 'pointer-events-none' : '')}
        value={message}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
      />
      <Button onClick={handleSubmit} disabled={disabled}>
        Send
      </Button>
    </div>
  );
}
