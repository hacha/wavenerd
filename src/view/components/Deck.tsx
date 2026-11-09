import { forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { type Analyser } from '../../audio/Analyser';
import { DeckEditor, type DeckEditorRef } from './DeckEditor';
import { DeckStatusBar } from './DeckStatusBar';
import { atom, type PrimitiveAtom } from 'jotai';
import { type CodeDeck, type CueStatus } from '../../CodeDeck';
import { type DeckSourceMode } from '../../audio/DeckSourceSwitch';
import { useAtomCallback } from 'jotai/utils';
import { DeckLog } from './DeckLog';
import { DeckMemoryUpdateBalloon } from './DeckMemoryUpdateBalloon';
import { DeckVisualizer } from './DeckVisualizer/DeckVisualizer';
import { DeckLibrary } from './DeckLibrary';
import { DeckBraceJumpMap } from './DeckBraceJumpMap';
import { StuffContext } from '../StuffContext';
import styles from './Deck.module.css';
import clsx from 'clsx';
import { StrudelDeck } from '../../strudel/StrudelDeck';
import { StrudelDeckBackground } from './StrudelDeckBackground';
import { strudelThemeSettings } from '../codemirror/strudelTheme';
import { type LiveSlot } from '../../live/LiveBridge';
import { MIDIMAN } from '../../MIDIManager';
import { knobInit } from '../utils/knobInit';
import { LiveChatPanel } from './LiveChatPanel';
import { useLiveChatState } from '../stores/hooks/useLiveChatState';

// == chat layout ==================================================================================
const CHAT_RATIO_MIN = 0.15;
const CHAT_RATIO_MAX = 0.85;

/** Height of the status bar, px. */
const STATUS_BAR_HEIGHT = 24;

function loadStored<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function store(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // not remembered
  }
}

/**
 * Whether the chat panel of a deck is open, and its share of the height above the status bar.
 * Remembered per deck in this browser.
 */
function useChatLayout(slot: LiveSlot | undefined) {
  const key = `wavenerd-live-chat-${slot ?? 'none'}`;
  const [layout, setLayout] = useState(() => loadStored(key, { open: false, ratio: 0.35 }));

  const update = useCallback((patch: Partial<typeof layout>) => {
    setLayout((prev) => {
      const next = { ...prev, ...patch };
      store(key, next);
      return next;
    });
  }, [key]);

  return [layout, update] as const;
}

export const Deck = forwardRef(({
  className,
  cueStatusAtom,
  errorAtom,
  codeAtom,
  hasEditAtom,
  compileTimeAtom,
  analyser,
  deck,
  mode,
  onToggleMode,
  gainParamName,
  filterParamName,
  storagePath,
  knobParamPrefix,
  liveSlot,
}: {
  deck: CodeDeck;
  mode: DeckSourceMode;
  onToggleMode: () => void;
  gainParamName: string;
  filterParamName: string;
  storagePath: string;

  /** The prefix of the MIDI params of the knobs of the deck, e.g. `/deck_a`. */
  knobParamPrefix: string;

  /** The file of `live/` that this deck follows. Strudel decks only. */
  liveSlot?: LiveSlot;

  cueStatusAtom: PrimitiveAtom<'none' | 'ready' | 'applying' | 'compiling'>;
  errorAtom: PrimitiveAtom<string | null>;
  codeAtom: PrimitiveAtom<string>;
  hasEditAtom: PrimitiveAtom<boolean>;
  compileTimeAtom: PrimitiveAtom<number>;
  analyser: Analyser;
  className?: string;
}, ref: React.Ref<{ focusEditor: (highlight: boolean) => void }>) => {
  const { storageManager, liveBridge, liveChat } = useContext(StuffContext)!;

  // -- atoms and state ----------------------------------------------------------------------------
  const libraryOpeningAtom = useMemo(() => atom(false), []);
  const logsAtom = useMemo(() => atom<[ id: number, text: string ][]>([]), []);
  const memoryUpdateAtom = useMemo(() => atom<{
    renderKey: number;
    memoryKey: string;
    status: 'loaded' | 'loadfailed' | 'saved';
  } | null>(null), []);

  const [focusHighlightKey, setFocusHighlightKey] = useState(0);

  // -- refs ---------------------------------------------------------------------------------------
  const refEditor = useRef<DeckEditorRef>(null);

  /**
   * A song was loaded (library, file drop or memory) and its `// @init` is not applied yet.
   * Applied when the code first goes live, not on load, since the knobs also drive the playing code.
   */
  const refInitPending = useRef(false);

  /** The `// @init` of the cued code, while `refInitPending` */
  const refCuedInit = useRef<Map<string, number> | null>(null);

  // -- beforeunload -------------------------------------------------------------------------------
  const handleBeforeUnload = useAtomCallback(useCallback((get, _, event: BeforeUnloadEvent) => {
    const hasEdit = get(hasEditAtom);
    if (hasEdit) {
      event.preventDefault();
      event.returnValue = true;
    }
  }, [hasEditAtom]));

  useEffect(() => {
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [handleBeforeUnload]);

  // -- handlers -----------------------------------------------------------------------------------
  const focusEditor = useCallback((highlight: boolean) => {
    refEditor.current?.focusEditor?.();
    if (highlight) {
      setFocusHighlightKey((key) => key + 1);
    }
  }, [refEditor, setFocusHighlightKey]);

  const jumpToLine = useCallback((line: number) => {
    focusEditor(false);
    refEditor.current?.jumpToLine(line);
  }, [focusEditor]);

  const handleLoad = useAtomCallback(useCallback(async (_get, set, code: string) => {
    set(codeAtom, code);
    set(hasEditAtom, true);
    jumpToLine(1);
  }, [codeAtom, hasEditAtom, jumpToLine]));

  const armInit = useCallback(() => {
    refInitPending.current = true;
  }, []);

  const handleLoadSong = useCallback((code: string) => {
    armInit();
    handleLoad(code);
  }, [armInit, handleLoad]);

  /**
   * @param liveHash The hash of the file of `live/` that was pushed to the editor, if the code came from it
   */
  const handleCompile = useAtomCallback(useCallback(async (get, set, liveHash?: string) => {
    const code = get(codeAtom);

    const compileBegin = performance.now();
    await deck.compile(code);
    const compileTime = performance.now() - compileBegin;

    refCuedInit.current = refInitPending.current ? knobInit(code) : null;

    storageManager.save(storagePath, code);
    set(hasEditAtom, false);
    set(compileTimeAtom, compileTime);

    if (liveBridge != null && liveSlot != null) {
      liveBridge.reportCompiled(liveSlot, { hash: liveHash ?? null, code });
    }
  }, [codeAtom, hasEditAtom, deck, storagePath, compileTimeAtom, storageManager, liveBridge, liveSlot]));

  // cued by the player. the file of `live/` takes the code
  const handleCompileByPlayer = useCallback(() => handleCompile(), [handleCompile]);

  const handleApply = useCallback(
    async () => {
      if (deck.cueStatus === 'none') {
        await handleCompile();
      }
      deck.applyCue();
    },
    [deck, handleCompile],
  );

  const handleApplyImmediately = useCallback(
    async () => {
      if (deck.cueStatus === 'none') {
        await handleCompile();
      }
      deck.applyCueImmediately();
    },
    [deck, handleCompile],
  );

  const refBraceJumpMap = useRef<{ update: (index: number) => void }>(null);
  const handleBraceJump = useCallback((index: number) => {
    refBraceJumpMap.current?.update(index);
  }, []);

  // -- live bridge --------------------------------------------------------------------------------
  // a file of `live/` changed: show it and cue it. applying it is up to the player
  useEffect(() => {
    if (liveBridge == null || liveSlot == null) { return; }

    const type = liveSlot === 'a' ? 'pushA' : 'pushB';
    const handlePush = liveBridge.on(type, ({ code, hash }) => {
      // `// @init` is for songs loaded by the player, not for `live/`
      refInitPending.current = false;
      refEditor.current?.replaceCode(code, '← live');
      handleCompile(hash);
    });

    return () => liveBridge.off(type, handlePush);
  }, [liveBridge, liveSlot, handleCompile]);

  // -- knob init ----------------------------------------------------------------------------------
  // the cue went live: set the knobs to the `// @init` of the loaded song
  useEffect(() => {
    let prevCueStatus = deck.cueStatus;

    const handleChangeCueStatus = ({ cueStatus }: { cueStatus: CueStatus }) => {
      const isApplied = cueStatus === 'none' && (prevCueStatus === 'ready' || prevCueStatus === 'applying');
      prevCueStatus = cueStatus;
      if (!isApplied || !refInitPending.current) { return; }

      refInitPending.current = false;
      for (const [paramName, value] of refCuedInit.current ?? []) {
        MIDIMAN.setValue(`${knobParamPrefix}/${paramName}`, value);
      }
      refCuedInit.current = null;
    };
    deck.on('changeCueStatus', handleChangeCueStatus);

    return () => deck.off('changeCueStatus', handleChangeCueStatus);
  }, [deck, knobParamPrefix]);

  // -- init ---------------------------------------------------------------------------------------
  useEffect(() => {
    const initCode = async () => {
      const file = await storageManager.getFile(storagePath);
      if (file != null) {
        const code = await file.text();
        handleLoad(code);
      }

      handleApplyImmediately();
    };
    initCode();

    const handleInit = storageManager.on('init', initCode);

    return () => {
      storageManager.off('init', handleInit);
    };
  }, [storageManager, storagePath, handleLoad, handleApplyImmediately]);

  // -- chat -------------------------------------------------------------------------------------
  // only the Strudel decks follow `live/`, so only they have a chat
  const hasChat = liveChat != null && liveSlot != null;
  const chatState = useLiveChatState(liveChat, liveSlot);
  const [chatLayout, updateChatLayout] = useChatLayout(liveSlot);
  const chatOpen = hasChat && chatLayout.open;
  const refRoot = useRef<HTMLDivElement>(null);

  const handleToggleChat = useCallback(() => {
    updateChatLayout({ open: !chatLayout.open });
  }, [chatLayout.open, updateChatLayout]);

  const handleChatResizeStart = useCallback((event: React.PointerEvent) => {
    const root = refRoot.current;
    if (root == null) { return; }
    event.preventDefault();

    const handleMove = (moveEvent: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      const height = rect.height - STATUS_BAR_HEIGHT;
      const ratio = 1.0 - (moveEvent.clientY - rect.top) / height;
      updateChatLayout({ ratio: Math.min(Math.max(ratio, CHAT_RATIO_MIN), CHAT_RATIO_MAX) });
    };
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [updateChatLayout]);

  // the code takes the height above the status bar, minus the chat
  const chatRatio = chatOpen ? chatLayout.ratio : 0;
  const codeStyle = { height: `calc((100% - ${STATUS_BAR_HEIGHT}px) * ${1.0 - chatRatio})` };

  // -- imperative handle --------------------------------------------------------------------------
  useImperativeHandle(ref, () => ({ focusEditor }), [focusEditor]);

  // -- render -------------------------------------------------------------------------------------
  return (
    <div
      ref={refRoot}
      className={clsx('relative bg-code-background', className)}
      // the background of the Strudel REPL
      style={deck instanceof StrudelDeck ? { backgroundColor: strudelThemeSettings.background } : undefined}
    >
      {/* the code, above the chat and the status bar */}
      <div className="absolute left-0 top-0 w-full" style={codeStyle}>
        <DeckVisualizer
          className="absolute inset-0 pointer-events-none"
          analyser={analyser}
        />
        {deck instanceof StrudelDeck && (
          <StrudelDeckBackground
            className="absolute inset-0 pointer-events-none opacity-80"
            deck={deck}
          />
        )}
        <DeckEditor
          ref={refEditor}
          deck={deck}
          mode={mode}
          className="absolute inset-0"
          codeAtom={codeAtom}
          logsAtom={logsAtom}
          errorAtom={errorAtom}
          hasEditAtom={hasEditAtom}
          onCompile={handleCompileByPlayer}
          onApply={handleApply}
          onApplyImmediately={handleApplyImmediately}
          onBraceJump={handleBraceJump}
          onLoadSong={armInit}
          memoryUpdateAtom={memoryUpdateAtom}
          libraryOpeningAtom={libraryOpeningAtom}
        />
        <DeckLog logsAtom={logsAtom} />
        <DeckBraceJumpMap
          ref={refBraceJumpMap}
          className="absolute inset-0"
          codeAtom={codeAtom}
        />
      </div>
      {chatOpen && (
        <LiveChatPanel
          className="absolute left-0 w-full"
          style={{
            bottom: STATUS_BAR_HEIGHT,
            height: `calc((100% - ${STATUS_BAR_HEIGHT}px) * ${chatRatio})`,
          }}
          liveChat={liveChat!}
          slot={liveSlot!}
          onResizeStart={handleChatResizeStart}
        />
      )}
      <DeckStatusBar
        className="absolute left-0 bottom-0 w-full h-6"
        mode={mode}
        onToggleMode={onToggleMode}
        chat={hasChat ? { open: chatOpen, busy: chatState?.busy ?? false, onToggle: handleToggleChat } : undefined}
        errorAtom={errorAtom}
        cueStatusAtom={cueStatusAtom}
        hasEditAtom={hasEditAtom}
        compileTimeAtom={compileTimeAtom}
        onCompile={handleCompileByPlayer}
        onApply={handleApply}
        onApplyImmediately={handleApplyImmediately}
        onJumpToLine={jumpToLine}
        gainParamName={gainParamName}
        filterParamName={filterParamName}
      />
      <DeckLibrary
        dir={mode === 'strudel' ? 'strudel' : 'shaders'}
        libraryOpeningAtom={libraryOpeningAtom}
        onLoad={handleLoadSong}
        focusEditor={focusEditor}
      />
      <DeckMemoryUpdateBalloon memoryUpdateAtom={memoryUpdateAtom} />
      {focusHighlightKey > 0 && (
        <div
          key={focusHighlightKey}
          className={clsx('absolute inset-0 border-4 border-fore pointer-events-none', styles.focusFrameFadeOut)}
        />
      )}
    </div>
  );
});
Deck.displayName = 'Deck';
