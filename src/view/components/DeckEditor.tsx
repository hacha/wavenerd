import { EditorView, KeyBinding, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import ReactCodeMirror, { Prec, ReactCodeMirrorRef } from '@uiw/react-codemirror';
import type { DeckMode } from '../../audio/DeckSwitch';
import { forwardRef, useCallback, useContext, useImperativeHandle, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import SimpleBar from 'simplebar-react';
import { backlayer } from '../codemirror/backlayer';
import { braceJumpKeymap } from '../codemirror/braceJumpKeymap';
import { ThemeVars } from '../themes/ThemeVars';
import { themes } from '../themes/themes';
import { useSettings } from '../stores/hooks/useSettings';
import { PrimitiveAtom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useAtomCallback } from 'jotai/utils';
import { createCMTheme } from '../codemirror/createCMTheme';
import { createErrorlayer } from '../codemirror/createErrorlayer';
import { StuffContext } from '../StuffContext';

// Strudel CodeMirror extensions — all imported here to ensure same module instance
// for StateField/StateEffect pairing (avoids duplicate @codemirror/state issues)
import { highlightExtension, updateMiniLocations, highlightMiniLocations } from '@strudel/codemirror/highlight.mjs';
import { widgetPlugin, updateWidgets } from '@strudel/codemirror/widget.mjs';
import { flashField, flash } from '@strudel/codemirror/flash.mjs';

// == styles =======================================================================================
const StyledReactCodeMirror = styled(ReactCodeMirror)<{ guttersEnabled: boolean }>`
  height: 100%;

  .cm-gutters {
    display: ${({ guttersEnabled }) => guttersEnabled ? 'inherit' : 'none'};
  }
`;

const StyledSimpleBar = styled(SimpleBar)`
  width: 100%;
  height: 100%;

  .simplebar-content {
    min-height: 100%;
  }
`;

const DraggingOverlay = styled.div`
  display: 'block';
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background: ${ThemeVars.fore};
  opacity: 0.125;
  pointer-events: 'auto';
`;

const Root = styled.div`
  transform: translateZ(0);
`;

// == utils ========================================================================================
/** Ref: https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_code_values */
const codeToKeyNameMap = new Map([
  ['Escape', 'Esc'],
  ['Minus', '-'],
  ['Equal', '='],
  ['BracketLeft', '['],
  ['BracketRight', ']'],
  ['Semicolon', ';'],
  ['Quote', '\''],
  ['Backquote', '`'],
  ['Backslash', '\\'],
  ['Comma', ','],
  ['Period', '.'],
  ['Slash', '/'],
  ['NumpadMultiply', '*'],
  ['NumpadSubtract', '-'],
  ['NumpadAdd', '+'],
  ['NumpadDecimal', '.'],
  ['IntlBackslash', '\\'],
  ['NumpadEqual', '='],
  ['NumpadComma', ','],
  ['NumpadEnter', 'Enter'],
  ['NumpadDivide', '/'],
  ['ArrowUp', '↑'],
  ['ArrowLeft', '←'],
  ['ArrowRight', '→'],
  ['ArrowDown', '↓'],
]);

const keysIgnoreSet = new Set([
  'Control',
  'Shift',
  'Alt',
  'Meta',
]);

function getKeyName(event: KeyboardEvent): string {
  if (codeToKeyNameMap.has(event.code)) {
    return codeToKeyNameMap.get(event.code)!;
  }

  if (event.code.startsWith('Key') || event.code.startsWith('Digit') || event.code.startsWith('Numpad')) {
    return event.code.slice(-1);
  }

  return event.code;
}

function keyToLog(event: KeyboardEvent): string | null {
  if (keysIgnoreSet.has(event.key)) {
    return null;
  }

  let log = getKeyName(event);

  if (event.shiftKey) { log = 'Shift-' + log; }
  if (event.ctrlKey) { log = 'Ctrl-' + log; }
  if (event.metaKey) { log = 'Cmd-' + log; }
  if (event.altKey) { log = 'Alt-' + log; }

  return log;
}

// == types ========================================================================================
export interface DeckEditorHandle {
  focusEditor: () => void;
  jumpToLine: (line: number) => void;
  getEditorView: () => EditorView | undefined;
  // Strudel visual operations (dispatch effects from the same module instance as the StateFields)
  strudelUpdateMiniLocations: (locations: unknown[]) => void;
  strudelHighlightMiniLocations: (atTime: number, haps: unknown[]) => void;
  strudelUpdateWidgets: (widgets: unknown[]) => void;
  strudelFlash: () => void;
}

// == component ====================================================================================
export const DeckEditor = forwardRef(({
  codeAtom,
  logsAtom,
  errorAtom,
  hasEditAtom,
  onCompile,
  onApply,
  onApplyImmediately,
  onBraceJump,
  memoryUpdateAtom,
  libraryOpeningAtom,
  className,
  mode = 'glsl',
}: {
  codeAtom: PrimitiveAtom<string>;
  logsAtom: PrimitiveAtom<[ id: number, text: string ][]>;
  errorAtom: PrimitiveAtom<string | null>;
  hasEditAtom: PrimitiveAtom<boolean>;
  onCompile: () => void;
  onApply: () => void;
  onApplyImmediately: () => void;
  onBraceJump?: (index: number) => void;
  memoryUpdateAtom: PrimitiveAtom<{ key: string; status: 'loaded' | 'loadfailed' | 'saved' } | null>;
  libraryOpeningAtom: PrimitiveAtom<boolean>;
  className?: string;
  mode?: DeckMode;
}, ref: React.Ref<DeckEditorHandle>) => {
  const { storageManager } = useContext(StuffContext)!;

  const refCodeMirror = useRef<ReactCodeMirrorRef>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [code, setCode] = useAtom(codeAtom);
  const setMemoryUpdate = useSetAtom(memoryUpdateAtom);
  const setLibraryOpening = useSetAtom(libraryOpeningAtom);
  const setHasEdit = useSetAtom(hasEditAtom);
  const themeString = useSettings('theme');
  const font = useSettings('editorFont');
  const fontVariantLigatures = useSettings('editorFontVariantLigatures');
  const guttersEnabled = useSettings('editorGuttersEnabled');

  const theme = useMemo(() => {
    const theme = (themes[themeString] ?? themes['monokaiSharp']).theme;
    return createCMTheme(theme);
  }, [themeString]);

  const fontExtension = useMemo(() => {
    const theme = EditorView.theme({
      '.cm-scroller': {
        font,
        fontVariantLigatures,
      },
    });
    return [theme];
  }, [font, fontVariantLigatures]);

  // Language extension based on mode
  const languageExtension = useMemo(() => {
    return mode === 'glsl' ? cpp() : javascript();
  }, [mode]);

  const addLog = useAtomCallback(useCallback((get, set, text: string) => {
    const logs = get(logsAtom);
    const id = (logs[0]?.[0] ?? 0) + 1;
    const log: [number, string] = [id, text];
    set(logsAtom, [log, ...logs].slice(0, 5));
  }, [logsAtom]));

  const handleLoadMemory = useCallback(async (key: string) => {
    const ext = mode === 'glsl' ? 'glsl' : 'js';
    const codeFile = await storageManager.getFile(`memories/${key}.${ext}`);
    if (codeFile == null) {
      setMemoryUpdate({ key, status: 'loadfailed' });
      return;
    }

    const code = await codeFile.text();
    const to = refCodeMirror.current?.view?.state?.doc.length;
    refCodeMirror.current?.view?.dispatch(
      { changes: [
        { from: 0, to, insert: code },
      ] },
    );

    const headFile = await storageManager.getFile(`memories/${key}_head.txt`);
    const head = parseInt(await headFile?.text() ?? '0');
    const scrollEffect = EditorView.scrollIntoView(head, { y: 'center' });
    refCodeMirror.current?.view?.dispatch(
      { selection: { anchor: head, head } },
      { effects: scrollEffect },
    );

    setMemoryUpdate({ key, status: 'loaded' });
  }, [setMemoryUpdate, mode]);

  const handleSaveMemory = useCallback(async (key: string) => {
    const ext = mode === 'glsl' ? 'glsl' : 'js';
    const head = refCodeMirror.current?.view?.state.selection.main.head ?? 0;
    await storageManager.save(`memories/${key}.${ext}`, code);
    await storageManager.save(`memories/${key}_head.txt`, head.toString());

    setMemoryUpdate({ key, status: 'saved' });
  }, [code, setMemoryUpdate, mode]);

  // -- keymap -------------------------------------------------------------------------------------
  const customKeymap: KeyBinding[] = useMemo(() => {
    console.log('[DeckEditor] Creating keymap, mode:', mode);
    return [
      {
        key: 'Mod-p',
        preventDefault: true,
        run: () => {
          setLibraryOpening(true);
          return false;
        },
      },
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          console.log('[DeckEditor] Mod-s pressed, calling onCompile');
          onCompile();
          return false;
        },
      },
      {
        key: 'Mod-r',
        preventDefault: true,
        run: () => {
          console.log('[DeckEditor] Mod-r pressed, calling onApply');
          onApply();
          return false;
        },
        shift: () => {
          onApplyImmediately();
          return false;
        },
      },
      ...[...Array(10)].flatMap((_, i) => [
        {
          key: `Mod-${i}`,
          preventDefault: true,
          run: () => {
            handleLoadMemory(i.toString());
            return true;
          },
          shift: () => {
            handleSaveMemory(i.toString());
            return false;
          },
        },
      ]),
      ...braceJumpKeymap({ onBraceJump }),
      ...defaultKeymap,
    ];
  }, [onCompile, onApply, onApplyImmediately, onBraceJump, setLibraryOpening, handleLoadMemory, handleSaveMemory, mode]);

  // -- error layer --------------------------------------------------------------------------------
  const error = useAtomValue(errorAtom);
  const errorLines = useMemo(() => {
    if (error == null) {
      return [];
    }

    const lines: number[] = [];
    for (const match of error.matchAll(/ERROR: (\d+):(\d+)/g)) {
      lines.push(parseInt(match[2], 10));
    }

    return lines;
  }, [error]);
  const errorlayer = useMemo(() => createErrorlayer(errorLines), [errorLines]);

  // Memoize the keymap extension so CodeMirror detects changes
  const keymapExtension = useMemo(
    () => Prec.highest(keymap.of(customKeymap)),
    [customKeymap],
  );

  // Strudel CodeMirror extensions (pattern highlighting, widgets, flash)
  // Always included regardless of mode — StateFields must be present from initial state
  // to avoid "Field is not present in this state" errors during reconfigure.
  // They are inert when no data is dispatched (i.e., in GLSL mode).
  const strudelExtensions = useMemo(
    () => [...highlightExtension, ...widgetPlugin, flashField],
    [],
  );

  const extensions = useMemo(
    () => [languageExtension, keymapExtension, errorlayer, backlayer, ...strudelExtensions],
    [languageExtension, keymapExtension, errorlayer, strudelExtensions],
  );

  // -- event handlers -----------------------------------------------------------------------------
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const log = keyToLog(event.nativeEvent);
      if (log) {
        addLog(log);
      }
    },
    [addLog],
  );

  const handleChange = useCallback(
    (value: string) => {
      setCode(value);
      setHasEdit(true);
    },
    [setCode, setHasEdit],
  );

  const handleFile = useCallback(
    (files: FileList) => {
      const file = files && files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = () => {
          const code = reader.result as string;
          setCode(code);
        };
        reader.readAsText(file);
      }
    },
    [],
  );

  const handleDragOver = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      setIsDragging(true);
    },
    [],
  );

  const handleDragLeave = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      setIsDragging(false);
    },
    [],
  );

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();

      setIsDragging(false);

      const files = event.dataTransfer.files;
      handleFile(files);
    },
    [handleFile],
  );

  // -- imperative handle --------------------------------------------------------------------------
  const focusEditor = useCallback(() => {
    refCodeMirror.current?.view?.focus();
  }, [refCodeMirror]);

  const jumpToLine = useCallback((line: number) => {
    const pos = refCodeMirror.current?.view?.state.doc.line(line).to;
    if (pos == null) {
      throw new Error('Unreachable. line is out of range');
    }

    const scrollEffect = EditorView.scrollIntoView(pos, { y: 'center' });

    refCodeMirror.current?.view?.dispatch(
      { selection: { anchor: pos, head: pos } },
      { effects: scrollEffect },
    );
  }, [refCodeMirror]);

  const getEditorView = useCallback(() => {
    return refCodeMirror.current?.view;
  }, []);

  // Strudel visual operations — using same module instance as the StateFields in extensions
  const strudelUpdateMiniLocations = useCallback((locations: unknown[]) => {
    const view = refCodeMirror.current?.view;
    if (view) {
      console.log('[DeckEditor] strudelUpdateMiniLocations: docLen:', view.state.doc.length, 'locations:', JSON.stringify(locations));
      updateMiniLocations(view, locations);
      // DIAGNOSTIC: verify that setMiniLocations effect was processed by the StateField
      // by checking if we can find the highlight extension's fields in the state
      try {
        const exts = highlightExtension;
        // highlightExtension[0] is the miniLocations StateField
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fieldValue = view.state.field(exts[0] as any);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const iter = (fieldValue as any).iter?.();
        let markCount = 0;
        const markIds: string[] = [];
        if (iter) {
          while (iter.value) {
            markCount++;
            markIds.push(iter.value?.spec?.id ?? 'no-id');
            iter.next();
          }
        }
        console.log('[DeckEditor] DIAGNOSTIC: marks in StateField:', markCount, 'ids:', markIds.join(', '));
      } catch (e) {
        console.log('[DeckEditor] DIAGNOSTIC: field access error:', (e as Error).message);
      }
    }
  }, []);

  const strudelHighlightMiniLocations = useCallback((atTime: number, haps: unknown[]) => {
    const view = refCodeMirror.current?.view;
    if (view) highlightMiniLocations(view, atTime, haps);
  }, []);

  const strudelUpdateWidgets = useCallback((widgets: unknown[]) => {
    const view = refCodeMirror.current?.view;
    if (view) updateWidgets(view, widgets);
  }, []);

  const strudelFlash = useCallback(() => {
    const view = refCodeMirror.current?.view;
    if (view) flash(view);
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focusEditor,
      jumpToLine,
      getEditorView,
      strudelUpdateMiniLocations,
      strudelHighlightMiniLocations,
      strudelUpdateWidgets,
      strudelFlash,
    }),
    [focusEditor, jumpToLine, getEditorView, strudelUpdateMiniLocations, strudelHighlightMiniLocations, strudelUpdateWidgets, strudelFlash],
  );

  // -- component ----------------------------------------------------------------------------------
  return (
    <Root
      className={className}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <StyledSimpleBar>
        <StyledReactCodeMirror
          ref={refCodeMirror}
          value={code}
          extensions={extensions}
          theme={[
            theme.extensions,
            fontExtension,
          ]}
          guttersEnabled={guttersEnabled}
          onKeyDown={handleKeyDown}
          onChange={handleChange}
        />
      </StyledSimpleBar>
      {isDragging && <DraggingOverlay />}
    </Root>
  );
});
DeckEditor.displayName = 'DeckEditor';
