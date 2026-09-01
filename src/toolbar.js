// toolbar.js — 상단 툴바. 버튼을 만들고 현재 상태를 반영한다.

import * as ui from './ui.js';
import * as undo from './undo.js';
import * as store from './store.js';
import * as review from './review.js';
import * as rt from './richtext.js';
import * as sheet from './sheet.js';
import * as backup from './backup.js';
import * as sync from './sync.js';

let actions = {};
let buttons = {};

export function init(a) {
  actions = a;
  const bar = document.getElementById('toolbar-actions');
  bar.innerHTML = '';

  buttons.sidebar = add(bar, { id: 'sidebar', label: '☰', title: '폴더 목록 표시/숨기기', onClick: () => actions.toggleSidebar() });
  group(bar);

  buttons.add = add(bar, { label: '+ 문제', title: '문제 추가 (Cmd+Enter)', onClick: () => actions.addQuestion() });
  buttons.del = add(bar, { label: '삭제', title: '선택한 문제 삭제', onClick: () => actions.deleteSelected() });
  buttons.move = add(bar, { label: '이동', title: '선택한 문제를 다른 챕터로 이동', onClick: () => actions.moveSelected() });
  group(bar);

  buttons.review = add(bar, {
    label: '정답 가리기',
    title: '정답 가리기 켜기 / 끄기 (끄면 전부 다시 보입니다)',
    onClick: () => actions.toggleReviewMode(),
  });
  // 가리는 중일 때만 나타난다. 열어 본 정답을 다시 덮어 처음부터 돌기 위한 버튼.
  buttons.rehide = add(bar, {
    label: '다시 가리기',
    title: '열어 본 정답을 모두 다시 덮기',
    onClick: () => actions.hideAll(),
  });
  buttons.random = add(bar, { label: '랜덤', title: '표시 순서만 섞기', onClick: () => actions.toggleRandom() });
  buttons.clearWritten = add(bar, {
    label: '작성 비우기',
    title: "이 챕터의 '정답 작성하기' 칸 비우기",
    onClick: () => sheet.clearExplanations('view'),
  });
  group(bar);

  buttons.rowHeight = add(bar, { label: '↕', title: '행 높이', onClick: (e) => rowHeightMenu(e.currentTarget) });
  buttons.size = add(bar, { label: 'Aa', title: '글자 크기', onClick: (e) => sizeMenu(e.currentTarget) });
  buttons.bold = add(bar, { label: 'B', title: '굵게 (Cmd+B)', cls: 'bold-btn', onClick: () => actions.bold() });
  buttons.color = add(bar, { label: '●', title: '글자 색', cls: 'color-btn', onClick: (e) => colorMenu(e.currentTarget) });
  group(bar);

  buttons.search = add(bar, { label: '검색', title: '전체 검색 (Cmd+F)', onClick: () => actions.search() });
  buttons.undo = add(bar, { label: '↶', title: '실행취소 (Cmd+Z)', onClick: () => actions.undo() });
  buttons.redo = add(bar, { label: '↷', title: '다시실행 (Shift+Cmd+Z)', onClick: () => actions.redo() });
  buttons.more = add(bar, { label: '⋯', title: '더보기', onClick: (e) => moreMenu(e.currentTarget) });

  refresh();
}

function add(bar, { label, title, onClick, cls, id }) {
  const b = document.createElement('button');
  b.className = 'tb' + (cls ? ' ' + cls : '');
  b.textContent = label;
  if (title) { b.title = title; b.setAttribute('aria-label', title); }
  if (id) b.dataset.id = id;
  // 포커스가 셀에서 빠져나가지 않게 한다 (서식 적용에 필요).
  b.addEventListener('pointerdown', (e) => e.preventDefault());
  b.addEventListener('click', onClick);
  bar.appendChild(b);
  return b;
}

function group(bar) {
  const d = document.createElement('span');
  d.className = 'tb-sep';
  bar.appendChild(d);
}

export function refresh() {
  if (!buttons.undo) return;
  buttons.undo.disabled = !undo.canUndo();
  buttons.redo.disabled = !undo.canRedo();
  buttons.review.classList.toggle('active', review.state.hideAnswers);
  buttons.rehide.hidden = !review.state.hideAnswers;
  buttons.random.classList.toggle('active', review.isRandom());
  buttons.more.classList.toggle('badge', backup.backupOverdue());

  const isReviewView = sheet.getView().kind === 'review';
  const viewer = sheet.isReadOnly();
  buttons.add.disabled = isReviewView || viewer;
  // 보기 전용 기기에서는 데이터를 바꾸는 버튼을 잠근다.
  // 정답 가리기·랜덤·검색은 화면 상태일 뿐이라 그대로 쓸 수 있다.
  for (const key of ['del', 'move', 'clearWritten', 'bold', 'size', 'color']) {
    if (buttons[key]) buttons[key].disabled = viewer;
  }
}

function sizeMenu(anchor) {
  ui.popupMenu(anchor, rt.FONT_SIZES.map((px) => ({
    label: `${px}px`,
    onClick: () => actions.fontSize(px),
  })));
}

function colorMenu(anchor) {
  ui.popupMenu(anchor, rt.COLORS.map((c) => ({
    label: c.name,
    swatch: c.value,   // 색 동그라미를 같이 보여 준다
    onClick: () => actions.color(c.value),
  })));
}

function rowHeightMenu(anchor) {
  const cur = store.getSetting('rowHeightMode') || 'normal';
  const item = (mode, label) => ({
    label: cur === mode ? `${label} ✓` : label,
    onClick: () => actions.setRowHeightMode(mode),
  });
  ui.popupMenu(anchor, [
    item('compact', '좁게 (2줄)'),
    item('normal', '보통 (5줄)'),
    item('full', '전체 (자르지 않음)'),
  ]);
}

/** ⋯ 메뉴의 동기화 부분. 설정 전에는 안내만, 설정 후에는 올리기/내려받기. */
function syncMenuItems() {
  const items = [];
  if (sync.isConfigured()) {
    // 보기 전용 기기에서는 올리기를 아예 내보내지 않는다 (실수로 덮어쓰지 않도록).
    if (!sync.isViewer()) {
      items.push({ label: '지금 올리기 (이 기기 → 클라우드)', onClick: () => actions.syncPush() });
    }
    items.push({ label: '지금 내려받기 (클라우드 → 이 기기)', onClick: () => actions.syncPull() });
    items.push({ label: '동기화 설정…', onClick: () => actions.syncSetup() });
  } else {
    items.push({ label: '기기 간 동기화 설정하기…', onClick: () => actions.syncSetup() });
  }
  items.push('-');
  return items;
}

function moreMenu(anchor) {
  const deep = store.getSetting('folderCountMode') !== 'direct';
  ui.popupMenu(anchor, [
    // 챕터 단위 비우기는 툴바의 '작성 비우기' 버튼에 있다. 여기는 전체 범위만.
    { label: "'정답 작성하기' 전체 비우기 (모든 챕터)", danger: true, onClick: () => sheet.clearExplanations('all') },
    '-',
    ...syncMenuItems(),
    { label: '데이터 백업 (JSON 내보내기)', onClick: () => backup.exportBackup().then(refresh) },
    { label: '백업 파일에서 복원', onClick: () => backup.pickAndImport() },
    '-',
    {
      label: deep ? '폴더 개수: 하위 포함 ✓' : '폴더 개수: 하위 포함',
      onClick: () => store.setSetting('folderCountMode', 'deep'),
    },
    {
      label: !deep ? '폴더 개수: 이 폴더만 ✓' : '폴더 개수: 이 폴더만',
      onClick: () => store.setSetting('folderCountMode', 'direct'),
    },
    '-',
    { label: '업데이트 확인', onClick: () => actions.checkUpdate() },
    '-',
    { label: '기본 폴더 구조 넣기', danger: true, onClick: () => resetToSeed() },
    '-',
    { label: '선택 해제', onClick: () => sheet.clearSelection() },
    { label: 'ExamTree 정보', onClick: () => aboutDialog() },
  ]);
}

async function resetToSeed() {
  const ok = await ui.confirmDialog({
    title: '모든 데이터를 지우고 기본 폴더 구조로 되돌립니다',
    message: `현재 폴더 ${store.folders.size}개와 문제 ${store.questions.size}개가 전부 삭제되고 `
      + '건축기사 실기 폴더 구조만 남습니다.\n\n'
      + '실행취소로 되돌릴 수 없습니다. 필요하면 먼저 백업하세요.',
    okLabel: '지우고 되돌리기', danger: true,
  });
  if (!ok) return;
  await store.resetToSeed();
  undo.clear();
  ui.toast(`기본 폴더 구조를 넣었습니다. 폴더 ${store.folders.size}개`);
}

function aboutDialog() {
  const last = store.getSetting('lastBackupAt');
  const syncAt = sync.lastSyncAt();
  const syncLine = sync.isConfigured()
    ? `동기화: ${sync.getConfig().repo} · ${sync.isViewer() ? '보기 전용 기기' : '주 기기'}\n`
      + `마지막 동기화: ${syncAt ? new Date(syncAt).toLocaleString('ko-KR') : '없음'}\n`
    : '동기화: 설정되지 않음\n';
  ui.confirmDialog({
    title: `ExamTree v${actions.version ? actions.version() : '?'}`,
    message: `폴더 ${store.folders.size}개 · 문제 ${store.questions.size}개 · 복습 표시 ${store.reviewCount()}개\n`
      + `마지막 백업: ${last ? new Date(last).toLocaleString('ko-KR') : '없음'}\n`
      + syncLine + '\n'
      + '데이터는 이 기기 안에만 저장됩니다. 정기적으로 백업하세요.',
    okLabel: '확인', cancelLabel: '닫기',
  });
}
