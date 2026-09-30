import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import { type Extension, Prec, type Range, StateEffect, StateField } from '@uiw/react-codemirror';
import { type FrameEmitter } from '../../FrameEmitter';
import { type StrudelCompiledCode, type StrudelDeck, strudelLocationKey } from '../../strudel/StrudelDeck';

/**
 * Track the mini-notation atoms of a compiled code. Drops the ones of the codes that are neither it nor the active one.
 */
const addLocationsEffect = StateEffect.define<{ compiled: StrudelCompiledCode; activeCodeId: number }>();

/** Keys ({@link strudelLocationKey}) of the atoms that are heard now. */
const setSoundingEffect = StateEffect.define<ReadonlySet<string>>();

/**
 * Where the atoms of the compiled codes are in the document now. Not drawn.
 * The ranges follow the edits, so a pattern that is playing stays highlighted at the right place while its code is edited.
 */
const locationField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (locations, transaction) => {
    locations = locations.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (!effect.is(addLocationsEffect)) { continue; }

      const { compiled, activeCodeId } = effect.value;
      const docLength = transaction.newDoc.length;

      locations = locations.update({
        filter: (_from, _to, value) => value.spec.codeId === activeCodeId,
        add: compiled.miniLocations
          .filter(([from, to]) => from < to && to <= docLength)
          .map(([from, to]) => Decoration.mark({
            key: strudelLocationKey(compiled.id, from, to),
            codeId: compiled.id,
          }).range(from, to)),
        sort: true,
      });
    }

    return locations;
  },
});

const soundingMark = Decoration.mark({ class: 'cm-mini-sounding' });

const soundingField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (sounding, transaction) => {
    for (const effect of transaction.effects) {
      if (!effect.is(setSoundingEffect)) { continue; }

      const keys = effect.value;
      const ranges: Range<Decoration>[] = [];
      if (keys.size > 0) {
        transaction.state.field(locationField).between(0, transaction.newDoc.length, (from, to, value) => {
          if (from < to && keys.has(value.spec.key)) {
            ranges.push(soundingMark.range(from, to));
          }
        });
      }
      return Decoration.set(ranges, true);
    }

    return sounding.map(transaction.changes);
  },
  // lower precedence is the outer element. keep the outline around the whole atom, outside the token colors
  provide: (field) => Prec.lowest(EditorView.decorations.from(field)),
});

/**
 * Highlight the mini-notation atoms of the pattern that are heard now, like the Strudel REPL.
 */
export function strudelHighlight(deck: StrudelDeck, frameEmitter: FrameEmitter): Extension {
  const plugin = ViewPlugin.fromClass(class {
    private readonly __view: EditorView;
    private readonly __handleFrame = (): void => this.__update();
    private readonly __keys = new Set<string>();
    private __lastKeys = '';
    private __lastCodeId = 0;

    /** Compiled code that waits for the document to be the same text, e.g. the code is loaded and compiled at once. */
    private __pending: StrudelCompiledCode | null = null;
    private __shouldCheckPending = false;

    public constructor(view: EditorView) {
      this.__view = view;
      frameEmitter.on('update', this.__handleFrame);
    }

    public update(update: ViewUpdate): void {
      if (update.docChanged) {
        this.__shouldCheckPending = true;
      }
    }

    public destroy(): void {
      frameEmitter.off('update', this.__handleFrame);
    }

    private __update(): void {
      const view = this.__view;

      const compiled = deck.compiledCode;
      if (compiled != null && compiled.id !== this.__lastCodeId) {
        this.__lastCodeId = compiled.id;
        this.__pending = compiled;
        this.__shouldCheckPending = true;
      }

      const pending = this.__pending;
      if (pending != null && this.__shouldCheckPending) {
        this.__shouldCheckPending = false;

        // the offsets are valid only in the text that was compiled
        if (view.state.doc.length === pending.code.length && view.state.doc.toString() === pending.code) {
          this.__pending = null;
          this.__lastKeys = '';
          view.dispatch({
            effects: addLocationsEffect.of({ compiled: pending, activeCodeId: deck.activeCodeId }),
          });
        }
      }

      const keys = this.__keys;
      keys.clear();
      deck.collectSoundingLocations(keys);

      const joinedKeys = keys.size === 0 ? '' : [...keys].sort().join(',');
      if (joinedKeys !== this.__lastKeys) {
        this.__lastKeys = joinedKeys;
        view.dispatch({ effects: setSoundingEffect.of(new Set(keys)) });
      }
    }
  });

  return [locationField, soundingField, plugin];
}
