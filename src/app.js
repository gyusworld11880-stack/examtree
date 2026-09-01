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
import * as sync from './sync.js';

const NARROW = 900; // 이 폭 미만이면 사이드바를 서랍(Drawer)으로 쓴다

// 화면에 보여 줄 버전. sw.js 의 VERSION 과 항상 같이 올린다.
export const APP_VERSION = '2.2.0';

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
    ui.toast(review.state.hideAnswers
      ? '정답을 모두 가렸습니다. 답 개수는 그대로 보입니다.'
      : '정답 가리기를 껐습니다.');
  },
  hideAll() {
    sheet.flushPendingEdit();
    review.hideAll();
    sheet.render();
    toolbar.refresh();
    ui.toast('열어 본 정답을 모두 다시 가렸습니다.');
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

  syncSetup: () => syncSetupDialog(),
  syncPush: () => syncPush(),
  syncPull: () => syncPull({ confirm: true }),

  search: () => search.open(),
  checkUpdate: () => checkForUpdate(),
  version: () => APP_VERSION,
  undo: () => { sheet.flushPendingEdit(); undo.undo(); sheet.render(); toolbar.refresh(); },
  redo: () => { undo.redo(); sheet.render(); toolbar.refresh(); },
};

// ── 기기 간 동기화 ──────────────────────────────────────────
// 폴더·문제만 주고받는다. 컬럼 폭 같은 화면 설정은 기기마다 달라야 하므로 제외한다.

function applyDeviceRole() {
  sheet.setReadOnly(sync.isViewer());
  toolbar.refresh();
}

/**
 * 별 표시를 양쪽에서 합친다. 켜고 끈 시각(reviewChangedAt)이 더 최근인 쪽이 이긴다.
 * 아이폰에서 복습하다 누른 ★ 가 아이패드에도 가야 하고, 그 반대도 되어야 한다.
 * @param remoteQuestions 클라우드에서 온 문제 배열 (제자리에서 수정된다)
 * @returns 로컬이 이긴 항목이 있으면 true — 그때는 클라우드에도 반영해야 한다
 */
function mergeStars(remoteQuestions) {
  let localWon = false;
  for (const rq of remoteQuestions || []) {
    const lq = store.questions.get(rq.id);
    if (!lq) continue;
    const localAt = Number(lq.reviewChangedAt) || 0;
    const remoteAt = Number(rq.reviewChangedAt) || 0;
    if (localAt > remoteAt) {
      rq.isReview = lq.isReview;
      rq.reviewMarkedAt = lq.reviewMarkedAt;
      rq.reviewChangedAt = localAt;
      localWon = true;
    }
  }
  return localWon;
}

/** 별 표시를 눌렀을 때 클라우드에 조용히 반영한다. 연달아 눌러도 한 번만 보낸다. */
let starSyncTimer = null;
function scheduleStarSync() {
  if (!sync.isConfigured()) return;
  clearTimeout(starSyncTimer);
  starSyncTimer = setTimeout(async () => {
    try {
      const remote = await sync.pull();
      if (!remote) return;                 // 아직 아무것도 안 올라감
      mergeStars(remote.questions);        // 내 최신 별 표시를 얹는다
      await sync.push(remote);
    } catch (err) {
      // 오프라인이면 다음에 앱을 열 때 자동 내려받기가 처리한다.
      console.warn('[ExamTree] 별 표시 동기화 미룸:', err.message);
    }
  }, 2500);
}

async function syncSetupDialog() {
  const cur = sync.getConfig();
  const values = await ui.formDialog({
    title: '기기 간 동기화 설정',
    message: 'GitHub 비공개 저장소를 통해 아이패드와 아이폰이 같은 내용을 봅니다.',
    fields: [
      {
        key: 'repo', label: '데이터 저장소', value: cur.repo,
        placeholder: '아이디/examtree-data',
        hint: '데이터만 담는 별도의 Private 저장소입니다. 앱 저장소와 다릅니다.',
      },
      {
        key: 'token', label: '액세스 토큰', type: 'password', value: cur.token,
        placeholder: 'github_pat_...',
        hint: 'Fine-grained token · 그 저장소의 Contents 를 Read and write 로.',
      },
      {
        key: 'role', label: '이 기기의 역할', type: 'select', value: cur.role,
        options: [
          { value: 'main', label: '주 기기 — 입력·수정하고 올린다 (아이패드)' },
          { value: 'viewer', label: '보기 전용 — 자동으로 내려받아 복습만 (아이폰)' },
        ],
        hint: '보기 전용에서는 편집이 잠깁니다. 내려받기가 덮어쓰기 때문입니다.',
      },
    ],
  });
  if (!values) return;

  sync.setConfig(values);
  applyDeviceRole();

  if (!sync.isConfigured()) {
    ui.toast('동기화 설정을 지웠습니다.');
    return;
  }
  ui.toast('연결을 확인하는 중…', { duration: 2000 });
  try {
    const info = await sync.test();
    ui.toast(info.private
      ? `연결됐습니다: ${info.full} (비공개)`
      : `연결됐습니다: ${info.full} — 공개 저장소입니다. 비공개를 권합니다.`,
    { duration: 6000 });
  } catch (err) {
    ui.toast(err.message, { duration: 8000 });
  }
}

async function syncPush() {
  if (!sync.isConfigured()) { syncSetupDialog(); return; }
  if (sync.isViewer()) { ui.toast('보기 전용 기기에서는 올릴 수 없습니다.'); return; }
  sheet.flushPendingEdit();

  const ok = await ui.confirmDialog({
    title: '이 기기 내용을 클라우드에 올릴까요?',
    message: `폴더 ${store.folders.size}개 · 문제 ${store.questions.size}개를 올립니다.\n`
      + '클라우드에 있던 내용은 이것으로 교체됩니다.',
    okLabel: '올리기',
  });
  if (!ok) return;

  ui.toast('올리는 중…', { duration: 2000 });
  try {
    const data = store.exportData();
    const payload = { folders: data.folders, questions: data.questions, exportedAt: data.exportedAt };
    // 아이폰에서 최근에 누른 ★ 를 덮어쓰지 않도록, 올리기 전에 클라우드 쪽 별 표시를 확인한다.
    try {
      const remote = await sync.pull();
      if (remote) {
        const remoteStars = new Map((remote.questions || []).map((q) => [q.id, q]));
        for (const q of payload.questions) {
          const r = remoteStars.get(q.id);
          if (r && (Number(r.reviewChangedAt) || 0) > (Number(q.reviewChangedAt) || 0)) {
            q.isReview = r.isReview;
            q.reviewMarkedAt = r.reviewMarkedAt;
            q.reviewChangedAt = r.reviewChangedAt;
          }
        }
      }
    } catch { /* 확인에 실패해도 올리기는 진행한다 */ }
    await sync.push(payload);
    ui.toast(`올렸습니다. 문제 ${store.questions.size}개`);
  } catch (err) {
    ui.toast(err.message, { duration: 8000 });
  }
  toolbar.refresh();
}

/** @param opts.confirm 사용자가 직접 눌렀으면 true (자동 내려받기는 조용히 진행) */
async function syncPull({ confirm = false } = {}) {
  if (!sync.isConfigured()) { if (confirm) syncSetupDialog(); return; }
  sheet.flushPendingEdit();

  if (confirm) {
    const ok = await ui.confirmDialog({
      title: '클라우드 내용을 내려받을까요?',
      message: '이 기기의 폴더와 문제가 클라우드 내용으로 교체됩니다.\n'
        + '화면 설정(컬럼 폭 등)은 그대로 유지됩니다.',
      okLabel: '내려받기', danger: true,
    });
    if (!ok) return;
    ui.toast('내려받는 중…', { duration: 2000 });
  }

  try {
    const data = await sync.pull();
    if (!data) {
      if (confirm) ui.toast('클라우드에 아직 올라간 내용이 없습니다. 아이패드에서 먼저 올려 주세요.', { duration: 6000 });
      return;
    }
    // '정답 작성하기'는 직접 답을 써 보는 연습 칸이라 기기마다 따로 둔다.
    // 내려받기가 이걸 덮으면 아이폰에서 쓴 답이 앱을 열 때마다 사라진다.
    const localWriting = new Map();
    for (const q of store.questions.values()) {
      if (q.explanation) localWriting.set(q.id, q.explanation);
    }
    for (const q of data.questions || []) {
      if (localWriting.has(q.id)) q.explanation = localWriting.get(q.id);
    }

    // 이 기기에서 최근에 누른 ★ 가 내려받기로 지워지지 않게 합친다.
    const starsToPushBack = mergeStars(data.questions);

    // 화면 설정도 기기마다 달라야 하므로 유지한다.
    await store.importData(data, { replaceSettings: false });
    undo.clear();
    gotoDefault();
    ui.toast(`내려받았습니다. 문제 ${store.questions.size}개`);

    // 아직 클라우드에 못 올린 ★ 가 있었다면 지금 올려 둔다 (오프라인이었던 경우).
    if (starsToPushBack) {
      sync.push(data).catch((e) => console.warn('[ExamTree] 별 표시 되올리기 실패:', e.message));
    }
  } catch (err) {
    // 자동 내려받기 실패는 조용히 넘어간다. 기기에 있던 내용으로 계속 쓰면 된다.
    if (confirm) ui.toast(err.message, { duration: 8000 });
    else console.warn('[ExamTree] 자동 내려받기 실패:', err.message);
  }
  toolbar.refresh();
}

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
  let lastKb = -1;
  const apply = () => {
    // 한글을 조합하는 중에는 아무것도 건드리지 않는다.
    // 레이아웃이 바뀌거나 스크롤이 움직이면 iOS 입력기가 조합을 잘못 확정해
    // '가나다라마바사' 가 '가나다라마바사사' 가 된다.
    if (sheet.isComposing()) return;

    const kb = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
    // 값이 실제로 달라졌을 때만 손댄다. 키보드 후보창 때문에 이벤트가 잦게 온다.
    if (kb === lastKb) return;
    lastKb = kb;

    document.documentElement.style.setProperty('--kb', kb + 'px');
    const btn = document.getElementById('done-editing');
    if (btn) btn.style.bottom = (kb + 18) + 'px';

    // 편집 중인 셀이 실제로 키보드에 가려졌을 때만 끌어올린다.
    const cell = sheet.activeCell();
    if (kb > 0 && cell) {
      const r = cell.getBoundingClientRect();
      if (r.bottom > vv.height) cell.scrollIntoView({ block: 'nearest' });
    }
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  apply();

  // 폰을 돌리면 카드 ↔ 표가 바뀌고 ★ 통합 복습의 열 구성도 달라진다.
  // 경계를 넘을 때만 다시 그린다.
  let wasNarrow = sheet.isNarrowScreen();
  window.addEventListener('resize', () => {
    const now = sheet.isNarrowScreen();
    if (now === wasNarrow) return;
    wasNarrow = now;
    sheet.flushPendingEdit();
    sheet.render();
  });
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
    onStarChanged: () => scheduleStarSync(),
  });

  search.init({
    onOpenFolder: (id) => openFolder(id),
    onGoToQuestion: (folderID, questionID) => openFolder(folderID, questionID),
  });

  toolbar.init(actions);
  applyDeviceRole();
  bindSidebarResize();
  bindViewport();
  bindKeys();

  // 화면 갱신: 내용만 바뀐 저장(quiet)은 다시 그리지 않는다 — 커서가 튀기 때문.
  store.subscribe((scope) => {
    if (scope.quiet) return;

    // 폴더 목록은 항상 먼저 다시 그린다.
    // (보던 폴더가 사라진 경우에도 트리에서 지워져야 하므로 아래보다 앞에 둔다)
    if (scope.folders || scope.questions) tree.render();

    const v = sheet.getView();
    // 폴더 삭제·백업 복원·구조 초기화로 보고 있던 폴더가 사라졌으면 갈 곳을 다시 잡는다.
    if (v.kind === 'folder' && v.folderID && !store.folders.has(v.folderID)) {
      gotoDefault(); // 이 안에서 시트가 다시 그려진다
      toolbar.refresh();
      return;
    }

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

  // 보기 전용 기기(아이폰)는 열 때마다 알아서 최신 내용을 받아 온다.
  // 오프라인이면 조용히 실패하고 기기에 있던 내용으로 정상 동작한다.
  if (sync.isViewer() && sync.isConfigured()) syncPull();

  registerServiceWorker();
  document.body.classList.add('ready');

  // 콘솔에서 상태를 들여다보거나 점검할 때 쓰는 손잡이.
  window.ExamTree = { store, sheet, tree, review, search, backup, undo, ui, actions, openFolder, openReview };
}

main();
