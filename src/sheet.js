// sheet.js — 우측 Spreadsheet.
// 챕터 화면과 ★ 통합 복습 화면을 같은 렌더러로 그린다.
// 통합 복습 화면도 원본 Question 레코드를 그대로 편집하므로 사본이 생기지 않는다 (PRD 74-1~4).

import * as store from './store.js';
import * as undo from './undo.js';
import * as ui from './ui.js';
import * as review from './review.js';
import * as tree from './tree.js';
import * as rt from './richtext.js';

const FIELDS = [
  { key: 'star', label: '★', cls: 'c-star' },
  { key: 'no', label: 'No', cls: 'c-no' },
  { key: 'src', label: '출처', cls: 'c-src', reviewOnly: true, resizable: true },
  { key: 'questionText', label: '문제', cls: 'c-q', editable: true, resizable: true },
  { key: 'answerCount', label: '답 개수', cls: 'c-n', editable: true, numeric: true, resizable: true },
  { key: 'answerText', label: '정답', cls: 'c-a', editable: true, hideable: true, resizable: true },
  // 통합 복습 화면은 PRD 71장의 구성(No·출처·문제·개수·정답)을 따른다.
  // 저장 키는 explanation 그대로 둔다 — 이미 저장된 데이터와 백업 파일 호환을 위해.
  { key: 'explanation', label: '정답 작성하기', cls: 'c-e', editable: true, resizable: true, folderOnly: true },
];

const CHUNK = 60; // 첫 렌더에서 즉시 그리는 행 수

let view = { kind: 'folder', folderID: null };
let callbacks = {};
let dom = {};
let renderToken = 0;
let pendingRows = null;      // 아직 그리지 않은 행 (점진 렌더용)
export const selection = new Set();
let lastSelectedID = null;
let lastActiveRowID = null;  // 마지막으로 손댄 행. 삭제·이동의 기본 대상이 된다.

// ── 초기화 ──────────────────────────────────────────────────
export function init(cbs) {
  callbacks = cbs || {};
  dom = {
    crumbs: document.getElementById('crumbs'),
    sub: document.getElementById('sheet-sub'),
    filters: document.getElementById('sheet-filters'),
    scroll: document.getElementById('sheet-scroll'),
    table: document.getElementById('sheet-table'),
    colgroup: document.getElementById('sheet-colgroup'),
    thead: document.getElementById('sheet-thead'),
    tbody: document.getElementById('sheet-tbody'),
    addRow: document.getElementById('add-row'),
  };

  dom.addRow.addEventListener('click', () => addQuestion());

  const doneBtn = document.getElementById('done-editing');
  if (doneBtn) doneBtn.addEventListener('click', () => finishEditing());

  // 표의 빈 곳을 누르면 편집을 끝낸다. 아이패드에서 키보드를 내리는 가장 자연스러운 방법.
  dom.scroll.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.cell, button, select, input, textarea, th')) return;
    if (activeCell()) finishEditing();
  });

  dom.tbody.addEventListener('focusin', onFocusIn);
  dom.tbody.addEventListener('focusout', onFocusOut);
  dom.tbody.addEventListener('input', onInput);
  dom.tbody.addEventListener('keydown', onCellKeyDown);
  dom.tbody.addEventListener('paste', (e) => {
    if (e.target.classList.contains('cell')) rt.handlePaste(e);
  });
  dom.scroll.addEventListener('scroll', () => renderMore(), { passive: true });
}

export function setView(next) {
  flushPendingEdit();
  view = next;
  selection.clear();
  lastSelectedID = null;
  render();
  dom.scroll.scrollTop = 0;
}

export function getView() { return view; }

// ── 목록 계산 ───────────────────────────────────────────────
export function currentList() {
  const base = view.kind === 'review'
    ? review.applyFilter(store.reviewQuestions())
    : store.questionsIn(view.folderID);
  return review.applyOrder(base);
}

function columns() {
  return view.kind === 'review'
    ? FIELDS.filter((f) => !f.folderOnly)
    : FIELDS.filter((f) => !f.reviewOnly);
}

function editableKeys() {
  return columns().filter((f) => f.editable).map((f) => f.key);
}

// ── 렌더 ────────────────────────────────────────────────────
export function render() {
  if (!dom.tbody) return;
  renderToken++;
  const token = renderToken;

  renderHeader();
  renderColgroup();
  renderThead();
  applyRowHeightMode();

  const list = currentList();
  dom.tbody.innerHTML = '';
  const first = list.slice(0, CHUNK);
  const frag = document.createDocumentFragment();
  first.forEach((q, i) => frag.appendChild(buildRow(q, i)));
  dom.tbody.appendChild(frag);
  pendingRows = { token, list, next: first.length };
  renderMore();

  dom.addRow.hidden = view.kind === 'review';
}

/** 남은 행을 조금씩 채운다. 행 높이가 가변이라 가상 스크롤 대신 점진 렌더를 쓴다. */
function renderMore() {
  if (!pendingRows || pendingRows.token !== renderToken) return;
  const { list } = pendingRows;
  if (pendingRows.next >= list.length) { pendingRows = null; return; }
  const end = Math.min(pendingRows.next + CHUNK, list.length);
  const frag = document.createDocumentFragment();
  for (let i = pendingRows.next; i < end; i++) frag.appendChild(buildRow(list[i], i));
  dom.tbody.appendChild(frag);
  pendingRows.next = end;
  if (pendingRows.next < list.length) {
    const schedule = window.requestIdleCallback || ((fn) => setTimeout(fn, 16));
    schedule(() => renderMore());
  } else {
    pendingRows = null;
  }
}

/** 모든 행이 DOM 에 있도록 보장한다 (스크롤 이동·검색 결과 이동 전에 호출). */
function renderAllRows() {
  while (pendingRows) renderMore();
}

function renderHeader() {
  dom.crumbs.innerHTML = '';
  dom.filters.innerHTML = '';

  if (view.kind === 'review') {
    const t = document.createElement('span');
    t.className = 'crumb current';
    t.innerHTML = '<span class="star-icon">★</span> 복습 문제';
    dom.crumbs.appendChild(t);
    dom.sub.textContent = `복습 문제 ${currentList().length}개`;
    renderReviewFilters();
    return;
  }

  const path = store.folderPath(view.folderID);
  path.forEach((f, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      dom.crumbs.appendChild(sep);
    }
    const b = document.createElement('button');
    b.className = 'crumb' + (i === path.length - 1 ? ' current' : '');
    b.textContent = f.name;
    b.addEventListener('click', () => callbacks.onOpenFolder && callbacks.onOpenFolder(f.id));
    dom.crumbs.appendChild(b);
  });
  if (!path.length) {
    const t = document.createElement('span');
    t.className = 'crumb current';
    t.textContent = '폴더를 선택하세요';
    dom.crumbs.appendChild(t);
  }
  dom.sub.textContent = `문제 ${store.directCountOf(view.folderID)}개`;
}

function renderReviewFilters() {
  const subjects = store.rootFolders();
  const sel = document.createElement('select');
  sel.className = 'filter-select';
  sel.setAttribute('aria-label', '과목 필터');
  const optAll = new Option('전체 과목', '');
  sel.appendChild(optAll);
  for (const s of subjects) sel.appendChild(new Option(s.name, s.id));
  sel.value = review.state.filter.subjectID || '';
  sel.addEventListener('change', () => {
    review.state.filter.subjectID = sel.value || null;
    review.clearRandom();
    render();
  });
  dom.filters.appendChild(sel);

  const sort = document.createElement('select');
  sort.className = 'filter-select';
  sort.setAttribute('aria-label', '정렬');
  sort.appendChild(new Option('기본 순서', 'default'));
  sort.appendChild(new Option('최근 표시순', 'recent'));
  sort.value = review.state.filter.sort;
  sort.addEventListener('change', () => {
    review.state.filter.sort = sort.value;
    review.clearRandom();
    render();
  });
  dom.filters.appendChild(sort);
}

function renderColgroup() {
  dom.colgroup.innerHTML = '';
  for (const c of columns()) {
    const col = document.createElement('col');
    col.style.width = widthOf(c.key) + 'px';
    dom.colgroup.appendChild(col);
  }
  // 폭을 지정하지 않은 여백 열. 남는 가로 공간을 이 열이 흡수하므로
  // 사용자가 지정한 컬럼 폭이 화면 크기에 따라 늘어나지 않는다.
  dom.colgroup.appendChild(document.createElement('col'));
  applyTableWidth();
}

// 행 높이 상한. 내용이 길어도 한 화면에 여러 문제가 보이게 한다.
// 편집 중인 행과 개별 지정한 행은 이 상한을 벗어난다.
const ROW_MODES = { compact: 2, normal: 5, full: 0 };
const LINE_PX = 25;   // 16px * 1.55 줄간격
const CELL_PAD = 18;  // .cell 위아래 패딩 합

export function rowMaxHeight() {
  const lines = ROW_MODES[store.getSetting('rowHeightMode')] ?? ROW_MODES.normal;
  return lines ? lines * LINE_PX + CELL_PAD : 0;
}

function applyRowHeightMode() {
  const max = rowMaxHeight();
  dom.table.style.setProperty('--row-max', max ? max + 'px' : 'none');
}

/** 표 폭 = 컬럼 폭의 합. 확정값이라야 table-layout:fixed 가 동작한다. */
function applyTableWidth(override) {
  const total = columns().reduce(
    (n, c) => n + (override && override.key === c.key ? override.width : widthOf(c.key)), 0,
  );
  dom.table.style.width = total + 'px';
}

function widthOf(key) {
  const w = store.settings.columnWidths || {};
  return w[key] || (key === 'star' ? 46 : key === 'no' ? 54 : 200);
}

function renderThead() {
  dom.thead.innerHTML = '';
  const tr = document.createElement('tr');
  for (const c of columns()) {
    const th = document.createElement('th');
    th.className = c.cls;
    th.textContent = c.label;
    if (c.resizable) {
      const handle = document.createElement('span');
      handle.className = 'col-resize';
      handle.addEventListener('pointerdown', (e) => startColResize(e, c.key));
      th.appendChild(handle);
    }
    tr.appendChild(th);
  }
  const pad = document.createElement('th');
  pad.className = 'c-pad';
  pad.setAttribute('aria-hidden', 'true');
  tr.appendChild(pad);
  dom.thead.appendChild(tr);
}

function startColResize(e, key) {
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startW = widthOf(key);
  const cols = columns();
  const idx = cols.findIndex((c) => c.key === key);
  const col = dom.colgroup.children[idx];
  let w = startW;
  const move = (ev) => {
    w = Math.max(56, Math.round(startW + (ev.clientX - startX)));
    if (col) col.style.width = w + 'px';
    applyTableWidth({ key, width: w });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    const widths = { ...(store.settings.columnWidths || {}) };
    widths[key] = w;
    store.setSetting('columnWidths', widths);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

// ── 행 ──────────────────────────────────────────────────────
function buildRow(q, index) {
  const tr = document.createElement('tr');
  tr.className = 'q-row';
  tr.dataset.id = q.id;
  tr.dataset.index = index;
  if (selection.has(q.id)) tr.classList.add('selected');
  // 이 행만 따로 높이를 지정했으면 전체 설정을 덮어쓴다.
  if (q.rowHeight) tr.style.setProperty('--row-max', q.rowHeight + 'px');

  for (const c of columns()) {
    const td = document.createElement('td');
    td.className = c.cls;

    if (c.key === 'star') {
      const b = document.createElement('button');
      b.className = 'star-btn' + (q.isReview ? ' on' : '');
      b.textContent = '★';
      b.setAttribute('aria-pressed', String(!!q.isReview));
      b.setAttribute('aria-label', q.isReview ? '복습 표시 해제' : '복습 문제로 지정');
      b.addEventListener('click', () => toggleStar(q.id));
      td.appendChild(b);
    } else if (c.key === 'no') {
      const grip = document.createElement('button');
      grip.className = 'row-grip grip';
      grip.textContent = String(index + 1);
      grip.setAttribute('aria-label', `${index + 1}번 문제 선택/이동`);
      grip.addEventListener('pointerdown', (e) => startRowDrag(e, q));
      td.appendChild(grip);

      // 행 아래 경계를 끌면 이 행만 높이를 바꾼다 (컬럼 폭 조절의 세로 버전).
      const rz = document.createElement('span');
      rz.className = 'row-resize';
      rz.setAttribute('aria-label', '행 높이 조절');
      rz.addEventListener('pointerdown', (e) => startRowResize(e, q, tr));
      td.appendChild(rz);
    } else if (c.key === 'src') {
      const b = document.createElement('button');
      b.className = 'src-link';
      // 폴더가 깊어 전체 경로를 넣으면 뒤가 잘려 정작 중요한 챕터 이름이 사라진다.
      // 그래서 챕터 이름만 보여주고 전체 경로는 툴팁으로 남긴다.
      const path = store.folderPath(q.folderID);
      b.textContent = path.length ? path[path.length - 1].name : '(위치 없음)';
      b.title = (store.folderPathText(q.folderID) || '') + ' — 원래 챕터로 이동';
      b.addEventListener('click', () => {
        callbacks.onOpenSource && callbacks.onOpenSource(q.folderID, q.id);
      });
      td.appendChild(b);
    } else if (c.key === 'answerText' && review.isHidden(q.id)) {
      const b = document.createElement('button');
      b.className = 'reveal-btn';
      b.textContent = '정답 보기';
      b.addEventListener('click', () => {
        review.reveal(q.id);
        replaceAnswerCell(q.id);
      });
      td.appendChild(b);
    } else {
      td.appendChild(buildCell(q, c));
    }
    tr.appendChild(td);
  }
  const pad = document.createElement('td');
  pad.className = 'c-pad';
  tr.appendChild(pad);
  return tr;
}

function buildCell(q, c) {
  const div = document.createElement('div');
  div.className = 'cell' + (c.numeric ? ' num' : '');
  div.contentEditable = 'true';
  div.spellcheck = false;
  div.dataset.field = c.key;
  div.dataset.id = q.id;
  if (c.numeric) div.inputMode = 'numeric';
  div.innerHTML = q[c.key] || '';
  return div;
}

/** 정답 공개/재숨김 시 해당 셀만 다시 만든다. */
function replaceAnswerCell(id) {
  const tr = dom.tbody.querySelector(`tr[data-id="${cssEscape(id)}"]`);
  const q = store.questions.get(id);
  if (!tr || !q) return;
  const cols = columns();
  const idx = cols.findIndex((c) => c.key === 'answerText');
  const td = tr.children[idx];
  if (!td) return;
  td.innerHTML = '';
  const c = cols[idx];
  if (review.isHidden(id)) {
    const b = document.createElement('button');
    b.className = 'reveal-btn';
    b.textContent = '정답 보기';
    b.addEventListener('click', () => { review.reveal(id); replaceAnswerCell(id); });
    td.appendChild(b);
  } else {
    td.appendChild(buildCell(q, c));
  }
}

export function refreshAnswerCells() {
  for (const tr of dom.tbody.querySelectorAll('tr[data-id]')) replaceAnswerCell(tr.dataset.id);
}

export function refreshCell(id, field) {
  const q = store.questions.get(id);
  const cell = dom.tbody.querySelector(`.cell[data-id="${cssEscape(id)}"][data-field="${field}"]`);
  if (q && cell) cell.innerHTML = q[field] || '';
}

function cssEscape(s) {
  return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
}

// ── 셀 편집 ─────────────────────────────────────────────────
let editing = null;   // { id, field, before, el }
let saveTimer = null;

function onFocusIn(e) {
  const cell = e.target.closest && e.target.closest('.cell');
  if (!cell) return;
  if (editing && editing.el !== cell) commitEdit();
  editing = { id: cell.dataset.id, field: cell.dataset.field, before: cell.innerHTML, el: cell };
  lastActiveRowID = cell.dataset.id; // 삭제·이동의 기본 대상
  cell.closest('tr').classList.add('editing');
  showDoneButton(true);
  cell.scrollIntoView({ block: 'nearest' });
}

function onFocusOut(e) {
  const cell = e.target.closest && e.target.closest('.cell');
  if (!cell) return;
  cell.closest('tr').classList.remove('editing');
  // 같은 셀 안에서의 포커스 이동이면 무시
  setTimeout(() => {
    if (editing && editing.el === cell && document.activeElement !== cell) commitEdit();
    if (!activeCell()) showDoneButton(false);
  }, 0);
}

function showDoneButton(show) {
  const b = document.getElementById('done-editing');
  if (b) b.hidden = !show;
}

/** 편집을 끝내고 키보드를 내린다. '완료' 버튼, 빈 곳 탭, 마지막 행 Enter 에서 쓴다. */
export function finishEditing() {
  const cell = activeCell();
  commitEdit();
  if (cell) cell.blur();
  showDoneButton(false);
}

function onInput() {
  if (!editing) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDraft, 400);
}

/** 타이핑 중 자동 저장. 커서를 건드리지 않기 위해 정화는 하지 않는다. */
function saveDraft() {
  if (!editing) return;
  const { id, field, el } = editing;
  store.updateQuestion(id, { [field]: el.innerHTML });
}

/** 셀 편집 확정: 정화 후 저장하고 실행취소 스택에 한 건으로 올린다. */
export function commitEdit() {
  if (!editing) return;
  clearTimeout(saveTimer);
  const { id, field, before, el } = editing;
  editing = null;

  let after = rt.sanitize(el.innerHTML);
  if (field === 'answerCount') after = rt.toPlain(after).replace(/[^0-9]/g, '');
  if (el.innerHTML !== after) el.innerHTML = after;
  if (after === before) return;

  store.updateQuestion(id, { [field]: after });
  undo.push({
    label: '내용 편집',
    redo() { store.updateQuestion(id, { [field]: after }); refreshCell(id, field); },
    undo() { store.updateQuestion(id, { [field]: before }); refreshCell(id, field); },
  });

  // 커서가 아직 이 셀에 있으면(Cmd+Z 등으로 중간 확정된 경우) 편집 추적을 다시 건다.
  if (document.activeElement === el) {
    editing = { id, field, before: el.innerHTML, el };
  }
}

export function flushPendingEdit() { commitEdit(); }

// ── 키보드 ──────────────────────────────────────────────────
function onCellKeyDown(e) {
  const cell = e.target.closest && e.target.closest('.cell');
  if (!cell) return;
  const meta = e.metaKey || e.ctrlKey;

  if (meta && e.key === 'Enter') {
    e.preventDefault();
    commitEdit();
    addQuestion(Number(cell.closest('tr').dataset.index) + 1);
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    commitEdit();
    moveFocus(cell, e.shiftKey ? -1 : 1, 'field');
    return;
  }
  if (e.key === 'Enter' && !meta) {
    e.preventDefault();
    if (cell.dataset.field === 'answerCount') {
      // 답 개수는 여러 줄일 이유가 없다 → 다음 칸으로 넘어간다
      commitEdit();
      moveFocus(cell, 1, 'field');
      return;
    }
    // 서술형 답을 여러 줄로 쓸 수 있어야 하므로 셀 안에서 줄만 바꾼다.
    // 아래 행으로 가려면 Tab 이나 방향키를 쓴다.
    rt.insertLineBreak();
    return;
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (editing && editing.el === cell) {
      cell.innerHTML = editing.before;
      editing = null;
    }
    cell.blur();
    return;
  }
  if (e.key === 'ArrowUp' && caretAtStart(cell)) {
    e.preventDefault(); commitEdit(); moveFocus(cell, -1, 'row'); return;
  }
  if (e.key === 'ArrowDown' && caretAtEnd(cell)) {
    e.preventDefault(); commitEdit(); moveFocus(cell, 1, 'row'); return;
  }
  if (cell.dataset.field === 'answerCount' && e.key.length === 1 && !meta && !/[0-9]/.test(e.key)) {
    e.preventDefault(); // 답 개수는 숫자만
  }
}

function caretAtStart(cell) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const r = sel.getRangeAt(0).cloneRange();
  r.selectNodeContents(cell);
  r.setEnd(sel.getRangeAt(0).startContainer, sel.getRangeAt(0).startOffset);
  return r.toString().length === 0;
}

function caretAtEnd(cell) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return false;
  const r = sel.getRangeAt(0).cloneRange();
  r.selectNodeContents(cell);
  r.setStart(sel.getRangeAt(0).endContainer, sel.getRangeAt(0).endOffset);
  return r.toString().length === 0;
}

function moveFocus(cell, delta, mode) {
  const keys = editableKeys();
  const row = cell.closest('tr');
  const rowIndex = Number(row.dataset.index);
  let fieldIndex = keys.indexOf(cell.dataset.field);
  let targetRow = rowIndex;

  if (mode === 'field') {
    fieldIndex += delta;
    if (fieldIndex >= keys.length) { fieldIndex = 0; targetRow = rowIndex + 1; }
    else if (fieldIndex < 0) { fieldIndex = keys.length - 1; targetRow = rowIndex - 1; }
  } else {
    targetRow = rowIndex + delta;
  }

  const total = currentList().length;
  if (targetRow >= total) {
    // 마지막 행에서 Enter 는 편집을 끝낸다. 예전처럼 새 행을 만들면
    // 아이패드에서 키보드가 계속 떠 있고 빈 행만 쌓인다.
    if (mode === 'row' || view.kind === 'review') { finishEditing(); return; }
    addQuestion();            // Tab 으로 마지막 칸을 넘어갈 때만 새 문제를 만든다
    return;
  }
  if (targetRow < 0) return;
  focusCell(targetRow, keys[fieldIndex]);
}

export function focusCell(rowIndex, field) {
  renderAllRows();
  const row = dom.tbody.querySelector(`tr[data-index="${rowIndex}"]`);
  if (!row) return;
  let cell = row.querySelector(`.cell[data-field="${field}"]`);
  if (!cell) cell = row.querySelector('.cell'); // 정답이 가려진 경우 등
  if (!cell) return;
  cell.focus();
  placeCaretEnd(cell);
  cell.scrollIntoView({ block: 'nearest' });
}

function placeCaretEnd(el) {
  const r = document.createRange();
  r.selectNodeContents(el);
  r.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(r);
}

export function activeCell() {
  const a = document.activeElement;
  return a && a.classList && a.classList.contains('cell') ? a : null;
}

// ── 문제 추가 / 삭제 / 이동 ─────────────────────────────────
export function addQuestion(index) {
  if (view.kind === 'review') {
    ui.toast('통합 복습 화면에서는 문제를 추가할 수 없습니다. 챕터를 열어 추가하세요.');
    return;
  }
  if (!view.folderID) { ui.toast('먼저 왼쪽에서 폴더를 선택하세요.'); return; }
  commitEdit();

  const folderID = view.folderID;
  const list = store.questionsIn(folderID);
  const at = index == null ? list.length : Math.min(index, list.length);
  const rec = store.blankQuestion(folderID, at);

  undo.run({
    label: '문제 추가',
    redo() {
      store.insertQuestions([rec]);
      const ids = store.questionsIn(folderID).filter((q) => q.id !== rec.id).map((q) => q.id);
      ids.splice(at, 0, rec.id);
      store.setQuestionOrder(folderID, ids);
    },
    undo() { store.deleteQuestions([rec.id]); },
  });

  review.clearRandom();
  render();
  const pos = currentList().findIndex((q) => q.id === rec.id);
  if (pos >= 0) focusCell(pos, 'questionText');
}

export function targetIDs() {
  if (selection.size) return [...selection];
  const cell = activeCell();
  if (cell) return [cell.dataset.id];
  // '완료'로 편집을 끝낸 뒤에도 방금 손댄 행을 지우거나 옮길 수 있어야 한다.
  // 어느 행이 대상인지 보이도록 선택 표시까지 해 준다.
  if (lastActiveRowID && store.questions.has(lastActiveRowID)
      && currentList().some((q) => q.id === lastActiveRowID)) {
    selection.add(lastActiveRowID);
    syncSelectionClasses();
    return [lastActiveRowID];
  }
  return [];
}

export async function deleteSelected() {
  const ids = targetIDs();
  if (!ids.length) { ui.toast('삭제할 문제를 선택하세요. (번호를 눌러 선택)'); return; }
  commitEdit();
  const ok = await ui.confirmDialog({
    title: `선택한 문제 ${ids.length}개를 삭제하시겠습니까?`,
    message: '실행취소로 되돌릴 수 있습니다.',
    okLabel: '삭제', danger: true,
  });
  if (!ok) return;
  let snapshot = null;
  undo.run({
    label: '문제 삭제',
    redo() { snapshot = store.deleteQuestions(ids); },
    undo() {
      store.restore(snapshot);
      const folderIDs = new Set(snapshot.questions.map((q) => q.folderID));
      store.batch(() => {
        for (const fid of folderIDs) {
          const list = store.questionsIn(fid).sort((a, b) => a.order - b.order);
          store.setQuestionOrder(fid, list.map((q) => q.id));
        }
      });
    },
  });
  selection.clear();
  render();
  ui.toast(`문제 ${ids.length}개를 삭제했습니다.`, { action: () => undo.undo() });
}

export async function moveSelected() {
  const ids = targetIDs();
  if (!ids.length) { ui.toast('이동할 문제를 선택하세요. (번호를 눌러 선택)'); return; }
  commitEdit();
  const target = await ui.pickFolder({ title: '이동할 챕터 선택' });
  if (!target) return;
  applyMove(ids, target);
}

function applyMove(ids, target) {
  let before = null;
  undo.run({
    label: '문제 이동',
    redo() { before = store.moveQuestions(ids, target); },
    undo() { store.restoreQuestionPositions(before); },
  });
  selection.clear();
  render();
  ui.toast(`문제 ${ids.length}개를 '${store.folderPathText(target)}'(으)로 옮겼습니다.`, {
    action: () => { undo.undo(); render(); },
  });
}

/**
 * '정답 작성하기' 칸을 한꺼번에 비운다. 직접 써 본 답만 지우고 문제·정답은 건드리지 않는다.
 * @param scope 'view' = 지금 보고 있는 목록, 'all' = 모든 챕터
 */
export async function clearExplanations(scope = 'view') {
  flushPendingEdit();
  const pool = scope === 'all' ? [...store.questions.values()] : currentList();
  const targets = pool.filter((q) => !rt.isEmptyHtml(q.explanation));

  if (!targets.length) {
    ui.toast('지울 작성 내용이 없습니다.');
    return;
  }

  const where = scope === 'all'
    ? '모든 챕터'
    : (view.kind === 'review' ? '★ 복습 문제 목록' : store.folderPathText(view.folderID) || '현재 목록');

  const ok = await ui.confirmDialog({
    title: "'정답 작성하기' 칸을 비울까요?",
    message: `${where}\n작성 내용이 있는 문제 ${targets.length}개가 비워집니다.\n`
      + '문제·답 개수·정답·★ 표시는 그대로 남습니다. 실행취소로 되돌릴 수 있습니다.',
    okLabel: '비우기', danger: true,
  });
  if (!ok) return;

  const before = targets.map((q) => ({ id: q.id, explanation: q.explanation }));
  undo.run({
    label: '정답 작성하기 비우기',
    redo() {
      store.batch(() => { for (const b of before) store.updateQuestion(b.id, { explanation: '' }); });
      render();
    },
    undo() {
      store.batch(() => { for (const b of before) store.updateQuestion(b.id, { explanation: b.explanation }); });
      render();
    },
  });
  ui.toast(`문제 ${before.length}개의 작성 내용을 비웠습니다.`, {
    action: () => { undo.undo(); render(); },
  });
}

function toggleStar(id) {
  const q = store.questions.get(id);
  if (!q) return;
  const next = !q.isReview;
  const before = { isReview: q.isReview, reviewMarkedAt: q.reviewMarkedAt };
  undo.run({
    label: next ? '복습 표시' : '복습 표시 해제',
    redo() { store.setReview(id, next); },
    undo() {
      store.setReview(id, before.isReview);
      const cur = store.questions.get(id);
      if (cur) cur.reviewMarkedAt = before.reviewMarkedAt;
    },
  });
  render();
}

// ── 선택 ────────────────────────────────────────────────────
function toggleSelect(id, extend) {
  if (extend && lastSelectedID) {
    const list = currentList();
    const a = list.findIndex((q) => q.id === lastSelectedID);
    const b = list.findIndex((q) => q.id === id);
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      for (let i = lo; i <= hi; i++) selection.add(list[i].id);
    }
  } else if (selection.has(id)) {
    selection.delete(id);
  } else {
    selection.add(id);
  }
  lastSelectedID = id;
  syncSelectionClasses();
  callbacks.onSelectionChange && callbacks.onSelectionChange(selection.size);
}

export function clearSelection() {
  selection.clear();
  syncSelectionClasses();
  callbacks.onSelectionChange && callbacks.onSelectionChange(0);
}

function syncSelectionClasses() {
  for (const tr of dom.tbody.querySelectorAll('tr[data-id]')) {
    tr.classList.toggle('selected', selection.has(tr.dataset.id));
  }
}

// ── 행 드래그 ───────────────────────────────────────────────
let rowHint = null;

function startRowDrag(e, q) {
  e.preventDefault();
  const dragIDs = selection.has(q.id) && selection.size > 1 ? [...selection] : [q.id];
  const label = dragIDs.length > 1
    ? `문제 ${dragIDs.length}개`
    : (rt.toPlain(q.questionText).slice(0, 20) || '빈 문제');

  ui.beginDrag(e, {
    label,
    onTap: (ev) => { lastActiveRowID = q.id; toggleSelect(q.id, ev.shiftKey); },
    onMove: (x, y) => {
      const overSidebar = isOverSidebar(x, y);
      if (overSidebar) { clearRowHint(); tree.highlightFolder(x, y); }
      else { tree.clearHighlight(); ui.autoScroll(dom.scroll, y); showRowHint(x, y, dragIDs); }
    },
    onEnd: (x, y, ok) => {
      const overSidebar = ok && isOverSidebar(x, y);
      const folderID = overSidebar ? tree.highlightFolder(x, y) : null;
      const hint = rowHint;
      clearRowHint();
      tree.clearHighlight();
      if (!ok) return;
      if (folderID) { applyMove(dragIDs, folderID); return; }
      if (hint) applyReorder(dragIDs, hint);
    },
  });
}

// ── 행 높이 조절 ────────────────────────────────────────────
function startRowResize(e, q, tr) {
  e.preventDefault();
  e.stopPropagation();
  const startY = e.clientY;
  const startH = tr.getBoundingClientRect().height;
  let h = startH;
  const MIN = 40;

  const move = (ev) => {
    h = Math.max(MIN, Math.round(startH + (ev.clientY - startY)));
    tr.style.setProperty('--row-max', h + 'px');
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    // 원래대로 되돌리고 싶으면 아주 크게 늘리면 된다 → 개별 지정 해제
    const reset = h >= 600;
    if (reset) tr.style.removeProperty('--row-max');
    store.updateQuestion(q.id, { rowHeight: reset ? 0 : h });
    ui.toast(reset ? '이 행의 높이 지정을 해제했습니다.' : `행 높이 ${h}px`, { duration: 1600 });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function isOverSidebar(x, y) {
  const el = document.elementFromPoint(x, y);
  return !!(el && el.closest && el.closest('#sidebar'));
}

function showRowHint(x, y, dragIDs) {
  clearRowHint();
  const node = document.elementFromPoint(x, y);
  const tr = node && node.closest ? node.closest('tr[data-id]') : null;
  if (!tr || dragIDs.includes(tr.dataset.id)) return;
  const r = tr.getBoundingClientRect();
  const after = y > r.top + r.height / 2;
  tr.classList.add(after ? 'drop-after' : 'drop-before');
  rowHint = { id: tr.dataset.id, after };
}

function clearRowHint() {
  if (!dom.tbody) return;
  for (const tr of dom.tbody.querySelectorAll('.drop-before,.drop-after')) {
    tr.classList.remove('drop-before', 'drop-after');
  }
  rowHint = null;
}

function applyReorder(dragIDs, hint) {
  if (view.kind === 'review') {
    ui.toast('통합 복습 화면에서는 순서를 바꿀 수 없습니다.');
    return;
  }
  if (review.isRandom()) {
    ui.toast('랜덤 순서에서는 순서를 바꿀 수 없습니다. 랜덤을 해제하세요.');
    return;
  }
  const folderID = view.folderID;
  const list = store.questionsIn(folderID).map((q) => q.id);
  const before = list.slice();
  const moving = dragIDs.filter((id) => list.includes(id));
  if (!moving.length) return;

  const rest = list.filter((id) => !moving.includes(id));
  let at = rest.indexOf(hint.id);
  if (at < 0) at = rest.length; else at = hint.after ? at + 1 : at;
  rest.splice(at, 0, ...moving);

  undo.run({
    label: '문제 순서 변경',
    redo() { store.setQuestionOrder(folderID, rest); },
    undo() { store.setQuestionOrder(folderID, before); },
  });
  render();
}

// ── 위치 이동 ───────────────────────────────────────────────
export function scrollToQuestion(id, { highlight = true } = {}) {
  renderAllRows();
  const tr = dom.tbody.querySelector(`tr[data-id="${cssEscape(id)}"]`);
  if (!tr) return false;
  tr.scrollIntoView({ block: 'center', behavior: 'smooth' });
  if (highlight) ui.flash(tr);
  return true;
}

/** 현재 화면에 보이는 문제 id 목록 (전체 답 보기 등에 쓴다). */
export function visibleIDs() { return currentList().map((q) => q.id); }
