// tree.js — 좌측 Folder Tree.
// 최상단에 고정된 `★ 복습 문제` 항목이 있고 그 아래로 사용자의 폴더 계층이 온다.

import * as store from './store.js';
import * as undo from './undo.js';
import * as ui from './ui.js';

let el = null;          // 스크롤 컨테이너
let callbacks = {};     // { onSelectFolder, onSelectReview }
let active = { kind: 'folder', folderID: null };

export function init(container, cbs) {
  el = container;
  callbacks = cbs;
  render();
}

export function setActive(next) {
  active = next;
  markActive();
}

function markActive() {
  if (!el) return;
  for (const row of el.querySelectorAll('.tree-row')) {
    const isActive = active.kind === 'review'
      ? row.dataset.kind === 'review'
      : row.dataset.fid === active.folderID;
    row.classList.toggle('active', !!isActive);
  }
}

// ── 렌더 ────────────────────────────────────────────────────
export function render() {
  if (!el) return;
  const scroll = el.scrollTop;
  el.innerHTML = '';

  el.appendChild(reviewRow());

  const sep = document.createElement('div');
  sep.className = 'tree-sep';
  el.appendChild(sep);

  // 구조 전체를 한 번에 펼치거나 접는다. 폴더가 100개를 넘으면 손으로 하나씩 여는 게 고역이다.
  const bar = document.createElement('div');
  bar.className = 'tree-bar';
  for (const [label, value] of [['모두 펼치기', true], ['모두 접기', false]]) {
    const b = document.createElement('button');
    b.className = 'tree-bar-btn';
    b.textContent = label;
    b.addEventListener('click', () => store.setAllExpanded(value));
    bar.appendChild(b);
  }
  el.appendChild(bar);

  const list = document.createElement('div');
  list.className = 'tree-list';
  for (const f of store.rootFolders()) renderFolder(f, 0, list);
  el.appendChild(list);

  const add = document.createElement('button');
  add.className = 'tree-add';
  add.textContent = '+ 새 폴더';
  add.addEventListener('click', () => newFolder(store.ROOT));
  el.appendChild(add);

  el.scrollTop = scroll;
  markActive();
}

function reviewRow() {
  const row = document.createElement('div');
  row.className = 'tree-row review-row';
  row.dataset.kind = 'review';

  const name = document.createElement('button');
  name.className = 'tree-name';
  name.innerHTML = '<span class="star-icon">★</span> 복습 문제';
  name.addEventListener('click', () => callbacks.onSelectReview && callbacks.onSelectReview());
  row.appendChild(name);

  const count = document.createElement('span');
  count.className = 'tree-count';
  const n = store.reviewCount();
  count.textContent = n ? n : '';
  row.appendChild(count);
  return row;
}

function renderFolder(folder, depth, host) {
  const children = store.childFolders(folder.id);
  const row = document.createElement('div');
  row.className = 'tree-row';
  row.dataset.fid = folder.id;
  row.style.setProperty('--depth', depth);

  const twisty = document.createElement('button');
  twisty.className = 'twisty';
  if (children.length) {
    twisty.textContent = folder.expanded ? '▾' : '▸';
    twisty.setAttribute('aria-label', folder.expanded ? '접기' : '펼치기');
    twisty.addEventListener('click', (e) => {
      e.stopPropagation();
      store.updateFolder(folder.id, { expanded: !folder.expanded });
    });
  } else {
    twisty.className += ' empty';
    twisty.tabIndex = -1;
    twisty.setAttribute('aria-hidden', 'true');
  }
  row.appendChild(twisty);

  const name = document.createElement('button');
  name.className = 'tree-name';
  name.textContent = folder.name;
  name.title = folder.name; // 폴더가 깊어지면 이름이 잘리므로 전체 이름을 남긴다
  name.addEventListener('click', () => callbacks.onSelectFolder && callbacks.onSelectFolder(folder.id));
  name.addEventListener('dblclick', () => renameFolder(folder.id));
  row.appendChild(name);

  const count = document.createElement('span');
  count.className = 'tree-count';
  // 빈 폴더가 많은 구조에서 0 이 줄줄이 보이면 시선만 어지럽다.
  const n = store.countOf(folder.id);
  count.textContent = n ? n : '';
  row.appendChild(count);

  const more = document.createElement('button');
  more.className = 'tree-more';
  more.textContent = '⋯';
  more.setAttribute('aria-label', folder.name + ' 메뉴');
  more.addEventListener('click', (e) => { e.stopPropagation(); folderMenu(more, folder.id); });
  row.appendChild(more);

  const grip = document.createElement('span');
  grip.className = 'grip';
  grip.setAttribute('aria-hidden', 'true');
  grip.textContent = '⠿';
  grip.addEventListener('pointerdown', (e) => startFolderDrag(e, folder));
  row.appendChild(grip);

  host.appendChild(row);

  if (folder.expanded) {
    for (const c of children) renderFolder(c, depth + 1, host);
  }
}

// ── 폴더 조작 ───────────────────────────────────────────────
async function newFolder(parentID) {
  const name = await ui.promptDialog({ title: '새 폴더', placeholder: '폴더 이름' });
  if (!name) return;
  let snapshot = null;
  const rec = {
    id: store.uid(), name, parentFolderID: parentID,
    order: store.childFolders(parentID).length,
    expanded: true, createdAt: Date.now(), updatedAt: Date.now(),
  };
  undo.run({
    label: '폴더 추가',
    redo() {
      if (snapshot) store.restore(snapshot);
      else store.addFolderRecord(rec);
      const parent = store.folders.get(parentID);
      if (parent && !parent.expanded) store.updateFolder(parentID, { expanded: true });
    },
    undo() { snapshot = store.deleteFolderDeep(rec.id); },
  });
  callbacks.onSelectFolder && callbacks.onSelectFolder(rec.id);
}

async function renameFolder(id) {
  const f = store.folders.get(id);
  if (!f) return;
  const name = await ui.promptDialog({ title: '이름 변경', value: f.name });
  if (!name || name === f.name) return;
  const before = f.name;
  undo.run({
    label: '이름 변경',
    redo() { store.updateFolder(id, { name }); },
    undo() { store.updateFolder(id, { name: before }); },
  });
}

async function deleteFolder(id) {
  const f = store.folders.get(id);
  if (!f) return;
  const deep = store.countOf(id);
  const subCount = countSubfolders(id);
  const detail = [
    subCount ? `하위 폴더 ${subCount}개` : null,
    deep ? `문제 ${deep}개` : null,
  ].filter(Boolean).join(', ');
  const ok = await ui.confirmDialog({
    title: `'${f.name}' 폴더를 삭제할까요?`,
    message: detail ? `${detail}가 함께 삭제됩니다. 실행취소로 되돌릴 수 있습니다.` : '실행취소로 되돌릴 수 있습니다.',
    okLabel: '삭제', danger: true,
  });
  if (!ok) return;
  let snapshot = null;
  undo.run({
    label: '폴더 삭제',
    redo() { snapshot = store.deleteFolderDeep(id); },
    undo() { store.restore(snapshot); },
  });
  ui.toast('폴더를 삭제했습니다.', { action: () => undo.undo() });
  if (active.folderID === id) callbacks.onFolderRemoved && callbacks.onFolderRemoved(id);
}

function countSubfolders(id) {
  let n = 0;
  const walk = (fid) => { for (const c of store.childFolders(fid)) { n++; walk(c.id); } };
  walk(id);
  return n;
}

async function moveFolderTo(id) {
  const target = await ui.pickFolder({
    title: '이동할 위치 선택', excludeSubtreeOf: id, allowRoot: true,
  });
  if (target == null) return;
  const before = store.snapshotFolderPosition(id);
  undo.run({
    label: '폴더 이동',
    redo() { store.moveFolder(id, target, null); },
    undo() { store.restoreFolderPosition(before); },
  });
}

function folderMenu(anchor, id) {
  ui.popupMenu(anchor, [
    { label: '새 하위 폴더', onClick: () => newFolder(id) },
    { label: '이름 변경', onClick: () => renameFolder(id) },
    { label: '위치 이동…', onClick: () => moveFolderTo(id) },
    '-',
    { label: '삭제', danger: true, onClick: () => deleteFolder(id) },
  ]);
}

// ── 드래그로 순서/위치 변경 ─────────────────────────────────
function startFolderDrag(e, folder) {
  e.preventDefault();
  ui.beginDrag(e, {
    label: folder.name,
    onMove: (x, y) => { ui.autoScroll(el, y); showDropHint(x, y, folder.id); },
    onEnd: (x, y, ok) => {
      const hint = currentHint;
      clearDropHint();
      if (!ok || !hint) return;
      applyFolderDrop(folder.id, hint);
    },
  });
}

let currentHint = null;

/** 좌표 아래의 폴더 행과 드롭 위치(before/into/after)를 계산한다. */
export function hitTest(x, y, movingFolderID) {
  const node = document.elementFromPoint(x, y);
  const row = node && node.closest ? node.closest('.tree-row[data-fid]') : null;
  if (!row) {
    // 폴더 목록 여백에 놓으면 최상위 맨 뒤로
    const inside = el && el.contains(node);
    return inside ? { fid: null, where: 'root' } : null;
  }
  const fid = row.dataset.fid;
  if (movingFolderID && store.isDescendant(fid, movingFolderID)) return null;
  const r = row.getBoundingClientRect();
  const ratio = (y - r.top) / r.height;
  const where = ratio < 0.28 ? 'before' : ratio > 0.72 ? 'after' : 'into';
  return { fid, where, row };
}

function showDropHint(x, y, movingFolderID) {
  clearDropHint();
  const hit = hitTest(x, y, movingFolderID);
  currentHint = hit;
  if (!hit || !hit.row) return;
  hit.row.classList.add('drop-' + hit.where);
}

function clearDropHint() {
  if (!el) return;
  for (const r of el.querySelectorAll('.drop-before,.drop-after,.drop-into')) {
    r.classList.remove('drop-before', 'drop-after', 'drop-into');
  }
  currentHint = null;
}

/** 문제 행을 트리 위로 끌 때 폴더를 강조한다. */
export function highlightFolder(x, y) {
  clearDropHint();
  const node = document.elementFromPoint(x, y);
  const row = node && node.closest ? node.closest('.tree-row[data-fid]') : null;
  if (row) { row.classList.add('drop-into'); currentHint = { fid: row.dataset.fid, where: 'into', row }; }
  return row ? row.dataset.fid : null;
}

export function clearHighlight() { clearDropHint(); }

function applyFolderDrop(movingID, hit) {
  const before = store.snapshotFolderPosition(movingID);
  let parentID, index;

  if (hit.where === 'root') {
    parentID = store.ROOT;
    index = null;
  } else if (hit.where === 'into') {
    if (hit.fid === movingID) return;
    parentID = hit.fid;
    index = null;
  } else {
    const target = store.folders.get(hit.fid);
    if (!target) return;
    parentID = target.parentFolderID;
    const siblings = store.childFolders(parentID).filter((s) => s.id !== movingID);
    const at = siblings.findIndex((s) => s.id === hit.fid);
    index = hit.where === 'before' ? at : at + 1;
  }
  if (parentID !== store.ROOT && store.isDescendant(parentID, movingID)) return;

  undo.run({
    label: '폴더 이동',
    redo() { store.moveFolder(movingID, parentID, index); },
    undo() { store.restoreFolderPosition(before); },
  });
}

export { newFolder, renameFolder, deleteFolder };
