// sync.js — GitHub 비공개 저장소를 통한 기기 간 동기화.
//
// 서버 없이 GitHub Contents API 를 저장소로 쓴다.
//   아이패드(주 기기) --올리기--> examtree-data/data.json --내려받기--> 아이폰(보기 전용)
//
// 설정은 전부 localStorage 에 둔다. IndexedDB 설정에 넣으면
// store.exportData() 가 settings 를 통째로 담기 때문에 백업 JSON 파일에 토큰이 딸려 나간다.

const LS_REPO = 'examtree.sync.repo';    // "owner/name"
const LS_TOKEN = 'examtree.sync.token';
const LS_ROLE = 'examtree.sync.role';    // 'main' | 'viewer'
const LS_LAST = 'examtree.sync.lastAt';

const FILE = 'data.json';
const API = 'https://api.github.com';

function ls(key, value) {
  try {
    if (value === undefined) return localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return value;
  } catch {
    return null; // 저장소가 막힌 환경(사생활 보호 모드 등)
  }
}

export function getConfig() {
  return {
    repo: ls(LS_REPO) || '',
    token: ls(LS_TOKEN) || '',
    role: ls(LS_ROLE) || 'main',
  };
}

export function setConfig({ repo, token, role }) {
  if (repo !== undefined) ls(LS_REPO, repo || null);
  if (token !== undefined) ls(LS_TOKEN, token || null);
  if (role !== undefined) ls(LS_ROLE, role || null);
}

export function isConfigured() {
  const c = getConfig();
  return !!(c.repo && c.token);
}

/** 이 기기가 보기 전용인가. 보기 전용에서는 편집을 아예 막는다. */
export function isViewer() {
  return getConfig().role === 'viewer';
}

export function lastSyncAt() {
  const v = Number(ls(LS_LAST));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function markSynced() { ls(LS_LAST, String(Date.now())); }

// ── UTF-8 ↔ base64 ─────────────────────────────────────────
// btoa 는 바이트만 받는다. 한글을 그대로 넣으면 예외가 난다.

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  const CHUNK = 0x8000; // 인자 수 제한을 피해 잘라서 넘긴다
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(String(b64).replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// ── GitHub API ─────────────────────────────────────────────
async function api(path, options = {}) {
  const { token } = getConfig();
  return fetch(API + path, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  });
}

/** 응답 상태를 사람이 알아들을 수 있는 문장으로 바꾼다. */
function describe(res) {
  const map = {
    401: '토큰이 잘못되었거나 만료되었습니다. 동기화 설정에서 다시 넣어 주세요.',
    403: '토큰 권한이 부족합니다. Contents 를 Read and write 로 주었는지 확인하세요.',
    404: '저장소를 찾을 수 없습니다. 이름(주인/저장소)과 토큰 권한을 확인하세요.',
    409: '저장소가 그 사이 바뀌었습니다. 다시 시도해 주세요.',
    422: '저장 요청이 거부되었습니다. 저장소가 비어 있는지 확인하세요.',
  };
  return new Error(map[res.status] || `GitHub 오류 (${res.status})`);
}

function wrapNetworkError(err) {
  if (err instanceof TypeError) {
    return new Error('인터넷에 연결할 수 없습니다. 연결을 확인해 주세요.');
  }
  return err;
}

async function readRemote() {
  const { repo } = getConfig();
  const res = await api(`/repos/${repo}/contents/${encodeURIComponent(FILE)}`);
  if (res.status === 404) return null;           // 아직 한 번도 올린 적 없음
  if (!res.ok) throw describe(res);
  return res.json();
}

/**
 * 클라우드에서 내려받는다.
 * @returns {folders, questions} 또는 null(아직 올린 적 없음)
 */
export async function pull() {
  try {
    const meta = await readRemote();
    if (!meta) return null;
    const data = JSON.parse(fromBase64(meta.content));
    if (!data || !Array.isArray(data.folders) || !Array.isArray(data.questions)) {
      throw new Error('저장된 파일이 ExamTree 형식이 아닙니다.');
    }
    markSynced();
    return data;
  } catch (err) {
    throw wrapNetworkError(err);
  }
}

/** 현재 기기 내용을 클라우드에 올린다. data 는 { folders, questions }. */
export async function push(data) {
  try {
    const { repo } = getConfig();
    // 덮어쓰려면 지금 올라가 있는 파일의 sha 가 필요하다.
    const meta = await readRemote();
    const body = {
      message: `ExamTree 동기화 ${new Date().toLocaleString('ko-KR')}`,
      content: toBase64(JSON.stringify(data)),
    };
    if (meta && meta.sha) body.sha = meta.sha;

    const res = await api(`/repos/${repo}/contents/${encodeURIComponent(FILE)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    if (!res.ok) throw describe(res);
    markSynced();
  } catch (err) {
    throw wrapNetworkError(err);
  }
}

/** 설정이 실제로 통하는지 확인한다. 설정 대화상자에서 쓴다. */
export async function test() {
  try {
    const { repo } = getConfig();
    const res = await api(`/repos/${repo}`);
    if (!res.ok) throw describe(res);
    const info = await res.json();
    return { ok: true, private: !!info.private, full: info.full_name };
  } catch (err) {
    throw wrapNetworkError(err);
  }
}
