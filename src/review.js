// review.js — 복습 모드 상태(정답 가리기)와 표시 순서/필터.
//
// 핵심 규칙(PRD 74장):
//  * 복습 모드에 들어가면 모든 정답은 숨김 상태로 시작한다.
//  * 정답을 가려도 답 개수는 항상 보인다. (숨기는 대상은 정답 셀뿐)
//  * 랜덤은 화면 표시 순서만 바꾸며 order 필드는 건드리지 않는다.

import * as store from './store.js';

export const state = {
  hideAnswers: false,     // 복습 모드 on/off
  revealed: new Set(),    // 개별 공개된 문제 id
  randomOrder: null,      // 섞인 id 배열 (표시 전용) 또는 null
  filter: { subjectID: null, sort: 'default' }, // ★ 통합 복습 화면 전용
};

export function enter() {
  state.hideAnswers = true;
  state.revealed.clear();
}

export function exit() {
  state.hideAnswers = false;
  state.revealed.clear();
}

export function toggle() {
  if (state.hideAnswers) exit(); else enter();
  return state.hideAnswers;
}

export function isHidden(id) {
  return state.hideAnswers && !state.revealed.has(id);
}

export function reveal(id) { state.revealed.add(id); }

export function hideAll() {
  state.hideAnswers = true;
  state.revealed.clear();
}

export function revealAll(ids) {
  state.hideAnswers = true;
  for (const id of ids) state.revealed.add(id);
}

// ── 표시 순서 ───────────────────────────────────────────────
export function shuffle(list) {
  const ids = list.map((q) => q.id);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  state.randomOrder = ids;
}

export function clearRandom() { state.randomOrder = null; }

export function isRandom() { return state.randomOrder != null; }

/** 저장된 랜덤 순서를 화면 목록에만 적용한다. */
export function applyOrder(list) {
  if (!state.randomOrder) return list;
  const rank = new Map(state.randomOrder.map((id, i) => [id, i]));
  const known = [];
  const fresh = []; // 섞은 뒤 새로 추가된 문제는 뒤에 붙인다
  for (const q of list) (rank.has(q.id) ? known : fresh).push(q);
  known.sort((a, b) => rank.get(a.id) - rank.get(b.id));
  return known.concat(fresh);
}

// ── ★ 통합 복습 필터 ────────────────────────────────────────
/** 문제가 속한 최상위 폴더(=과목) id */
export function subjectOf(question) {
  const path = store.folderPath(question.folderID);
  return path.length ? path[0].id : '';
}

export function applyFilter(list) {
  let out = list;
  if (state.filter.subjectID) {
    out = out.filter((q) => subjectOf(q) === state.filter.subjectID);
  }
  if (state.filter.sort === 'recent') {
    out = out.slice().sort((a, b) => (b.reviewMarkedAt || 0) - (a.reviewMarkedAt || 0));
  }
  return out;
}

export function resetFilter() {
  state.filter.subjectID = null;
  state.filter.sort = 'default';
}
