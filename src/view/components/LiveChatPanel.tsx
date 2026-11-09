import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import IconMessagePlusOutline from '~icons/mdi/message-plus-outline';
import IconSend from '~icons/mdi/send';
import IconStop from '~icons/mdi/stop';
import { type LiveChat } from '../../live/LiveChat';
import { type LiveChatEntry, type LiveSlot } from '../../live/liveProtocol';
import { useLiveChatState } from '../stores/hooks/useLiveChatState';
import { useSettings } from '../stores/hooks/useSettings';

const iconCls = 'w-5 h-5 shrink-0 cursor-pointer hover:opacity-80 active:opacity-60';

function ChatEntry({ entry }: { entry: LiveChatEntry }) {
  const { role, text } = entry;

  if (role === 'user') {
    return <div className="whitespace-pre-wrap text-accent-bright">{`> ${text}`}</div>;
  } else if (role === 'tool') {
    return <div className="whitespace-pre-wrap text-foredark">{`· ${text}`}</div>;
  } else if (role === 'error') {
    return <div className="whitespace-pre-wrap text-error">{text}</div>;
  } else if (role === 'info') {
    return <div className="whitespace-pre-wrap text-foresub">{`— ${text}`}</div>;
  }
  return <div className="whitespace-pre-wrap">{text}</div>;
}

/**
 * Talk to the coding agent that runs on this machine (`vite/liveChat.ts`) about one deck. Dev server only.
 * The agent edits only the file of this deck in `live/`.
 */
export function LiveChatPanel({
  liveChat,
  slot,
  className,
  style,
  onResizeStart,
}: {
  liveChat: LiveChat;
  slot: LiveSlot;
  className?: string;
  style?: React.CSSProperties;

  /** The border to the code was grabbed. */
  onResizeStart: (event: React.PointerEvent) => void;
}) {
  const state = useLiveChatState(liveChat, slot)!;
  const { disabledReason, busy, entries } = state;

  const font = useSettings('editorFont');
  const [text, setText] = useState('');
  const refLog = useRef<HTMLDivElement>(null);

  // follow the latest line
  useEffect(() => {
    const log = refLog.current;
    if (log != null) {
      log.scrollTop = log.scrollHeight;
    }
  }, [entries, busy]);

  const handleSend = useCallback(() => {
    if (busy || text.trim() === '') { return; }
    liveChat.send(slot, text);
    setText('');
  }, [busy, text, liveChat, slot]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter while converting Japanese text confirms the text
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      handleSend();
    } else if (event.key === 'Escape') {
      event.currentTarget.blur();
    }
  }, [handleSend]);

  const disabled = disabledReason != null;
  const deckName = slot.toUpperCase();

  return (
    <div
      className={clsx('flex flex-col bg-back1 text-xs', className)}
      style={{ ...style, font, fontVariantLigatures: 'none' }}
    >
      <div
        className="h-1 shrink-0 bg-bar-bg cursor-row-resize hover:bg-accent touch-none"
        onPointerDown={onResizeStart}
        data-stalker="Drag to resize"
      />

      <div ref={refLog} className="grow min-h-0 overflow-y-auto px-2 py-1 flex flex-col gap-1">
        {entries.length === 0 && (
          <div className="text-foresub">
            {disabledReason ?? `Ask the agent on this machine (Claude Code) to write deck ${deckName}. It edits only deck ${deckName} and cues the code; you apply it.`}
          </div>
        )}
        {entries.map((entry) => <ChatEntry key={entry.id} entry={entry} />)}
        {busy && <div className="text-foresub animate-pulse">…</div>}
      </div>

      <div className="flex items-end gap-1 px-1 py-1 shrink-0">
        <textarea
          className="grow resize-none min-h-6 max-h-24 field-sizing-content px-1 py-0.5 rounded bg-input-back text-input-fore outline-none disabled:opacity-50"
          rows={1}
          value={text}
          disabled={disabled}
          placeholder={disabled ? disabledReason : busy ? 'The agent is working…' : `Message for deck ${deckName} (Enter to send, Shift+Enter for a new line)`}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        {busy
          ? <IconStop className={iconCls} onClick={() => liveChat.cancel(slot)} data-stalker="Stop the agent" />
          : <IconSend className={clsx(iconCls, (disabled || text.trim() === '') && 'opacity-30')} onClick={handleSend} data-stalker="Send" />}
        <IconMessagePlusOutline
          className={clsx(iconCls, busy && 'opacity-30')}
          onClick={() => !busy && liveChat.reset(slot)}
          data-stalker="New conversation"
        />
      </div>
    </div>
  );
}
