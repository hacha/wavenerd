import { EventEmittable } from '../utils/EventEmittable';
import { type LiveChatSendEvent, type LiveChatSlotEvent, type LiveChatStateEvent, type LiveSlot } from './liveProtocol';

type ViteHotContext = NonNullable<ImportMeta['hot']>;

export interface LiveChatEvents {
  change: LiveChatStateEvent;
}

function emptyState(slot: LiveSlot): LiveChatStateEvent {
  return { slot, disabledReason: null, busy: false, entries: [] };
}

/**
 * The app side of `vite/liveChat.ts`: the chat of each deck with the coding agent that runs on this machine.
 * Dev server only.
 */
export class LiveChat extends EventEmittable<LiveChatEvents> {
  public states: Record<LiveSlot, LiveChatStateEvent> = { a: emptyState('a'), b: emptyState('b') };

  private readonly __hot: ViteHotContext;

  public constructor(hot: ViteHotContext) {
    super();

    this.__hot = hot;

    hot.on('wavenerd-live:chat', (event: LiveChatStateEvent) => {
      this.states = { ...this.states, [event.slot]: event };
      this.__emit('change', event);
    });

    // also after the dev server restarted
    hot.on('vite:ws:connect', () => hot.send('wavenerd-live:chat-hello'));
    hot.send('wavenerd-live:chat-hello');
  }

  public send(slot: LiveSlot, text: string): void {
    const event: LiveChatSendEvent = { slot, text };
    this.__hot.send('wavenerd-live:chat-send', event);
  }

  public cancel(slot: LiveSlot): void {
    const event: LiveChatSlotEvent = { slot };
    this.__hot.send('wavenerd-live:chat-cancel', event);
  }

  public reset(slot: LiveSlot): void {
    const event: LiveChatSlotEvent = { slot };
    this.__hot.send('wavenerd-live:chat-reset', event);
  }
}
