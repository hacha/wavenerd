import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import { type Extension, MapMode, type Range, RangeSet, RangeValue, StateEffect, StateField } from '@uiw/react-codemirror';
import { type FrameEmitter } from '../../FrameEmitter';
import { type StrudelDeck } from '../../strudel/StrudelDeck';
import { drawStrudelVisual, fitStrudelCanvas, setStrudelVisualColorsFromPage } from '../../strudel/StrudelVisuals';
import { addLocationsEffect } from './strudelHighlight';

/** The code that is playing changed. */
const setActiveCodeEffect = StateEffect.define<number>();

/**
 * Where an inline visual of a compiled code is called. Follows the edits like the highlight.
 */
class WidgetPosition extends RangeValue {
  public override point = true;
  public override mapMode = MapMode.TrackDel;

  public readonly codeId: number;
  public readonly visualId: string;
  public readonly width: number;
  public readonly height: number;

  public constructor(codeId: number, visualId: string, width: number, height: number) {
    super();
    this.codeId = codeId;
    this.visualId = visualId;
    this.width = width;
    this.height = height;
  }

  public override eq(other: RangeValue): boolean {
    return other instanceof WidgetPosition
      && other.codeId === this.codeId
      && other.visualId === this.visualId
      && other.width === this.width
      && other.height === this.height;
  }
}

interface WidgetPositions {
  positions: RangeSet<WidgetPosition>;
  activeCodeId: number;
}

const positionField = StateField.define<WidgetPositions>({
  create: () => ({ positions: RangeSet.empty, activeCodeId: 0 }),
  update: (value, transaction) => {
    let { positions, activeCodeId } = value;
    positions = positions.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (effect.is(addLocationsEffect)) {
        const { compiled } = effect.value;
        activeCodeId = effect.value.activeCodeId;
        const docLength = transaction.newDoc.length;

        positions = positions.update({
          filter: (_from, _to, position) => position.codeId === activeCodeId,
          add: compiled.visuals
            .filter((visual) => visual.to != null && visual.to <= docLength)
            .map((visual) => new WidgetPosition(compiled.id, visual.id, visual.width, visual.height).range(visual.to!)),
          sort: true,
        });
      } else if (effect.is(setActiveCodeEffect)) {
        activeCodeId = effect.value;
        // older codes never play again. keep the ones compiled after it
        positions = positions.update({ filter: (_from, _to, position) => position.codeId >= activeCodeId });
      }
    }

    if (positions === value.positions && activeCodeId === value.activeCodeId) { return value; }
    return { positions, activeCodeId };
  },
});

/**
 * Canvases of the inline visuals in an editor, by visual id.
 */
type CanvasRegistry = Map<string, HTMLCanvasElement>;

class VisualWidget extends WidgetType {
  private readonly __registry: CanvasRegistry;
  public readonly visualId: string;
  public readonly width: number;
  public readonly height: number;

  public constructor(registry: CanvasRegistry, visualId: string, width: number, height: number) {
    super();
    this.__registry = registry;
    this.visualId = visualId;
    this.width = width;
    this.height = height;
  }

  // keeps the canvas across compiles, e.g. the second `_scope` stays the second one
  public override eq(other: VisualWidget): boolean {
    return other.visualId === this.visualId && other.width === this.width && other.height === this.height;
  }

  public override toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-strudel-widget';

    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = `${this.width}px`;
    canvas.style.maxWidth = '100%';
    canvas.style.height = `${this.height}px`;
    wrap.appendChild(canvas);

    this.__registry.set(this.visualId, canvas);
    return wrap;
  }

  public override destroy(dom: HTMLElement): void {
    const canvas = this.__registry.get(this.visualId);
    if (canvas != null && dom.contains(canvas)) {
      this.__registry.delete(this.visualId);
    }
  }

  public override ignoreEvent(): boolean {
    return false;
  }
}

/**
 * Inline drawings of Strudel, such as `._pianoroll()`, below the line that calls them, like the Strudel REPL.
 * Shows the ones of the code that is playing.
 */
export function strudelWidgets(deck: StrudelDeck, frameEmitter: FrameEmitter): Extension {
  const registry: CanvasRegistry = new Map();

  const decorations = EditorView.decorations.compute([positionField], (state) => {
    const { positions, activeCodeId } = state.field(positionField);
    const ranges: Range<Decoration>[] = [];

    positions.between(0, state.doc.length, (from, _to, position) => {
      if (position.codeId !== activeCodeId) { return; }

      // a block widget sits between lines
      const lineEnd = state.doc.lineAt(from).to;
      ranges.push(Decoration.widget({
        widget: new VisualWidget(registry, position.visualId, position.width, position.height),
        block: true,
        side: 1,
      }).range(lineEnd));
    });

    return Decoration.set(ranges, true);
  });

  const plugin = ViewPlugin.fromClass(class {
    private readonly __view: EditorView;
    private readonly __handleFrame = (): void => this.__update();

    public constructor(view: EditorView) {
      this.__view = view;
      frameEmitter.on('update', this.__handleFrame);
    }

    public destroy(): void {
      frameEmitter.off('update', this.__handleFrame);
    }

    private __update(): void {
      const view = this.__view;

      if (view.state.field(positionField).activeCodeId !== deck.activeCodeId) {
        view.dispatch({ effects: setActiveCodeEffect.of(deck.activeCodeId) });
      }

      if (registry.size === 0) { return; }

      const visuals = new Map(deck.activeVisuals.map((visual) => [visual.id, visual]));
      const cycle = deck.displayCycle;
      const cps = deck.engine.clock.cps;
      setStrudelVisualColorsFromPage();

      for (const [id, canvas] of registry) {
        const visual = visuals.get(id);
        if (visual == null) { continue; }

        fitStrudelCanvas(canvas);
        drawStrudelVisual(visual, canvas, cycle, cps);
      }
    }
  });

  return [positionField, decorations, plugin];
}
