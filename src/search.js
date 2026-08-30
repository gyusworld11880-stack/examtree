// search.js — 전체 문제·폴더 검색.
// 서식 HTML 은 검색 전에 순수 텍스트로 벗겨서 비교한다.

import * as store from './store.js';
import * as rt from './richtext.js';

const MAX_RESULTS = 200;

let panel = null;
let input = null;
let resultBox = null;
let callbacks = {};

export function init(cbs) {
  callbacks = cbs || {};
  panel = document.getElementById('search-panel');
  input = document.getElementById('search-input');
  resultBox = document.getElementById('search-results');

  input.addEventListener('input', () => run(input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    if (e.key === 'Enter') {
      const first = resultBox.querySelector('.result-item');
      if (first) first.click();
    }
  });
  document.getElementById('search-close').addEventListener('click', close);
  panel.addEventListener('pointerdown', (e) => { if (e.target === panel) close(); });
}

export function open() {
  panel.hidden = false;
  input.value = '';
  resultBox.innerHTML = '<p class="search-hint">문제 · 정답 · 설명 · 폴더명을 검색합니다.</p>';
  setTimeout(() => input.focus(), 40);
}

export function close() {
  panel.hidden = true;
}

export function isOpen() { return panel && !panel.hidden; }

function run(rawQuery) {
  const q = rawQuery.trim().toLowerCase();
  resultBox.innerHTML = '';
  if (!q) {
    resultBox.innerHTML = '<p class="search-hint">문제 · 정답 · 설명 · 폴더명을 검색합니다.</p>';
    return;
  }

  const folderHits = [];
  for (const f of store.folders.values()) {
    if (f.name.toLowerCase().includes(q)) folderHits.push(f);
  }

  const hits = [];
  for (const item of store.questions.values()) {
    const fields = [
      ['문제', rt.toPlain(item.questionText)],
      ['정답', rt.toPlain(item.answerText)],
      ['설명', rt.toPlain(item.explanation)],
    ];
    for (const [label, text] of fields) {
      const idx = text.toLowerCase().indexOf(q);
      if (idx >= 0) { hits.push({ question: item, label, text, idx }); break; }
    }
    if (hits.length >= MAX_RESULTS) break;
  }

  if (!folderHits.length && !hits.length) {
    resultBox.innerHTML = '<p class="search-hint">검색 결과가 없습니다.</p>';
    return;
  }

  if (folderHits.length) {
    resultBox.appendChild(sectionTitle(`폴더 ${folderHits.length}개`));
    for (const f of folderHits.slice(0, 30)) {
      const b = document.createElement('button');
      b.className = 'result-item';
      b.innerHTML = `<span class="result-path">${escape(store.folderPathText(f.id))}</span>
        <span class="result-sub">문제 ${store.countOf(f.id)}개</span>`;
      b.addEventListener('click', () => { close(); callbacks.onOpenFolder(f.id); });
      resultBox.appendChild(b);
    }
  }

  // 폴더 경로별로 묶어 보여준다
  const groups = new Map();
  for (const h of hits) {
    const path = store.folderPathText(h.question.folderID) || '(위치 없음)';
    if (!groups.has(path)) groups.set(path, []);
    groups.get(path).push(h);
  }

  resultBox.appendChild(sectionTitle(`관련 문제 ${hits.length}개`));
  for (const [path, list] of groups) {
    const head = document.createElement('div');
    head.className = 'result-group';
    head.textContent = `${path}  ·  ${list.length}개`;
    resultBox.appendChild(head);
    for (const h of list) {
      const b = document.createElement('button');
      b.className = 'result-item';
      b.innerHTML = `<span class="result-badge">${h.label}</span>${snippet(h.text, h.idx, q.length)}`;
      b.addEventListener('click', () => {
        close();
        callbacks.onGoToQuestion(h.question.folderID, h.question.id);
      });
      resultBox.appendChild(b);
    }
  }
}

function sectionTitle(text) {
  const d = document.createElement('div');
  d.className = 'result-section';
  d.textContent = text;
  return d;
}

function snippet(text, idx, len) {
  const start = Math.max(0, idx - 24);
  const head = (start > 0 ? '…' : '') + text.slice(start, idx);
  const hit = text.slice(idx, idx + len);
  const tail = text.slice(idx + len, idx + len + 48) + (text.length > idx + len + 48 ? '…' : '');
  return `${escape(head)}<mark>${escape(hit)}</mark>${escape(tail)}`;
}

function escape(s) { return rt.escapeHtml(s); }
