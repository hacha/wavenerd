import 'simplebar-react/dist/simplebar.min.css';

import { type DeckAtoms, deckAGlslAtoms, deckAStrudelAtoms, deckBGlslAtoms, deckBStrudelAtoms } from '../stores/atoms/deck';
import { AssetList } from './AssetList';
import { ContextMenu } from './ContextMenu';
import { Deck } from './Deck';
import { DeckKnobs } from './DeckKnobs';
import { Header } from './Header/Header';
import { MIDIMAN } from '../../MIDIManager';
import { MixerView } from './MixerView';
import { PlayOverlay } from './PlayOverlay';
import { useCallback, useContext, useEffect, useRef } from 'react';
import { SETTINGSMAN } from '../../SettingsManager';
import { SettingsModal } from './Settings/SettingsModal';
import { Stalker } from './Stalker';
import { XFader } from './XFader';
import { useDeckSubscribers } from '../stores/hooks/useDeckSubscribers';
import { useMidiSubscribers } from '../stores/hooks/useMidiSubscribers';
import { useSettings } from '../stores/hooks/useSettings';
import { useSettingsSubscribers } from '../stores/hooks/useSettingsSubscribers';
import { useRecorderSubscribers } from '../stores/hooks/useRecorderSubscribers';
import { useStrudelSubscribers } from '../stores/hooks/useStrudelSubscribers';
import { type Stuff, StuffContext } from '../StuffContext';
import { useFullscreenSubscriber } from '../stores/hooks/useFullscreenSubscriber';
import { useStorageSubscribers } from '../stores/hooks/useStorageSubscribers';
import { ThemeStyle } from './ThemeStyle';
import { type Analyser } from '../../audio/Analyser';
import { type CodeDeck } from '../../CodeDeck';
import clsx from 'clsx';

// == hooks ========================================================================================
function useFocusDeckShortcuts({
  focusDeckAEditor,
  focusDeckBEditor,
}: {
  focusDeckAEditor: () => void;
  focusDeckBEditor: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'j' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        focusDeckAEditor();
      } else if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        focusDeckBEditor();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusDeckAEditor, focusDeckBEditor]);
}

// == children =====================================================================================
type DeckRef = { focusEditor: (highlight: boolean) => void };

/**
 * A deck slot (A or B). Keeps both the GLSL deck and the Strudel deck mounted and shows the one of the current mode,
 * so switching the mode neither reloads the code nor interrupts the sound.
 */
function DeckSlot({
  slot,
  refDeck,
  glslDeck,
  strudelDeck,
  glslAtoms,
  strudelAtoms,
  analyser,
}: {
  slot: 'a' | 'b';
  refDeck: React.Ref<DeckRef>;
  glslDeck: CodeDeck;
  strudelDeck: CodeDeck;
  glslAtoms: DeckAtoms;
  strudelAtoms: DeckAtoms;
  analyser: Analyser;
}) {
  const modeKey = slot === 'a' ? 'deckAMode' : 'deckBMode';
  const mode = useSettings(modeKey);

  const handleToggleMode = useCallback(() => {
    SETTINGSMAN.set(modeKey, SETTINGSMAN.values[modeKey] === 'strudel' ? 'glsl' : 'strudel');
  }, [modeKey]);

  const common = {
    analyser,
    gainParamName: `/mixer/channel_${slot}/gain`,
    filterParamName: `/mixer/channel_${slot}/filter`,
    onToggleMode: handleToggleMode,
  };

  return (
    <>
      <Deck
        ref={mode === 'glsl' ? refDeck : undefined}
        className={clsx('grow', mode !== 'glsl' && 'hidden')}
        mode="glsl"
        deck={glslDeck}
        storagePath={`decks/${slot}.glsl`}
        codeAtom={glslAtoms.code}
        hasEditAtom={glslAtoms.hasEdit}
        errorAtom={glslAtoms.error}
        cueStatusAtom={glslAtoms.cueStatus}
        compileTimeAtom={glslAtoms.compileTime}
        {...common}
      />
      <Deck
        ref={mode === 'strudel' ? refDeck : undefined}
        className={clsx('grow', mode !== 'strudel' && 'hidden')}
        mode="strudel"
        deck={strudelDeck}
        storagePath={`decks/${slot}.strudel.js`}
        liveSlot={slot}
        codeAtom={strudelAtoms.code}
        hasEditAtom={strudelAtoms.hasEdit}
        errorAtom={strudelAtoms.error}
        cueStatusAtom={strudelAtoms.cueStatus}
        compileTimeAtom={strudelAtoms.compileTime}
        {...common}
      />
    </>
  );
}

// == component ====================================================================================
export function OutOfContextApp() {
  const { deckA, deckB, strudelDeckA, strudelDeckB, mixer, recorder, storageManager } = useContext(StuffContext)!;

  const uiMargin = useSettings('uiMargin');
  const deckBShow = useSettings('deckBShow');
  const libraryShow = useSettings('libraryShow');
  const mixerShow = useSettings('mixerShow');
  const stalkerShow = useSettings('stalkerShow');
  const showCenterColumn = libraryShow || mixerShow;

  useMidiSubscribers(MIDIMAN);
  useSettingsSubscribers(SETTINGSMAN);
  useDeckSubscribers(
    deckA,
    { glslA: deckA, glslB: deckB, strudelA: strudelDeckA, strudelB: strudelDeckB },
    { glslA: deckAGlslAtoms, glslB: deckBGlslAtoms, strudelA: deckAStrudelAtoms, strudelB: deckBStrudelAtoms },
  );
  useRecorderSubscribers(recorder);
  useStrudelSubscribers(strudelDeckA.engine);
  useStorageSubscribers(storageManager);
  useFullscreenSubscriber();

  const refDeckA = useRef<DeckRef>(null);
  const focusDeckAEditor = useCallback(() => {
    refDeckA.current?.focusEditor?.(true);
  }, [refDeckA]);

  const refDeckB = useRef<DeckRef>(null);
  const focusDeckBEditor = useCallback(() => {
    refDeckB.current?.focusEditor?.(true);
  }, [refDeckB]);

  useFocusDeckShortcuts({
    focusDeckAEditor,
    focusDeckBEditor,
  });

  return (
    <>
      <ThemeStyle />

      <div className="fixed inset-0 text-fore bg-back2 font-sans">
        <div className="absolute inset-0 flex flex-col" style={{ margin: uiMargin }}>
          <Header className="h-8" />
          <div className="flex justify-between flex-row grow gap-0.5">
            <div className="flex flex-col grow">
              <DeckSlot
                slot="a"
                refDeck={refDeckA}
                glslDeck={deckA}
                strudelDeck={strudelDeckA}
                glslAtoms={deckAGlslAtoms}
                strudelAtoms={deckAStrudelAtoms}
                analyser={mixer.analyserInA}
              />
              <DeckKnobs className="h-16" paramPrefix="/deck_a" />
            </div>
            {showCenterColumn && (
              <div className="flex justify-end flex-col w-48">
                {libraryShow && (
                  <AssetList className="grow" />
                )}
                {mixerShow && (
                  <>
                    <MixerView className="py-2" />
                    <XFader className="w-40 h-10 my-2 mx-4" />
                  </>
                )}
              </div>
            )}
            {deckBShow && (
              <div className="flex flex-col grow">
                <DeckSlot
                  slot="b"
                  refDeck={refDeckB}
                  glslDeck={deckB}
                  strudelDeck={strudelDeckB}
                  glslAtoms={deckBGlslAtoms}
                  strudelAtoms={deckBStrudelAtoms}
                  analyser={mixer.analyserInB}
                />
                <DeckKnobs className="h-16" paramPrefix="/deck_b" />
              </div>
            )}
          </div>
        </div>

        <SettingsModal />

        <PlayOverlay />
        <ContextMenu />
        {stalkerShow && <Stalker />}
      </div>
    </>
  );
}

export function App({ stuff }: { stuff: Stuff }) {
  return (
    <StuffContext.Provider value={stuff}>
      <OutOfContextApp />
    </StuffContext.Provider>
  );
}
