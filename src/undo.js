// undo.js — 앱 전용 실행취소 스택.
// 브라우저 기본 undo 는 셀 밖 동작(행 추가/삭제/이동)을 모르기 때문에 쓰지 않는다.
// 명령 객체: { label, redo(), undo() }

const MAX = 200;
const undoStack = [];
const redoStack = [];

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { for (const fn of listeners) fn(); }

/** 명령을 즉시 실행하고 스택에 쌓는다. */
export function run(cmd) {
  const result = cmd.redo();
  undoStack.push(cmd);
  if (undoStack.length > MAX) undoStack.shift();
  redoStack.length = 0;
  notify();
  return result;
}

/** 이미 실행된 동작을 되돌릴 수 있도록 스택에만 올린다. */
export function push(cmd) {
  undoStack.push(cmd);
  if (undoStack.length > MAX) undoStack.shift();
  redoStack.length = 0;
  notify();
}

export function undo() {
  const cmd = undoStack.pop();
  if (!cmd) return null;
  cmd.undo();
  redoStack.push(cmd);
  notify();
  return cmd;
}

export function redo() {
  const cmd = redoStack.pop();
  if (!cmd) return null;
  cmd.redo();
  undoStack.push(cmd);
  notify();
  return cmd;
}

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }
export function clear() { undoStack.length = 0; redoStack.length = 0; notify(); }
