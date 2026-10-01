import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { type Extension, Prec } from '@uiw/react-codemirror';
import { createCMTheme } from './createCMTheme';

/**
 * `strudelTheme`, the default theme of the Strudel REPL (`@strudel/codemirror` 1.2.6, `themes/strudel-theme.mjs`).
 * Strudel decks always use it, whatever the theme of the app, so the code and the drawings look like the REPL.
 */
export const strudelThemeSettings = {
  background: '#222222',
  lineBackground: '#22222299',
  foreground: '#ffffff',
  caret: '#ffcc00',
  selection: 'rgba(128, 203, 196, 0.5)',
  selectionMatch: '#036dd626',
  lineHighlight: '#00000050',
  gutterBackground: 'transparent',
  gutterForeground: '#8a919966',
} as const;

const s = strudelThemeSettings;

/** The syntax colors of `strudelTheme`. */
const highlightStyle = HighlightStyle.define([
  { tag: [t.atom, t.bool, t.special(t.variableName)], color: '#89ddff' },
  { tag: t.labelName, color: '#89ddff' },
  { tag: t.keyword, color: '#c792ea' },
  { tag: t.operator, color: '#89ddff' },
  { tag: t.special(t.variableName), color: '#eeffff' },
  { tag: t.typeName, color: '#c3e88d' },
  { tag: t.atom, color: '#f78c6c' },
  { tag: t.number, color: '#c3e88d' },
  { tag: t.definition(t.variableName), color: '#82aaff' },
  { tag: t.string, color: '#c3e88d' },
  { tag: t.special(t.string), color: '#c3e88d' },
  { tag: t.comment, color: '#7d8799' },
  { tag: t.variableName, color: '#c792ea' },
  { tag: t.tagName, color: '#c3e88d' },
  { tag: t.bracket, color: '#525154' },
  { tag: t.meta, color: '#ffcb6b' },
  { tag: t.attributeName, color: '#c792ea' },
  { tag: t.propertyName, color: '#c792ea' },
  { tag: t.className, color: '#decb6b' },
  { tag: t.invalid, color: '#ffffff' },
  { tag: [t.unit, t.punctuation], color: '#82aaff' },
]);

/**
 * The editor parts that the REPL theme has no colors for (panels, tooltips, search, errors) come from
 * the wavenerd theme structure, filled with the colors of `strudelTheme`.
 */
const baseTheme = createCMTheme({
  ui: {},
  code: {
    text: s.foreground,
    background: s.background,
    keywords: '#c792ea',
    operators: '#89ddff',
    processors: '#c792ea',
    types: '#c3e88d',
    constants: '#c3e88d',
    strings: '#c3e88d',
    comments: '#7d8799',
    invalid: '#ff5370',
    panels: s.background,
    tooltips: '#333333',
    gutterText: s.gutterForeground,
    gutterBackground: s.gutterBackground,
    foldPlaceholders: s.gutterForeground,
    searchMatch: s.selectionMatch,
    searchSelected: '#036dd688',
    backlayer: 'none',
    dark: true,
  },
});

/**
 * What the REPL does on top of its theme, so the code stays readable over the drawings behind it:
 * the tokens get `lineBackground` (`.cm-line > *` in the CSS of strudel.cc), and the current line `lineHighlight`.
 */
const replLook = EditorView.theme({
  '& .cm-line > *': {
    background: s.lineBackground,
  },
  '& .cm-activeLine, & .cm-activeLineGutter': {
    backgroundColor: s.lineHighlight,
  },
  '& .cm-content': {
    caretColor: s.caret,
  },
  '& .cm-cursor, & .cm-dropCursor': {
    borderLeftColor: s.caret,
  },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, & .cm-selectionBackground, & .cm-content ::selection': {
    backgroundColor: s.selection,
  },
}, { dark: true });

/**
 * The editor theme of Strudel decks. Use it in place of the theme of the app.
 */
export const strudelTheme: Extension = [
  baseTheme.theme,
  Prec.high(replLook),
  syntaxHighlighting(highlightStyle),
];
