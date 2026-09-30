import { atom } from 'jotai';

/** Names of the Strudel sound sources that could not be loaded. */
export const strudelFailedSoundsAtom = atom<string[]>([]);
