// store.js — 메모리 상태 + 변경 알림 + IndexedDB 영속화.
//
// 규칙:
//  * 데이터를 바꾸는 모든 경로는 이 파일의 함수를 통과한다.
//  * 화면은 메모리 상태만 읽는다. 디스크 기록은 뒤에서 비동기로 따라간다.
//  * 루트 폴더의 parentFolderID 는 '' 이다 (null 아님).
//  * isReview(boolean) 과 isReviewFlag(0|1) 은 항상 함께 바뀐다.

import * as db from './db.js';

export const folders = new Map();   // id -> folder
export const questions = new Map(); // id -> question
export const settings = {};

export const ROOT = '';

const DEFAULT_SETTINGS = {
  // iPad 가로(약 1180pt)에서 사이드바 280pt 를 빼고도 가로 스크롤 없이 들어가는 값.
  columnWidths: {
    star: 46, no: 54, src: 150,
    questionText: 280, answerCount: 70, answerText: 240, explanation: 150,
  },
  sidebarWidth: 280,
  lastFolderID: '',
  folderCountMode: 'deep', // 'deep' = 하위 폴더 포함, 'direct' = 직접 속한 문제만
  lastBackupAt: 0,
};

// ── 이벤트 ──────────────────────────────────────────────────
const listeners = new Set();
let muted = 0;
let pendingScope = null;

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function emit(scope) {
  if (scope.folders || scope.questions) recomputeCounts();
  if (muted > 0) {
    pendingScope = pendingScope || {};
    Object.assign(pendingScope, scope);
    return;
  }
  for (const fn of listeners) fn(scope);
}

/** 여러 변경을 하나의 렌더로 묶는다. */
export function batch(fn) {
  muted++;
  try { return fn(); }
  finally {
    muted--;
    if (muted === 0 && pendingScope) {
      const s = pendingScope; pendingScope = null;
      for (const listener of listeners) listener(s);
    }
  }
}

// ── 유틸 ────────────────────────────────────────────────────
let counter = 0;
export function uid() {
  counter = (counter + 1) % 4096;
  return Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6);
}
const now = () => Date.now();

function reportError(err) {
  console.error('[ExamTree] 저장 실패:', err);
  window.dispatchEvent(new CustomEvent('examtree:saveerror', { detail: err }));
}

function saveFolders(list) { db.putMany('folders', list).catch(reportError); }
function saveQuestions(list) { db.putMany('questions', list).catch(reportError); }
function saveSetting(key) { db.put('settings', { key, value: settings[key] }).catch(reportError); }

// ── 로딩 ────────────────────────────────────────────────────
export async function load() {
  const [fs, qs, ss] = await Promise.all([
    db.all('folders'), db.all('questions'), db.all('settings'),
  ]);
  folders.clear(); questions.clear();
  for (const f of fs) folders.set(f.id, f);
  for (const q of qs) questions.set(q.id, normalizeQuestion(q));
  Object.assign(settings, DEFAULT_SETTINGS);
  for (const s of ss) settings[s.key] = s.value;
  settings.columnWidths = { ...DEFAULT_SETTINGS.columnWidths, ...(settings.columnWidths || {}) };
  if (folders.size === 0 && questions.size === 0) seed();
  recomputeCounts();
}

function normalizeQuestion(q) {
  const isReview = !!q.isReview;
  return { ...q, isReview, isReviewFlag: isReview ? 1 : 0 };
}

function seed() {
  const t = now();
  const mk = (name, parent, order) => {
    const f = { id: uid(), name, parentFolderID: parent, order, expanded: true, createdAt: t, updatedAt: t };
    folders.set(f.id, f);
    return f;
  };
  const root = mk('일반기계기사', ROOT, 0);
  const thermo = mk('열역학', root.id, 0);
  const ch1 = mk('열역학 제1법칙', thermo.id, 0);
  mk('열역학 제2법칙', thermo.id, 1);
  mk('사이클', thermo.id, 2);
  mk('유체역학', root.id, 1);
  mk('재료역학', root.id, 2);

  const samples = [
    ['열전달의 세 가지 방식은?', '3', '전도 / 대류 / 복사', ''],
    ['열역학 제1법칙의 핵심 내용을 쓰시오.', '2', '에너지 보존 / 내부에너지 변화', ''],
  ];
  samples.forEach(([questionText, answerCount, answerText, explanation], i) => {
    const q = {
      id: uid(), folderID: ch1.id, order: i,
      questionText, answerCount, answerText, explanation,
      isReview: false, isReviewFlag: 0, reviewMarkedAt: 0, createdAt: t, updatedAt: t,
    };
    questions.set(q.id, q);
  });

  settings.lastFolderID = ch1.id;
  // 방금 만든 데이터에 대고 "백업한 지 오래되었다"고 알리지 않도록 기준 시각을 지금으로 잡는다.
  settings.lastBackupAt = t;
  saveFolders([...folders.values()]);
  saveQuestions([...questions.values()]);
  saveSetting('lastFolderID');
  saveSetting('lastBackupAt');
}

// ── 조회 ────────────────────────────────────────────────────
const byOrder = (a, b) => a.order - b.order;

export function childFolders(parentID) {
  const out = [];
  for (const f of folders.values()) if (f.parentFolderID === parentID) out.push(f);
  return out.sort(byOrder);
}

export function rootFolders() { return childFolders(ROOT); }

export function questionsIn(folderID) {
  const out = [];
  for (const q of questions.values()) if (q.folderID === folderID) out.push(q);
  return out.sort(byOrder);
}

export function reviewQuestions() {
  const out = [];
  for (const q of questions.values()) if (q.isReviewFlag === 1) out.push(q);
  return out.sort((a, b) => {
    const pa = folderPathText(a.folderID);
    const pb = folderPathText(b.folderID);
    return pa === pb ? a.order - b.order : pa.localeCompare(pb, 'ko');
  });
}

export function reviewCount() {
  let n = 0;
  for (const q of questions.values()) if (q.isReviewFlag === 1) n++;
  return n;
}

export function folderPath(folderID) {
  const path = [];
  let cur = folders.get(folderID);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    path.unshift(cur);
    cur = cur.parentFolderID ? folders.get(cur.parentFolderID) : null;
  }
  return path;
}

export function folderPathText(folderID, sep = ' > ') {
  return folderPath(folderID).map((f) => f.name).join(sep);
}

/** id 가 ancestorID 자신이거나 그 하위인지 */
export function isDescendant(id, ancestorID) {
  let cur = folders.get(id);
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    if (cur.id === ancestorID) return true;
    guard.add(cur.id);
    cur = cur.parentFolderID ? folders.get(cur.parentFolderID) : null;
  }
  return false;
}

// ── 문제 수 집계 ────────────────────────────────────────────
const directCount = new Map();
const deepCount = new Map();

function recomputeCounts() {
  directCount.clear(); deepCount.clear();
  for (const q of questions.values()) {
    directCount.set(q.folderID, (directCount.get(q.folderID) || 0) + 1);
  }
  const children = new Map();
  for (const f of folders.values()) {
    if (!children.has(f.parentFolderID)) children.set(f.parentFolderID, []);
    children.get(f.parentFolderID).push(f.id);
  }
  const visit = (id, seen) => {
    if (deepCount.has(id)) return deepCount.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    let n = directCount.get(id) || 0;
    for (const c of children.get(id) || []) n += visit(c, seen);
    deepCount.set(id, n);
    return n;
  };
  for (const f of folders.values()) visit(f.id, new Set());
}

export function countOf(folderID) {
  return settings.folderCountMode === 'direct'
    ? (directCount.get(folderID) || 0)
    : (deepCount.get(folderID) || 0);
}
export function directCountOf(folderID) { return directCount.get(folderID) || 0; }

// ── 폴더 변경 ───────────────────────────────────────────────
export function createFolder(name, parentFolderID = ROOT) {
  const siblings = childFolders(parentFolderID);
  const t = now();
  const f = {
    id: uid(), name: name || '새 폴더', parentFolderID,
    order: siblings.length ? siblings[siblings.length - 1].order + 1 : 0,
    expanded: true, createdAt: t, updatedAt: t,
  };
  folders.set(f.id, f);
  const parent = folders.get(parentFolderID);
  if (parent && !parent.expanded) { parent.expanded = true; saveFolders([parent]); }
  saveFolders([f]);
  emit({ folders: true });
  return f;
}

export function addFolderRecord(f) {
  folders.set(f.id, f);
  saveFolders([f]);
  emit({ folders: true });
  return f;
}

export function updateFolder(id, patch) {
  const f = folders.get(id);
  if (!f) return null;
  Object.assign(f, patch, { updatedAt: now() });
  saveFolders([f]);
  emit({ folders: true });
  return f;
}

/** 하위 폴더와 문제까지 통째로 지운다. 실행취소를 위해 삭제된 내용을 돌려준다. */
export function deleteFolderDeep(id) {
  const ids = [];
  const walk = (fid) => { ids.push(fid); for (const c of childFolders(fid)) walk(c.id); };
  walk(id);
  const idSet = new Set(ids);
  const removedFolders = ids.map((i) => folders.get(i)).filter(Boolean);
  const removedQuestions = [...questions.values()].filter((q) => idSet.has(q.folderID));
  for (const i of ids) folders.delete(i);
  for (const q of removedQuestions) questions.delete(q.id);
  db.removeMany('folders', ids).catch(reportError);
  db.removeMany('questions', removedQuestions.map((q) => q.id)).catch(reportError);
  emit({ folders: true, questions: true });
  return { folders: removedFolders, questions: removedQuestions };
}

/** deleteFolderDeep / deleteQuestions 결과를 되돌린다. */
export function restore(snapshot) {
  for (const f of snapshot.folders || []) folders.set(f.id, f);
  for (const q of snapshot.questions || []) questions.set(q.id, normalizeQuestion(q));
  saveFolders(snapshot.folders || []);
  saveQuestions(snapshot.questions || []);
  emit({ folders: true, questions: true });
}

/** 같은 부모 안에서 순서를 재배열한다. ids 가 새 순서. */
export function setFolderOrder(parentFolderID, ids) {
  const changed = [];
  ids.forEach((id, i) => {
    const f = folders.get(id);
    if (f && (f.order !== i || f.parentFolderID !== parentFolderID)) {
      f.order = i; f.parentFolderID = parentFolderID; f.updatedAt = now();
      changed.push(f);
    }
  });
  if (changed.length) { saveFolders(changed); emit({ folders: true }); }
}

/** 폴더를 다른 부모의 index 위치로 옮긴다. */
export function moveFolder(id, newParentID, index) {
  const f = folders.get(id);
  if (!f) return;
  if (newParentID !== ROOT && isDescendant(newParentID, id)) return; // 자기 하위로는 이동 불가
  const oldParent = f.parentFolderID;
  const siblings = childFolders(newParentID).filter((s) => s.id !== id);
  const at = Math.max(0, Math.min(index == null ? siblings.length : index, siblings.length));
  siblings.splice(at, 0, f);
  batch(() => {
    setFolderOrder(newParentID, siblings.map((s) => s.id));
    if (oldParent !== newParentID) {
      setFolderOrder(oldParent, childFolders(oldParent).map((s) => s.id));
      const parent = folders.get(newParentID);
      if (parent && !parent.expanded) updateFolder(parent.id, { expanded: true });
    }
  });
}

export function snapshotFolderPosition(id) {
  const f = folders.get(id);
  return f ? { id, parentFolderID: f.parentFolderID, order: f.order } : null;
}

export function restoreFolderPosition(pos) {
  if (!pos) return;
  moveFolder(pos.id, pos.parentFolderID, pos.order);
}

// ── 문제 변경 ───────────────────────────────────────────────
export function blankQuestion(folderID, order) {
  const t = now();
  return {
    id: uid(), folderID, order,
    questionText: '', answerCount: '', answerText: '', explanation: '',
    isReview: false, isReviewFlag: 0, reviewMarkedAt: 0,
    createdAt: t, updatedAt: t,
  };
}

/** index 가 없으면 맨 뒤에 추가한다. */
export function createQuestion(folderID, index) {
  const list = questionsIn(folderID);
  const q = blankQuestion(folderID, list.length);
  questions.set(q.id, q);
  if (index != null && index < list.length) {
    list.splice(index, 0, q);
    batch(() => setQuestionOrder(folderID, list.map((x) => x.id)));
  } else {
    saveQuestions([q]);
  }
  emit({ questions: true });
  return q;
}

export function insertQuestions(list) {
  for (const q of list) questions.set(q.id, normalizeQuestion(q));
  saveQuestions(list);
  emit({ questions: true });
}

export function updateQuestion(id, patch) {
  const q = questions.get(id);
  if (!q) return null;
  Object.assign(q, patch, { updatedAt: now() });
  if ('isReview' in patch) q.isReviewFlag = q.isReview ? 1 : 0;
  saveQuestions([q]);
  // quiet: 내용만 바뀌었을 뿐 행 구성은 그대로 → 시트를 다시 그리지 않는다.
  emit({ questions: true, quiet: true });
  return q;
}

export function deleteQuestions(ids) {
  const removed = ids.map((i) => questions.get(i)).filter(Boolean);
  const folderIDs = new Set(removed.map((q) => q.folderID));
  for (const q of removed) questions.delete(q.id);
  db.removeMany('questions', removed.map((q) => q.id)).catch(reportError);
  batch(() => {
    for (const fid of folderIDs) setQuestionOrder(fid, questionsIn(fid).map((q) => q.id));
    emit({ questions: true });
  });
  return { folders: [], questions: removed };
}

export function setQuestionOrder(folderID, ids) {
  const changed = [];
  ids.forEach((id, i) => {
    const q = questions.get(id);
    if (q && (q.order !== i || q.folderID !== folderID)) {
      q.order = i; q.folderID = folderID; q.updatedAt = now();
      changed.push(q);
    }
  });
  if (changed.length) { saveQuestions(changed); emit({ questions: true }); }
}

/**
 * 문제를 다른 폴더로 옮긴다. id 는 그대로 두고 folderID 만 바꾼다 (PRD 14장).
 * 실행취소용으로 원래 위치를 돌려준다.
 */
export function moveQuestions(ids, targetFolderID) {
  const before = ids.map((id) => {
    const q = questions.get(id);
    return q ? { id, folderID: q.folderID, order: q.order } : null;
  }).filter(Boolean);
  const sourceFolders = new Set(before.map((b) => b.folderID));
  let next = questionsIn(targetFolderID).length;
  batch(() => {
    const moved = [];
    for (const id of ids) {
      const q = questions.get(id);
      if (!q || q.folderID === targetFolderID) continue;
      q.folderID = targetFolderID;
      q.order = next++;
      q.updatedAt = now();
      moved.push(q);
    }
    if (moved.length) saveQuestions(moved);
    for (const fid of sourceFolders) {
      if (fid === targetFolderID) continue;
      setQuestionOrder(fid, questionsIn(fid).map((q) => q.id));
    }
    emit({ questions: true });
  });
  return before;
}

/** moveQuestions 의 실행취소. */
export function restoreQuestionPositions(before) {
  const touched = new Set();
  batch(() => {
    const changed = [];
    for (const b of before) {
      const q = questions.get(b.id);
      if (!q) continue;
      q.folderID = b.folderID; q.order = b.order; q.updatedAt = now();
      changed.push(q);
      touched.add(b.folderID);
    }
    if (changed.length) saveQuestions(changed);
    for (const fid of touched) setQuestionOrder(fid, questionsIn(fid).map((q) => q.id));
    emit({ questions: true });
  });
}

/** ★ 복습 표시. 복사본을 만들지 않고 원본 레코드만 바꾼다 (PRD 74-1). */
export function setReview(id, on) {
  const q = questions.get(id);
  if (!q) return null;
  q.isReview = !!on;
  q.isReviewFlag = on ? 1 : 0;
  q.reviewMarkedAt = on ? now() : 0;
  q.updatedAt = now();
  saveQuestions([q]);
  emit({ questions: true });
  return q;
}

// ── 설정 ────────────────────────────────────────────────────
export function getSetting(key) { return settings[key]; }

export function setSetting(key, value) {
  settings[key] = value;
  saveSetting(key);
  emit({ settings: true, quiet: true });
}

// ── 백업 ────────────────────────────────────────────────────
export function exportData() {
  return {
    app: 'ExamTree',
    version: 1,
    exportedAt: new Date().toISOString(),
    folders: [...folders.values()],
    questions: [...questions.values()],
    settings: Object.entries(settings).map(([key, value]) => ({ key, value })),
  };
}

export async function importData(data) {
  const fs = (data.folders || []).map((f) => ({
    id: String(f.id),
    name: String(f.name == null ? '이름 없음' : f.name),
    parentFolderID: f.parentFolderID == null ? ROOT : String(f.parentFolderID),
    order: Number(f.order) || 0,
    expanded: f.expanded !== false,
    createdAt: Number(f.createdAt) || now(),
    updatedAt: Number(f.updatedAt) || now(),
  }));
  const qs = (data.questions || []).map((q) => normalizeQuestion({
    id: String(q.id),
    folderID: String(q.folderID == null ? '' : q.folderID),
    order: Number(q.order) || 0,
    questionText: String(q.questionText == null ? '' : q.questionText),
    answerCount: String(q.answerCount == null ? '' : q.answerCount),
    answerText: String(q.answerText == null ? '' : q.answerText),
    explanation: String(q.explanation == null ? '' : q.explanation),
    isReview: !!q.isReview,
    reviewMarkedAt: Number(q.reviewMarkedAt) || 0,
    createdAt: Number(q.createdAt) || now(),
    updatedAt: Number(q.updatedAt) || now(),
  }));
  const ss = Array.isArray(data.settings)
    ? data.settings.filter((s) => s && typeof s.key === 'string')
    : [];

  await db.replaceAll({ folders: fs, questions: qs, settings: ss });
  await load();
  emit({ folders: true, questions: true, settings: true });
}
