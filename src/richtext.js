// richtext.js — 셀에 저장되는 서식 HTML 의 화이트리스트 정화 + 서식 적용.
//
// 저장 형식은 아주 좁은 HTML 부분집합이다:
//   <b> <i> <u> <br> <span style="font-size:_px; color:_; background-color:_">
// 그 밖의 태그·속성은 전부 벗겨내고 텍스트만 남긴다.

const ALLOWED_TAGS = new Set(['B', 'I', 'U', 'BR', 'SPAN']);
const TAG_ALIAS = { STRONG: 'B', EM: 'I', FONT: 'SPAN' };
const BLOCKISH = new Set(['DIV', 'P', 'LI', 'TR', 'BR']);
// 껍데기뿐 아니라 안의 텍스트까지 통째로 버려야 하는 태그.
// (template 안에서는 실행되지 않지만, 스크립트 본문이 셀에 글자로 남으면 안 된다.)
const DROP_WITH_CONTENT = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED',
  'SVG', 'MATH', 'LINK', 'META', 'TITLE', 'HEAD', 'CANVAS', 'AUDIO', 'VIDEO',
]);

const SIZE_RE = /^(\d{1,3}(\.\d+)?)(px|pt)$/;
const COLOR_RE = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;
// execCommand('fontSize', '7') 이 styleWithCSS 모드에서 만들어내는 키워드 값
const KEYWORD_SIZE = 'xxx-large';

export const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28];
export const COLORS = [
  { name: '검정', value: '#1c1c1e' },
  { name: '빨강', value: '#e02424' },
  { name: '파랑', value: '#1d4ed8' },
  { name: '초록', value: '#15803d' },
  { name: '주황', value: '#d97706' },
  { name: '보라', value: '#7c3aed' },
  { name: '회색', value: '#6b7280' },
];

function filterStyle(el, out) {
  const fs = el.style.fontSize;
  const m = fs && SIZE_RE.exec(fs);
  if (m) {
    // 워드/PDF 에서 붙여넣으면 pt 로 오는 경우가 많다. px 로 환산해 저장 형식을 하나로 유지한다.
    const px = m[3] === 'pt' ? Math.round(parseFloat(m[1]) * 4 / 3) : Math.round(parseFloat(m[1]));
    if (px >= 8 && px <= 96) out.style.fontSize = px + 'px';
  }
  const color = el.style.color;
  if (color && COLOR_RE.test(color)) out.style.color = color;
  const bg = el.style.backgroundColor;
  if (bg && COLOR_RE.test(bg)) out.style.backgroundColor = bg;
  const fw = el.style.fontWeight;
  if (fw === 'bold' || fw === '700') out.style.fontWeight = 'bold';
}

function cleanNode(node, doc) {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.nodeValue);
  if (node.nodeType !== Node.ELEMENT_NODE) return null;

  const raw = (node.tagName || '').toUpperCase();
  if (DROP_WITH_CONTENT.has(raw)) return null;
  const tag = TAG_ALIAS[raw] || raw;

  if (tag === 'BR') return doc.createElement('br');

  let out;
  if (ALLOWED_TAGS.has(tag)) {
    out = doc.createElement(tag.toLowerCase());
    if (tag === 'SPAN') {
      filterStyle(node, out);
      // <font color size> 레거시 속성도 스타일로 흡수한다.
      const c = node.getAttribute && node.getAttribute('color');
      if (c && COLOR_RE.test(c)) out.style.color = c;
    }
  } else {
    // 허용되지 않은 태그: 살릴 만한 인라인 스타일이 있으면 span 으로 옮겨 담고,
    // 없으면 껍데기만 벗기고 내용은 살린다.
    const span = doc.createElement('span');
    filterStyle(node, span);
    out = span.getAttribute('style') ? span : doc.createDocumentFragment();
  }

  for (const child of Array.from(node.childNodes)) {
    const c = cleanNode(child, doc);
    if (c) out.appendChild(c);
  }

  // <div>/<p> 같은 블록은 줄바꿈으로 환산한다.
  if (!ALLOWED_TAGS.has(tag) && BLOCKISH.has(raw) && out.childNodes.length) {
    if (out.nodeType === Node.ELEMENT_NODE) {
      const frag = doc.createDocumentFragment();
      frag.appendChild(out);
      frag.appendChild(doc.createElement('br'));
      out = frag;
    } else {
      out.appendChild(doc.createElement('br'));
    }
  }
  return out;
}

/** 임의의 HTML 문자열을 저장 가능한 형태로 정화한다. */
export function sanitize(html) {
  const tpl = document.createElement('template');
  // template 의 content 는 inert document 라서 이미지 로드/스크립트 실행이 일어나지 않는다.
  tpl.innerHTML = String(html == null ? '' : html);
  const doc = tpl.content.ownerDocument;
  const frag = doc.createDocumentFragment();
  for (const child of Array.from(tpl.content.childNodes)) {
    const c = cleanNode(child, doc);
    if (c) frag.appendChild(c);
  }
  const holder = document.createElement('div');
  holder.appendChild(frag);
  // 마지막에 남는 빈 줄바꿈 정리
  while (holder.lastChild && holder.lastChild.nodeName === 'BR') holder.removeChild(holder.lastChild);
  return holder.innerHTML;
}

/** 서식을 제거한 순수 텍스트. 검색과 백업 미리보기에 쓴다. */
export function toPlain(html) {
  const d = document.createElement('div');
  d.innerHTML = String(html == null ? '' : html);
  d.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  return d.textContent || '';
}

export function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = String(text == null ? '' : text);
  return d.innerHTML;
}

export function isEmptyHtml(html) {
  return toPlain(html).trim() === '';
}

// ── 서식 적용 ───────────────────────────────────────────────
// execCommand 는 폐기 예정 API 지만 Safari 를 포함해 모든 대상 브라우저에서
// contenteditable 선택 영역 서식에 대해 여전히 가장 신뢰할 수 있는 방법이다.

function useCss() {
  try { document.execCommand('styleWithCSS', false, true); } catch { /* 무시 */ }
}

export function toggleBold() {
  useCss();
  document.execCommand('bold');
}

export function applyColor(color) {
  useCss();
  document.execCommand('foreColor', false, color);
}

/** 선택 영역 글자 크기를 px 로 지정한다. */
export function applyFontSize(editable, px) {
  useCss();
  document.execCommand('fontSize', false, '7'); // 표시자로 최대 크기를 심는다
  if (!editable) return;
  editable.querySelectorAll('font[size="7"]').forEach((f) => {
    const s = document.createElement('span');
    s.style.fontSize = px + 'px';
    while (f.firstChild) s.appendChild(f.firstChild);
    f.replaceWith(s);
  });
  editable.querySelectorAll('span').forEach((s) => {
    if (s.style.fontSize === KEYWORD_SIZE) s.style.fontSize = px + 'px';
  });
}

/** 붙여넣기를 가로채 정화된 HTML 만 삽입한다. */
export function handlePaste(e) {
  const dt = e.clipboardData;
  if (!dt) return;
  e.preventDefault();
  const html = dt.getData('text/html');
  const text = dt.getData('text/plain');
  const safe = html ? sanitize(html) : escapeHtml(text).replace(/\r?\n/g, '<br>');
  document.execCommand('insertHTML', false, safe);
}
