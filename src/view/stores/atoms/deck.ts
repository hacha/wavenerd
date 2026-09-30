import { atom, type PrimitiveAtom } from 'jotai';
import { defaultCodeA, defaultCodeB, defaultStrudelCodeA, defaultStrudelCodeB } from '../../../defaultCode';
import { type CueStatus } from '../../../CodeDeck';

// == types ========================================================================================
/** Atoms of a code deck (GLSL or Strudel) shown in a `Deck` component. */
export interface DeckAtoms {
  code: PrimitiveAtom<string>;
  hasEdit: PrimitiveAtom<boolean>;
  cueStatus: PrimitiveAtom<CueStatus>;
  error: PrimitiveAtom<string | null>;
  compileTime: PrimitiveAtom<number>;
}

// == atoms ========================================================================================
export const deckACodeAtom = atom<string>(defaultCodeA);
export const deckBCodeAtom = atom<string>(defaultCodeB);

export const deckAHasEditAtom = atom(false);
export const deckBHasEditAtom = atom(false);

export const deckACueStatusAtom = atom<CueStatus>('none');
export const deckBCueStatusAtom = atom<CueStatus>('none');

export const deckAErrorAtom = atom<string | null>(null);
export const deckBErrorAtom = atom<string | null>(null);

export const deckACompileTimeAtom = atom(0.0);
export const deckBCompileTimeAtom = atom(0.0);

export const deckAGlslAtoms: DeckAtoms = {
  code: deckACodeAtom,
  hasEdit: deckAHasEditAtom,
  cueStatus: deckACueStatusAtom,
  error: deckAErrorAtom,
  compileTime: deckACompileTimeAtom,
};

export const deckBGlslAtoms: DeckAtoms = {
  code: deckBCodeAtom,
  hasEdit: deckBHasEditAtom,
  cueStatus: deckBCueStatusAtom,
  error: deckBErrorAtom,
  compileTime: deckBCompileTimeAtom,
};

function createStrudelDeckAtoms(defaultCode: string): DeckAtoms {
  return {
    code: atom(defaultCode),
    hasEdit: atom(false),
    cueStatus: atom<CueStatus>('none'),
    error: atom<string | null>(null),
    compileTime: atom(0.0),
  };
}

export const deckAStrudelAtoms = createStrudelDeckAtoms(defaultStrudelCodeA);
export const deckBStrudelAtoms = createStrudelDeckAtoms(defaultStrudelCodeB);

export const deckTimeAtom = atom(0.0);
export const deckIsPlayingAtom = atom(false);
export const deckBeatsAtom = atom({
  beat: 0.0,
  bar: 0.0,
  sixteenBar: 0.0,
});
export const deckBPMAtom = atom(140.0);

export const deckShowBAtom = atom(true);
