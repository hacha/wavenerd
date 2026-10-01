import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { type EditorState, type Extension, Prec, RangeSetBuilder } from '@uiw/react-codemirror';
import { syntaxTree } from '@codemirror/language';
import { javascript, javascriptLanguage, type scopeCompletionSource } from '@codemirror/lang-javascript';
import * as webaudioModule from '@strudel/webaudio';
import { STRUDEL_KNOB_NAMES, type StrudelEngine } from '../../strudel/StrudelEngine';
import { type StrudelDeck } from '../../strudel/StrudelDeck';
import { type FrameEmitter } from '../../FrameEmitter';
import { strudelHighlight } from './strudelHighlight';
import { strudelWidgets } from './strudelWidgets';

const { soundMap } = webaudioModule;

const knobNames = new Set<string>(STRUDEL_KNOB_NAMES);

type CompletionSource = ReturnType<typeof scopeCompletionSource>;
type SyntaxNode = ReturnType<ReturnType<typeof syntaxTree>['resolveInner']>;

// == mini-notation strings ========================================================================
/**
 * Whether the node is a string that Strudel parses as mini-notation: double quotes or backticks.
 */
function isMiniString(node: SyntaxNode, state: EditorState): boolean {
  if (node.name === 'TemplateString') { return true; }
  if (node.name !== 'String') { return false; }
  return state.doc.sliceString(node.from, node.from + 1) === '"';
}

/**
 * Ranges of the contents of a mini string, excluding the quotes and `${}` of templates.
 */
function miniStringRanges(node: SyntaxNode, state: EditorState): [number, number][] {
  const from = node.from + 1;
  const quote = state.doc.sliceString(node.from, node.from + 1);
  const closed = node.to - node.from >= 2 && state.doc.sliceString(node.to - 1, node.to) === quote;
  const to = closed ? node.to - 1 : node.to;

  const ranges: [number, number][] = [];
  let begin = from;
  for (let child = node.firstChild; child != null; child = child.nextSibling) {
    if (child.name === 'Interpolation') {
      ranges.push([begin, child.from]);
      begin = child.to;
    }
  }
  ranges.push([begin, to]);

  return ranges.filter(([a, b]) => a < b);
}

// == highlight ====================================================================================
const miniTokenRegex = /(-?\d*\.?\d+)|(~)|([A-Za-z][\w#']*)|([[\]{}<>(),|*/!@?:%^_.+-])/g;

const miniMarks = [
  Decoration.mark({ class: 'cm-mini-number' }),
  Decoration.mark({ class: 'cm-mini-rest' }),
  Decoration.mark({ class: 'cm-mini-word' }),
  Decoration.mark({ class: 'cm-mini-operator' }),
];

function buildMiniDecorations(view: EditorView): DecorationSet {
  const { state } = view;
  const builder = new RangeSetBuilder<Decoration>();

  // a string can span several visible ranges. skip the ones already added
  let processedTo = -1;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (nodeRef) => {
        const node = nodeRef.node;
        if (!isMiniString(node, state)) { return; }
        if (node.from < processedTo) { return false; }
        processedTo = node.to;

        for (const [begin, end] of miniStringRanges(node, state)) {
          const text = state.doc.sliceString(begin, end);
          for (const match of text.matchAll(miniTokenRegex)) {
            const kind = match.slice(1).findIndex((group) => group != null);
            const tokenFrom = begin + match.index;
            builder.add(tokenFrom, tokenFrom + match[0].length, miniMarks[kind]);
          }
        }

        return false;
      },
    });
  }

  return builder.finish();
}

const miniHighlighter = ViewPlugin.fromClass(class {
  public decorations: DecorationSet;

  public constructor(view: EditorView) {
    this.decorations = buildMiniDecorations(view);
  }

  public update(update: ViewUpdate): void {
    if (
      update.docChanged
      || update.viewportChanged
      || syntaxTree(update.startState) !== syntaxTree(update.state)
    ) {
      this.decorations = buildMiniDecorations(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
});

// == completion ===================================================================================
const soundFunctionNames = new Set(['s', 'sound']);

/**
 * Whether the string is an argument of `s()` / `sound()`, or of the methods of the same names.
 * Other mini strings (`note("c e g")` etc.) do not take sound names.
 */
function isSoundArgument(node: SyntaxNode, state: EditorState): boolean {
  const argList = node.parent;
  const call = argList?.parent;
  if (argList?.name !== 'ArgList' || call?.name !== 'CallExpression') { return false; }

  const callee = call.firstChild;
  const nameNode = callee?.name === 'MemberExpression' ? callee.lastChild : callee;
  if (nameNode == null || (nameNode.name !== 'VariableName' && nameNode.name !== 'PropertyName')) { return false; }

  return soundFunctionNames.has(state.doc.sliceString(nameNode.from, nameNode.to));
}

function createCompletionSource(engine: StrudelEngine): CompletionSource {
  return (context) => {
    const node = syntaxTree(context.state).resolveInner(context.pos, -1);

    // sound names in mini strings
    const stringNode = node.name === 'TemplateString' || node.name === 'String' ? node : null;
    if (stringNode != null) {
      if (!isMiniString(stringNode, context.state) || !isSoundArgument(stringNode, context.state)) { return null; }

      const word = context.matchBefore(/[\w]*/);
      if (word == null || (word.from === word.to && !context.explicit)) { return null; }

      return {
        from: word.from,
        options: Object.keys(soundMap.get()).map((label) => ({ label, type: 'constant' })),
        validFor: /^\w*$/,
      };
    }

    const { globals, methods } = engine.completionWords;

    // methods after a dot
    if (node.name === 'PropertyName' || node.name === '.') {
      const from = node.name === '.' ? node.to : node.from;
      return {
        from,
        options: methods.map((label) => ({ label, type: 'method' })),
        validFor: /^[\w$]*$/,
      };
    }

    if (node.name === 'VariableName' || context.explicit) {
      const word = context.matchBefore(/[\w$]*/);
      if (word == null || (word.from === word.to && !context.explicit)) { return null; }

      return {
        from: word.from,
        options: globals.map((label) => ({ label, type: knobNames.has(label) ? 'variable' : 'function' })),
        validFor: /^[\w$]*$/,
      };
    }

    return null;
  };
}

// == look ========================================================================================
/**
 * Same as the Strudel REPL, so the code stays readable over the drawings behind it:
 * the tokens get a dark background (`lineBackground`, the background at 60%),
 * and the current line gets darker (`lineHighlight`).
 */
const strudelLook = Prec.highest(EditorView.theme({
  '& .cm-line > *': {
    background: 'color-mix(in srgb, var(--color-code-background) 60%, transparent)',
  },
  '& .cm-activeLine, & .cm-activeLineGutter': {
    backgroundColor: '#00000050',
  },
}));

// == extension ====================================================================================
/**
 * Language support of the Strudel deck editor: JavaScript, Strudel completion, mini-notation highlight
 * and the highlight of what the deck is playing.
 */
export function strudel(deck: StrudelDeck, frameEmitter: FrameEmitter): Extension {
  return [
    javascript(),
    javascriptLanguage.data.of({ autocomplete: createCompletionSource(deck.engine) }),
    miniHighlighter,
    strudelHighlight(deck, frameEmitter),
    strudelWidgets(deck, frameEmitter),
    strudelLook,
  ];
}
