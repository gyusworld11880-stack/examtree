// app.js — 부트스트랩, 화면 전환, 전역 단축키, 사이드바, 서비스 워커 등록.

import * as store from './store.js';
import * as undo from './undo.js';
import * as ui from './ui.js';
import * as tree from './tree.js';
import * as sheet from './sheet.js';
import * as review from './review.js';
import * as search from './search.js';
import * as toolbar from './toolbar.js';
import * as backup from './backup.js';
import * as rt from './richtext.js';

const NARROW = 900; // 이 폭 미만이면 사이드바를 서랍(Drawer)으로 쓴다

// 화면에 보여 줄 버전. sw.js 의 VERSION 과 항상 같이 올린다.
export const APP_VERSION = '1.5.0';

// ── 화면 전환 ───────────────────────────────────────────────
function openFolder(folderID, questionID) {
  if (!store.folders.has(folderID)) return;
  review.clearRandom();
  if (review.state.hideAnswers) review.hideAll(); // 새 챕터는 다시 전부 숨김에서 시작 (PRD 32)
  sheet.setView({ kind: 'folder', folderID });
  tree.setActive({ kind: 'folder', folderID });
  store.setSetting('lastFolderID', folderID);
  closeDrawer();
  toolbar.refresh();
  if (questionID) requestAnimationFrame(() => sheet.scrollToQuestion(questionID));
}

function openReview() {
  review.clearRandom();
  if (review.state.hideAnswers) review.hideAll();
  sheet.setView({ kind: 'review', folderID: null });
  tree.setActive({ kind: 'review' });
  closeDrawer();
  toolbar.refresh();
}

function onFolderRemoved() { gotoDefault(); }

/** 보고 있던 폴더가 사라졌을 때(삭제·복원·초기화) 갈 곳을 정한다. */
function gotoDefault() {
  const last = store.getSetting('lastFolderID');
  if (last && store.folders.has(last)) { openFolder(last); return; }
  const first = store.rootFolders()[0];
  if (first) openFolder(first.id);
  else sheet.setView({ kind: 'folder', folderID: null });
}

// ── 서식 ────────────────────────────────────────────────────
function withActiveCell(fn) {
  const cell = sheet.activeCell();
  if (!cell) { ui.toast('서식을 적용할 셀을 먼저 선택하세요.'); return; }
  fn(cell);
  cell.dispatchEvent(new Event('input', { bubbles: true }));
}

// ── 툴바 동작 ───────────────────────────────────────────────
const actions = {
  toggleSidebar,
  addQuestion: () => sheet.addQuestion(),
  deleteSelected: () => sheet.deleteSelected(),
  moveSelected: () => sheet.moveSelected(),

  toggleReviewMode() {
    sheet.flushPendingEdit();
    review.toggle();
    sheet.render();
    toolbar.refresh();
    ui.toast(review.state.hideAnswers ? '복습 모드: 정답을 모두 숨겼습니다.' : '복습 모드를 껐습니다.');
  },
  hideAll() {
    sheet.flushPendingEdit();
    review.hideAll();
    sheet.render();
    toolbar.refresh();
  },
  revealAll() {
    review.revealAll(sheet.visibleIDs());
    sheet.render();
    toolbar.refresh();
  },
  toggleRandom() {
    sheet.flushPendingEdit();
    if (review.isRandom()) review.clearRandom();
    else review.shuffle(sheet.currentList());
    sheet.render();
    toolbar.refresh();
  },

  bold: () => withActiveCell(() => rt.toggleBold()),
  fontSize: (px) => withActiveCell((cell) => rt.applyFontSize(cell, px)),
  color: (c) => withActiveCell((cell) => {
    if (c) rt.applyColor(c);
    else rt.clearColor(cell); // '기본 (자동)'
  }),

  setRowHeightMode(mode) {
    sheet.flushPendingEdit();
    store.setSetting('rowHeightMode', mode);
    sheet.render();
  },

  search: () => search.open(),
  checkUpdate: () => checkForUpdate(),
  version: () => APP_VERSION,
  undo: () => { sheet.flushPendingEdit(); undo.undo(); sheet.render(); toolbar.refresh(); },
  redo: () => { undo.redo(); sheet.render(); toolbar.refresh(); },
};

// ── 사이드바 ────────────────────────────────────────────────
function isNarrow() { return window.innerWidth < NARROW; }

function toggleSidebar() {
  if (isNarrow()) document.body.classList.toggle('drawer-open');
  else document.body.classList.toggle('sidebar-hidden');
}

function closeDrawer() {
  if (isNarrow()) document.body.classList.remove('drawer-open');
}

function bindSidebarResize() {
  const handle = document.getElementById('sidebar-resize');
  const sidebar = document.getElementById('sidebar');
  sidebar.style.width = (store.getSetting('sidebarWidth') || 280) + 'px';

  handle.addEventListener('pointerdown', (e) => {
    if (isNarrow()) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebar.offsetWidth;
    let w = startW;
    const move = (ev) => {
      w = Math.max(180, Math.min(520, startW + (ev.clientX - startX)));
      sidebar.style.width = w + 'px';
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      store.setSetting('sidebarWidth', w);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  document.getElementById('drawer-scrim').addEventListener('click', closeDrawer);
}

/**
 * iPad 소프트 키보드가 올라오면 화면 아래쪽이 가려진다.
 * 키보드 높이를 --kb 로 알려 주어 표 아래 여백과 '완료' 버튼 위치를 맞춘다.
 */
function bindViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => {
    const kb = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
    document.documentElement.style.setProperty('--kb', kb + 'px');
    const btn = document.getElementById('done-editing');
    if (btn) btn.style.bottom = (kb + 18) + 'px';
    const cell = sheet.activeCell();
    if (kb > 0 && cell) cell.scrollIntoView({ block: 'nearest' });
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();
}

// ── 전역 단축키 ─────────────────────────────────────────────
function bindKeys() {
  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    const inCell = !!sheet.activeCell();

    if (meta && key === 'z') {
      e.preventDefault();
      if (e.shiftKey) actions.redo(); else actions.undo();
      return;
    }
    if (meta && key === 'y') { e.preventDefault(); actions.redo(); return; }
    if (meta && key === 'f') { e.preventDefault(); search.open(); return; }
    if (meta && key === 'b') { e.preventDefault(); actions.bold(); return; }
    if (meta && e.key === 'Enter' && !inCell) { e.preventDefault(); sheet.addQuestion(); return; }
    if (e.key === 'Escape') {
      if (search.isOpen()) { search.close(); return; }
      if (inCell) { sheet.finishEditing(); return; }
      if (document.querySelector('.popup-menu')) { ui.closeMenus(); return; }
      if (!inCell) sheet.clearSelection();
    }
  });
}

// ── 서비스 워커 ─────────────────────────────────────────────
let swRegistration = null;

/** ⋯ 메뉴의 '업데이트 확인'. 새 버전이 있으면 받아서 새로고침을 권한다. */
async function checkForUpdate() {
  if (!swRegistration) {
    ui.toast(`업데이트를 확인할 수 없습니다. (현재 v${APP_VERSION})`);
    return;
  }
  ui.toast('업데이트 확인 중…', { duration: 2000 });
  try {
    await swRegistration.update();
    if (swRegistration.installing || swRegistration.waiting) {
      ui.toast('새 버전을 받았습니다.', {
        actionLabel: '새로고침', action: () => location.reload(), duration: 15000,
      });
    } else {
      ui.toast(`최신 버전입니다. (v${APP_VERSION})`);
    }
  } catch {
    ui.toast('업데이트를 확인하지 못했습니다. 인터넷 연결을 확인하세요.');
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return; // file:// 에서는 등록되지 않는다
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    swRegistration = reg;
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          ui.toast('새 버전이 있습니다.', {
            actionLabel: '새로고침',
            action: () => location.reload(),
            duration: 10000,
          });
        }
      });
    });
  }).catch((err) => console.warn('[ExamTree] 서비스 워커 등록 실패:', err));
}

// ── 시작 ────────────────────────────────────────────────────
async function main() {
  try {
    await store.load();
  } catch (err) {
    console.error(err);
    document.getElementById('boot-error').hidden = false;
    document.getElementById('boot-error').textContent =
      '데이터를 열지 못했습니다: ' + (err && err.message ? err.message : err);
    return;
  }

  tree.init(document.getElementById('tree'), {
    onSelectFolder: (id) => openFolder(id),
    onSelectReview: () => openReview(),
    onFolderRemoved,
  });

  sheet.init({
    onOpenFolder: (id) => openFolder(id),
    onOpenSource: (folderID, questionID) => openFolder(folderID, questionID),
    onSelectionChange: () => toolbar.refresh(),
  });

  search.init({
    onOpenFolder: (id) => openFolder(id),
    onGoToQuestion: (folderID, questionID) => openFolder(folderID, questionID),
  });

  toolbar.init(actions);
  bindSidebarResize();
  bindViewport();
  bindKeys();

  // 화면 갱신: 내용만 바뀐 저장(quiet)은 다시 그리지 않는다 — 커서가 튀기 때문.
  store.subscribe((scope) => {
    if (scope.quiet) return;
    const v = sheet.getView();
    // 백업 복원이나 폴더 구조 초기화로 보고 있던 폴더가 사라졌으면 갈 곳을 다시 잡는다.
    if (v.kind === 'folder' && v.folderID && !store.folders.has(v.folderID)) {
      gotoDefault();
      return;
    }
    if (scope.folders || scope.questions) tree.render();
    if (scope.folders || scope.questions) sheet.render();
    toolbar.refresh();
  });
  undo.onChange(() => toolbar.refresh());

  gotoDefault();

  // 편집 중 내용이 유실되지 않도록 앱이 가려질 때 즉시 저장한다.
  const flush = () => sheet.flushPendingEdit();
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

  window.addEventListener('examtree:saveerror', () => {
    ui.toast('저장에 실패했습니다. 저장 공간을 확인하고 백업을 권장합니다.', { duration: 6000 });
  });

  // iOS 는 오래 쓰지 않은 사이트의 저장소를 지울 수 있다. 가능하면 영구 저장으로 승격시킨다.
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((p) => { if (!p) navigator.storage.persist(); }).catch(() => {});
  }

  if (backup.backupOverdue()) {
    setTimeout(() => ui.toast('백업한 지 오래되었습니다. ⋯ 메뉴에서 백업하세요.', { duration: 5000 }), 1500);
  }

  registerServiceWorker();
  document.body.classList.add('ready');

  // 콘솔에서 상태를 들여다보거나 점검할 때 쓰는 손잡이.
  window.ExamTree = { store, sheet, tree, review, search, backup, undo, ui, actions, openFolder, openReview };
}

main();
