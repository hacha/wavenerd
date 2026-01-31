import { forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Analyser } from '../../audio/Analyser';
import { DeckEditor } from './DeckEditor';
import { DeckStatusBar } from './DeckStatusBar';
import { atom, PrimitiveAtom, useAtom } from 'jotai';
import { ThemeVars } from '../themes/ThemeVars';
import WavenerdDeck from '@0b5vr/wavenerd-deck';
import styled, { keyframes } from 'styled-components';
import { useAtomCallback } from 'jotai/utils';
import { DeckLog } from './DeckLog';
import { DeckMemoryUpdateBalloon } from './DeckMemoryUpdateBalloon';
import { DeckVisualizer } from './DeckVisualizer/DeckVisualizer';
import { DeckLibrary } from './DeckLibrary';
import { DeckBraceJumpMap } from './DeckBraceJumpMap';
import { StuffContext } from '../StuffContext';
import type { DeckMode } from '../../audio/DeckSwitch';
import type { DeckSwitch } from '../../audio/DeckSwitch';
import type { StrudelDeck } from '../../strudel/StrudelDeck';
import { initStrudel, waitForDeckInit } from '../../strudel/initStrudel';

// == styles =======================================================================================
const fadeOut = keyframes`
  0% { opacity: 1; }
  100% { opacity: 0; }
`;

const DeckFocusHighlight = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  right: 0;
  border: 4px solid ${ThemeVars.fore};
  animation: step-end ${fadeOut} 0.2s forwards;
  pointer-events: none;
`;

const StyledEditor = styled(DeckEditor)`
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: calc( 100% - 24px );
`;

const StyledStatusBar = styled(DeckStatusBar)`
  position: absolute;
  left: 0;
  bottom: 0;
  width: 100%;
  height: 24px;
`;

const StyledVisualizer = styled(DeckVisualizer)`
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: calc( 100% - 24px );
  pointer-events: none;
`;

const StyledDeckBraceJumpMap = styled(DeckBraceJumpMap)`
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: calc( 100% - 24px );
`;

const Root = styled.div`
  position: relative;
  background: ${ThemeVars.codeBackground};
`;

// == components ===================================================================================
export const Deck = forwardRef(({
  className,
  cueStatusAtom,
  errorAtom,
  codeAtom,
  hasEditAtom,
  compileTimeAtom,
  analyser,
  deck,
  gainParamName,
  storagePath,
  // Strudel-related props
  modeAtom,
  strudelCodeAtom,
  strudelHasEditAtom,
  strudelDeck,
  deckSwitch,
}: {
  deck: WavenerdDeck;
  gainParamName: string;
  storagePath: string;
  cueStatusAtom: PrimitiveAtom<'none' | 'ready' | 'applying' | 'compiling'>;
  errorAtom: PrimitiveAtom<string | null>;
  codeAtom: PrimitiveAtom<string>;
  hasEditAtom: PrimitiveAtom<boolean>;
  compileTimeAtom: PrimitiveAtom<number>;
  analyser: Analyser;
  className?: string;
  // Strudel-related props
  modeAtom: PrimitiveAtom<DeckMode>;
  strudelCodeAtom: PrimitiveAtom<string>;
  strudelHasEditAtom: PrimitiveAtom<boolean>;
  strudelDeck: StrudelDeck;
  deckSwitch: DeckSwitch;
}, ref: React.Ref<{ focusEditor: (highlight: boolean) => void }>) => {
  const { storageManager } = useContext(StuffContext)!;

  // -- atoms and state ----------------------------------------------------------------------------
  const libraryOpeningAtom = useMemo(() => atom(false), []);
  const logsAtom = useMemo(() => atom<[ id: number, text: string ][]>([]), []);
  const memoryUpdateAtom = useMemo(() => atom<{
    key: string;
    status: 'loaded' | 'loadfailed' | 'saved';
  } | null>(null), []);

  const [focusHighlightKey, setFocusHighlightKey] = useState(0);
  const [mode, setMode] = useAtom(modeAtom);

  // Get the correct atoms based on mode
  const activeCodeAtom = mode === 'glsl' ? codeAtom : strudelCodeAtom;
  const activeHasEditAtom = mode === 'glsl' ? hasEditAtom : strudelHasEditAtom;
  const activeStoragePath = mode === 'glsl' ? storagePath : storagePath.replace('.glsl', '.strudel.js');

  // -- refs ---------------------------------------------------------------------------------------
  const refEditor = useRef<{ focusEditor: () => void; jumpToLine: (line: number) => void }>(null);

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
  }, [refEditor]);

  const handleLoad = useAtomCallback(useCallback(async (get, set, code: string) => {
    set(activeCodeAtom, code);
    set(activeHasEditAtom, true);
    jumpToLine(1);
  }, [activeCodeAtom, activeHasEditAtom, jumpToLine]));

  // Derive deck ID from storagePath (e.g., "decks/a.glsl" -> "A")
  const deckId = storagePath.includes('/a.') ? 'A' : 'B';

  const handleCompile = useAtomCallback(useCallback(async (get, set) => {
    console.log('[Deck] handleCompile called, mode:', mode);
    const code = get(activeCodeAtom);
    console.log('[Deck] code length:', code.length);

    const compileBegin = performance.now();

    if (mode === 'glsl') {
      console.log('[Deck] Compiling GLSL...');
      await deck.compile(code);
    } else {
      console.log('[Deck] Compiling Strudel...');
      // Wait for Strudel deck to be fully initialized (REPL created)
      console.log('[Deck] Waiting for Strudel deck initialization...');
      await waitForDeckInit(deckId);
      console.log('[Deck] Strudel deck ready, compiling...');
      await strudelDeck.compile(code);
      console.log('[Deck] Strudel compile done');
    }

    const compileTime = performance.now() - compileBegin;

    storageManager.save(activeStoragePath, code);
    set(activeHasEditAtom, false);
    set(compileTimeAtom, compileTime);
  }, [activeCodeAtom, activeHasEditAtom, deck, activeStoragePath, compileTimeAtom, storageManager, mode, strudelDeck, deckId]));

  const handleApply = useCallback(
    async () => {
      console.log('[Deck] handleApply called, mode:', mode);
      if (mode === 'glsl') {
        console.log('[Deck] GLSL apply, cueStatus:', deck.cueStatus);
        if (deck.cueStatus === 'none') {
          await handleCompile();
        }
        deck.applyCue();
      } else {
        console.log('[Deck] Strudel apply, cueStatus:', strudelDeck.cueStatus);
        if (strudelDeck.cueStatus === 'none') {
          await handleCompile();
        }
        await strudelDeck.applyCue();
      }
    },
    [handleCompile, mode, strudelDeck, deck],
  );

  const handleApplyImmediately = useCallback(
    async () => {
      if (mode === 'glsl') {
        if (deck.cueStatus === 'none') {
          await handleCompile();
        }
        deck.applyCueImmediately();
      } else {
        if (strudelDeck.cueStatus === 'none') {
          await handleCompile();
        }
        strudelDeck.applyCueImmediately();
      }
    },
    [handleCompile, mode, strudelDeck],
  );

  const handleToggleMode = useCallback(() => {
    const newMode = mode === 'glsl' ? 'strudel' : 'glsl';
    console.log('[Deck] Toggle mode:', mode, '->', newMode);
    setMode(newMode);
    deckSwitch.setMode(newMode);

    // Stop Strudel when switching to GLSL
    if (newMode === 'glsl') {
      strudelDeck.stop();
    }
  }, [mode, setMode, deckSwitch, strudelDeck]);

  const refBraceJumpMap = useRef<{ update: (index: number) => void }>(null);
  const handleBraceJump = useCallback((index: number) => {
    refBraceJumpMap.current?.update(index);
  }, []);

  // -- init ---------------------------------------------------------------------------------------
  useEffect(() => {
    const initCode = async () => {
      // Load GLSL code
      const glslFile = await storageManager.getFile(storagePath);
      if (glslFile != null && mode === 'glsl') {
        const code = await glslFile.text();
        handleLoad(code);
      }

      // Only auto-apply in GLSL mode
      if (mode === 'glsl') {
        handleApplyImmediately();
      }
    };
    initCode();

    const handleInit = storageManager.on('init', initCode);

    return () => {
      storageManager.off('init', handleInit);
    };
  }, [storageManager, storagePath, handleLoad, handleApplyImmediately, mode]);

  // -- imperative handle --------------------------------------------------------------------------
  useImperativeHandle(ref, () => ({ focusEditor }), [focusEditor]);

  // -- render -------------------------------------------------------------------------------------
  return (
    <Root
      className={className}
    >
      <StyledVisualizer analyser={analyser} />
      <StyledEditor
        ref={refEditor}
        codeAtom={activeCodeAtom}
        logsAtom={logsAtom}
        errorAtom={errorAtom}
        hasEditAtom={activeHasEditAtom}
        onCompile={handleCompile}
        onApply={handleApply}
        onApplyImmediately={handleApplyImmediately}
        onBraceJump={handleBraceJump}
        memoryUpdateAtom={memoryUpdateAtom}
        libraryOpeningAtom={libraryOpeningAtom}
        mode={mode}
      />
      <DeckLog logsAtom={logsAtom} />
      <StyledStatusBar
        errorAtom={errorAtom}
        cueStatusAtom={cueStatusAtom}
        hasEditAtom={activeHasEditAtom}
        compileTimeAtom={compileTimeAtom}
        onCompile={handleCompile}
        onApply={handleApply}
        onApplyImmediately={handleApplyImmediately}
        onJumpToLine={jumpToLine}
        onToggleMode={handleToggleMode}
        gainParamName={gainParamName}
        mode={mode}
      />

      <DeckLibrary
        libraryOpeningAtom={libraryOpeningAtom}
        onLoad={handleLoad}
        focusEditor={focusEditor}
      />
      <StyledDeckBraceJumpMap
        ref={refBraceJumpMap}
        codeAtom={codeAtom}
      />
      <DeckMemoryUpdateBalloon memoryUpdateAtom={memoryUpdateAtom} />
      {focusHighlightKey > 0 && (
        <DeckFocusHighlight key={focusHighlightKey} />
      )}
    </Root>
  );
});
Deck.displayName = 'Deck';
