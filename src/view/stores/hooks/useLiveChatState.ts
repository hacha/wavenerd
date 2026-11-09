import { useCallback, useSyncExternalStore } from 'react';
import { type LiveChat } from '../../../live/LiveChat';
import { type LiveChatStateEvent, type LiveSlot } from '../../../live/liveProtocol';

/** The chat of a deck, or `null` without the dev server. */
export function useLiveChatState(liveChat: LiveChat | null, slot: LiveSlot | undefined): LiveChatStateEvent | null {
  const subscribe = useCallback((onChange: () => void) => {
    if (liveChat == null) { return () => {}; }
    liveChat.on('change', onChange);
    return () => liveChat.off('change', onChange);
  }, [liveChat]);

  return useSyncExternalStore(subscribe, () => (liveChat != null && slot != null ? liveChat.states[slot] : null));
}
