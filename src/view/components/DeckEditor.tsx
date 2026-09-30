import { EditorView, type KeyBinding, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { cpp } from '@codemirror/lang-cpp';
import { javascript } from '@codemirror/lang-javascript';
import ReactCodeMirror, { Prec, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { forwardRef, useCallback, useContext, useImperativeHandle, useMemo, useRef, useState } from 'react';
import SimpleBar from 'simplebar-react';
import { backlayer } from '../codemirror/backlayer';
import { braceJumpKeymap } from '../codemirror/braceJumpKeymap';
import { themes } from '../themes/themes';
import { useSettings } from '../stores/hooks/useSettings';
import { type PrimitiveAtom, useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useAtomCallback } from 'jotai/utils';
import { createCMTheme } from '../codemirror/createCMTheme';
import { createErrorlayer } from '../codemirror/createErrorlayer';
import { StuffContext } from '../StuffContext';
import clsx from 'clsx';
import styles from './DeckEditor.module.css';
import { type DeckSourceMode } from '../../audio/DeckSourceSwitch';

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

function memoryPaths(mode: DeckSourceMode, memoryKey: string): { code: string; head: string } {
  if (mode === 'strudel') {
    return {
      code: `memories/strudel/${memoryKey}.js`,
      head: `memories/strudel/${memoryKey}_head.txt`,
    };
  }

  return {
    code: `memories/${memoryKey}.glsl`,
    head: `memories/${memoryKey}_head.txt`,
  };
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

// == component ====================================================================================
export const DeckEditor = forwardRef(({
  mode,
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
}: {
  mode: DeckSourceMode;
  codeAtom: PrimitiveAtom<string>;
  logsAtom: PrimitiveAtom<[ id: number, text: string ][]>;
  errorAtom: PrimitiveAtom<string | null>;
  hasEditAtom: PrimitiveAtom<boolean>;
  onCompile: () => void;
  onApply: () => void;
  onApplyImmediately: () => void;
  onBraceJump?: (index: number) => void;
  memoryUpdateAtom: PrimitiveAtom<{
    renderKey: number;
    memoryKey: string;
    status: 'loaded' | 'loadfailed' | 'saved';
  } | null>;
  libraryOpeningAtom: PrimitiveAtom<boolean>;
  className?: string;
}, ref: React.Ref<{ focusEditor: () => void }>) => {
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

  const addLog = useAtomCallback(useCallback((get, set, text: string) => {
    const logs = get(logsAtom);
    const id = (logs[0]?.[0] ?? 0) + 1;
    const log: [number, string] = [id, text];
    set(logsAtom, [log, ...logs].slice(0, 5));
  }, [logsAtom]));

  const handleLoadMemory = useCallback(async (memoryKey: string) => {
    const paths = memoryPaths(mode, memoryKey);
    const codeFile = await storageManager.getFile(paths.code);
    if (codeFile == null) {
      setMemoryUpdate((prev) => ({
        renderKey: (prev?.renderKey ?? 0) + 1,
        memoryKey,
        status: 'loadfailed',
      }));
      return;
    }

    const code = await codeFile.text();
    const to = refCodeMirror.current?.view?.state?.doc.length;
    refCodeMirror.current?.view?.dispatch(
      { changes: [
        { from: 0, to, insert: code },
      ] },
    );

    const headFile = await storageManager.getFile(paths.head);
    const head = parseInt(await headFile?.text() ?? '0');
    const scrollEffect = EditorView.scrollIntoView(head, { y: 'center' });
    refCodeMirror.current?.view?.dispatch(
      { selection: { anchor: head, head } },
      { effects: scrollEffect },
    );

    setMemoryUpdate((prev) => ({
      renderKey: (prev?.renderKey ?? 0) + 1,
      memoryKey,
      status: 'loaded',
    }));
  }, [mode, setMemoryUpdate, storageManager]);

  const handleSaveMemory = useCallback(async (memoryKey: string) => {
    const head = refCodeMirror.current?.view?.state.selection.main.head ?? 0;
    const paths = memoryPaths(mode, memoryKey);
    await storageManager.save(paths.code, code);
    await storageManager.save(paths.head, head.toString());

    setMemoryUpdate((prev) => ({
      renderKey: (prev?.renderKey ?? 0) + 1,
      memoryKey,
      status: 'saved',
    }));
  }, [code, mode, setMemoryUpdate, storageManager]);

  // -- keymap -------------------------------------------------------------------------------------
  const customKeymap: KeyBinding[] = useMemo(() => [
    {
      key: 'Mod-p',
      preventDefault: true,
      run: () => {
        // the library has GLSL shaders only
        if (mode === 'glsl') {
          setLibraryOpening(true);
        }
        return false;
      },
    },
    {
      key: 'Mod-s',
      preventDefault: true,
      run: () => {
        onCompile();
        return false;
      },
    },
    {
      key: 'Mod-r',
      preventDefault: true,
      run: () => {
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
  ], [mode, onCompile, onApply, onApplyImmediately, onBraceJump, setLibraryOpening, handleLoadMemory, handleSaveMemory]);

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
    [setCode],
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

  useImperativeHandle(
    ref,
    () => ({ focusEditor, jumpToLine }),
    [focusEditor, jumpToLine],
  );

  // -- component ----------------------------------------------------------------------------------
  return (
    <div
      className={clsx(
        'transform-gpu',
        styles.root,
        !guttersEnabled && styles.hideGutters,
        className,
      )}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <SimpleBar className="w-full h-full deck-editor-simplebar">
        <ReactCodeMirror
          ref={refCodeMirror}
          className="h-full"
          value={code}
          extensions={[
            mode === 'strudel' ? javascript() : cpp(),
            Prec.highest(keymap.of(customKeymap)),
            errorlayer,
            backlayer,
          ]}
          theme={[
            theme.extensions,
            fontExtension,
          ]}
          onKeyDown={handleKeyDown}
          onChange={handleChange}
        />
      </SimpleBar>
      {isDragging && (
        <div className="absolute inset-0 bg-fore opacity-[0.125]" />
      )}
    </div>
  );
});
DeckEditor.displayName = 'DeckEditor';
