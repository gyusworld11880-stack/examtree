// ui.js — 토스트, 확인/입력 대화상자, 팝업 메뉴, 폴더 선택기, 드래그 제스처.
// 브라우저 기본 alert/confirm/prompt 는 iPad 전체화면 PWA 에서 어색하게 뜨므로 쓰지 않는다.

import * as store from './store.js';

const root = () => document.getElementById('overlays');

// ── 토스트 ──────────────────────────────────────────────────
let toastTimer = null;

export function toast(message, { action, actionLabel, duration = 3200 } = {}) {
  const host = document.getElementById('toast-host');
  host.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'toast';
  const span = document.createElement('span');
  span.textContent = message;
  box.appendChild(span);
  if (action) {
    const btn = document.createElement('button');
    btn.className = 'toast-action';
    btn.textContent = actionLabel || '실행취소';
    btn.addEventListener('click', () => { hideToast(); action(); });
    box.appendChild(btn);
  }
  host.appendChild(box);
  host.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, duration);
}

export function hideToast() {
  const host = document.getElementById('toast-host');
  host.hidden = true;
  host.innerHTML = '';
}

// ── 공통 모달 ───────────────────────────────────────────────
function openModal({ title, build, onKey }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const h = document.createElement('h2');
    h.className = 'dialog-title';
    h.textContent = title;
    dialog.appendChild(h);

    const close = (value) => {
      document.removeEventListener('keydown', keyHandler, true);
      backdrop.remove();
      resolve(value);
    };
    const keyHandler = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); return; }
      if (onKey) onKey(e, close);
    };
    document.addEventListener('keydown', keyHandler, true);
    backdrop.addEventListener('pointerdown', (e) => { if (e.target === backdrop) close(null); });

    build(dialog, close);
    backdrop.appendChild(dialog);
    root().appendChild(backdrop);
  });
}

function buttonRow(dialog, buttons) {
  const row = document.createElement('div');
  row.className = 'dialog-actions';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (b.variant ? ' ' + b.variant : '');
    btn.textContent = b.label;
    btn.addEventListener('click', b.onClick);
    row.appendChild(btn);
  }
  dialog.appendChild(row);
  return row;
}

export function confirmDialog({ title, message, okLabel = '확인', cancelLabel = '취소', danger = false }) {
  return openModal({
    title,
    onKey: (e, close) => { if (e.key === 'Enter') { e.preventDefault(); close(true); } },
    build: (dialog, close) => {
      if (message) {
        const p = document.createElement('p');
        p.className = 'dialog-message';
        p.textContent = message;
        dialog.appendChild(p);
      }
      buttonRow(dialog, [
        { label: cancelLabel, onClick: () => close(false) },
        { label: okLabel, variant: danger ? 'danger' : 'primary', onClick: () => close(true) },
      ]);
    },
  }).then((v) => v === true);
}

export function promptDialog({ title, value = '', placeholder = '', okLabel = '확인' }) {
  let input;
  return openModal({
    title,
    onKey: (e, close) => {
      if (e.key === 'Enter') { e.preventDefault(); close(input.value.trim() || null); }
    },
    build: (dialog, close) => {
      input = document.createElement('input');
      input.className = 'dialog-input';
      input.type = 'text';
      input.value = value;
      input.placeholder = placeholder;
      dialog.appendChild(input);
      buttonRow(dialog, [
        { label: '취소', onClick: () => close(null) },
        { label: okLabel, variant: 'primary', onClick: () => close(input.value.trim() || null) },
      ]);
      setTimeout(() => { input.focus(); input.select(); }, 30);
    },
  });
}

/** 폴더 하나를 고르는 대화상자. excludeSubtreeOf 하위는 선택할 수 없다. */
export function pickFolder({ title = '폴더 선택', excludeSubtreeOf = null, allowRoot = false }) {
  return openModal({
    title,
    build: (dialog, close) => {
      const list = document.createElement('div');
      list.className = 'folder-picker';

      if (allowRoot) {
        const b = document.createElement('button');
        b.className = 'picker-row';
        b.textContent = '최상위';
        b.addEventListener('click', () => close(store.ROOT));
        list.appendChild(b);
      }

      const walk = (parentID, depth) => {
        for (const f of store.childFolders(parentID)) {
          const disabled = excludeSubtreeOf && store.isDescendant(f.id, excludeSubtreeOf);
          const b = document.createElement('button');
          b.className = 'picker-row';
          b.style.paddingLeft = 12 + depth * 18 + 'px';
          b.textContent = f.name;
          if (disabled) b.disabled = true;
          else b.addEventListener('click', () => close(f.id));
          list.appendChild(b);
          walk(f.id, depth + 1);
        }
      };
      walk(store.ROOT, 0);

      dialog.appendChild(list);
      buttonRow(dialog, [{ label: '취소', onClick: () => close(null) }]);
    },
  });
}

// ── 팝업 메뉴 ───────────────────────────────────────────────
export function popupMenu(anchor, items) {
  closeMenus();
  const menu = document.createElement('div');
  menu.className = 'popup-menu';
  for (const item of items) {
    if (item === '-') {
      const hr = document.createElement('div');
      hr.className = 'menu-sep';
      menu.appendChild(hr);
      continue;
    }
    const b = document.createElement('button');
    b.className = 'menu-item' + (item.danger ? ' danger' : '');
    b.textContent = item.label;
    // 셀 선택 영역을 잃지 않도록 포커스 이동을 막는다 (글자 크기·색 적용에 필요).
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    if (item.checked) b.classList.add('checked');
    b.addEventListener('click', () => { closeMenus(); item.onClick(); });
    menu.appendChild(b);
  }
  root().appendChild(menu);

  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = Math.min(r.left, window.innerWidth - mw - 8);
  let top = r.bottom + 4;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - mh - 4);
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = top + 'px';

  setTimeout(() => {
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('keydown', onEsc, true);
  }, 0);

  function onDocDown(e) { if (!menu.contains(e.target)) closeMenus(); }
  function onEsc(e) { if (e.key === 'Escape') { e.preventDefault(); closeMenus(); } }
  menu._cleanup = () => {
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onEsc, true);
  };
  return menu;
}

export function closeMenus() {
  for (const m of Array.from(document.querySelectorAll('.popup-menu'))) {
    if (m._cleanup) m._cleanup();
    m.remove();
  }
}

// ── 드래그 제스처 ───────────────────────────────────────────
// iPad Safari 의 HTML5 dragstart 는 터치에서 신뢰할 수 없어 Pointer Events 로 직접 구현한다.
// 드래그 시작점(.grip)에는 CSS 로 touch-action:none 을 주어 스크롤과 충돌하지 않게 한다.

export function beginDrag(e, { label, threshold = 6, onStart, onMove, onEnd, onTap }) {
  if (e.button != null && e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  const target = e.currentTarget;
  let dragging = false;
  let ghost = null;

  const move = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (!dragging) {
      if (Math.hypot(dx, dy) < threshold) return;
      dragging = true;
      try { target.setPointerCapture(ev.pointerId); } catch { /* 무시 */ }
      ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.textContent = label || '';
      root().appendChild(ghost);
      document.body.classList.add('dragging');
      if (onStart) onStart();
    }
    ev.preventDefault();
    ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`;
    if (onMove) onMove(ev.clientX, ev.clientY);
  };

  const up = (ev) => {
    cleanup();
    if (dragging) {
      if (onEnd) onEnd(ev.clientX, ev.clientY, true);
    } else if (onTap) {
      onTap(ev);
    }
  };

  const cancel = () => {
    cleanup();
    if (dragging && onEnd) onEnd(0, 0, false);
  };

  function cleanup() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    if (ghost) ghost.remove();
    document.body.classList.remove('dragging');
  }

  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
}

/** 드래그 중 화면 가장자리 근처면 스크롤한다. */
export function autoScroll(container, clientY, zone = 60, speed = 12) {
  if (!container) return;
  const r = container.getBoundingClientRect();
  if (clientY < r.top + zone) container.scrollTop -= speed;
  else if (clientY > r.bottom - zone) container.scrollTop += speed;
}

/** 잠깐 강조 표시 (검색·출처 이동 후 위치를 알려줄 때). */
export function flash(el) {
  if (!el) return;
  el.classList.remove('flash');
  void el.offsetWidth; // 리플로우를 강제해 애니메이션을 다시 시작시킨다
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1600);
}
