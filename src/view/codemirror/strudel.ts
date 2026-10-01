import { type EditorState, type Extension } from '@uiw/react-codemirror';
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

// == extension ====================================================================================
/**
 * Language support of the Strudel deck editor: JavaScript, Strudel completion,
 * the highlight of what the deck is playing and the inline drawings.
 * Mini-notation strings are one color like the Strudel REPL.
 */
export function strudel(deck: StrudelDeck, frameEmitter: FrameEmitter): Extension {
  return [
    javascript(),
    javascriptLanguage.data.of({ autocomplete: createCompletionSource(deck.engine) }),
    strudelHighlight(deck, frameEmitter),
    strudelWidgets(deck, frameEmitter),
  ];
}
