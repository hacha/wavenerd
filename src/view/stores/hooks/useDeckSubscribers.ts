import { type DeckAtoms, deckBPMAtom, deckBeatsAtom, deckIsPlayingAtom, deckTimeAtom } from '../atoms/deck';
import { type WavenerdDeck } from '@0b5vr/wavenerd-deck';
import { useEffect } from 'react';
import { useSetAtom } from 'jotai';
import { type CodeDeck, type CodeDeckEvents } from '../../../CodeDeck';

function useCodeDeckSubscribers(deck: CodeDeck, atoms: DeckAtoms) {
  const setCueStatus = useSetAtom(atoms.cueStatus);
  const setError = useSetAtom(atoms.error);

  useEffect(() => {
    const handleChangeCueStatus = ({ cueStatus }: CodeDeckEvents['changeCueStatus']) => {
      setCueStatus(cueStatus);
    };
    deck.on('changeCueStatus', handleChangeCueStatus);

    const handleError = ({ error }: CodeDeckEvents['error']) => {
      setError(error ?? null);
    };
    deck.on('error', handleError);

    return () => {
      deck.off('changeCueStatus', handleChangeCueStatus);
      deck.off('error', handleError);
    };
  });
}

function useDeckTransportSubscribers(hostDeck: WavenerdDeck) {
  const setDeckTime = useSetAtom(deckTimeAtom);
  const setDeckBeats = useSetAtom(deckBeatsAtom);
  const setDeckIsPlaying = useSetAtom(deckIsPlayingAtom);
  const setDeckBPM = useSetAtom(deckBPMAtom);

  useEffect(() => {
    const handleBeatManagerUpdate = hostDeck.beatManager.on('update', (event) => {
      setDeckTime(event.time);
      setDeckBeats({
        beat: event.beat,
        bar: event.bar,
        sixteenBar: event.sixteenBar,
      });
    });

    const handlePlay = hostDeck.on('play', () => {
      setDeckIsPlaying(true);
    });

    const handlePause = hostDeck.on('pause', () => {
      setDeckIsPlaying(false);
    });

    const handleChangeBPM = hostDeck.on('changeBPM', ({ bpm }) => {
      setDeckBPM(bpm);
    });

    return () => {
      hostDeck.beatManager.off('update', handleBeatManagerUpdate);
      hostDeck.off('play', handlePlay);
      hostDeck.off('pause', handlePause);
      hostDeck.off('changeBPM', handleChangeBPM);
    };
  });
}

export function useDeckSubscribers(
  hostDeck: WavenerdDeck,
  decks: {
    glslA: CodeDeck;
    glslB: CodeDeck;
    strudelA: CodeDeck;
    strudelB: CodeDeck;
  },
  atoms: {
    glslA: DeckAtoms;
    glslB: DeckAtoms;
    strudelA: DeckAtoms;
    strudelB: DeckAtoms;
  },
) {
  useCodeDeckSubscribers(decks.glslA, atoms.glslA);
  useCodeDeckSubscribers(decks.glslB, atoms.glslB);
  useCodeDeckSubscribers(decks.strudelA, atoms.strudelA);
  useCodeDeckSubscribers(decks.strudelB, atoms.strudelB);
  useDeckTransportSubscribers(hostDeck);
}
