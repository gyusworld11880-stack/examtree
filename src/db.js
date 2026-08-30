// db.js — IndexedDB 접근 계층.
// 저장소는 이 파일 하나만 통과한다. 다른 모듈은 store.js를 통해서만 접근한다.

const DB_NAME = 'examtree';
const DB_VERSION = 1;

let dbPromise = null;

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('folders')) {
        const s = db.createObjectStore('folders', { keyPath: 'id' });
        // 루트 폴더의 parentFolderID 는 null 이 아니라 '' 이다.
        // IndexedDB 인덱스는 null 키를 가진 레코드를 아예 건너뛰기 때문.
        s.createIndex('parentFolderID', 'parentFolderID');
      }
      if (!db.objectStoreNames.contains('questions')) {
        const s = db.createObjectStore('questions', { keyPath: 'id' });
        s.createIndex('folderID', 'folderID');
        // boolean 은 인덱싱 불가 → 0/1 정수 미러 필드를 인덱싱한다.
        s.createIndex('isReviewFlag', 'isReviewFlag');
        s.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('다른 탭에서 ExamTree가 열려 있습니다. 해당 탭을 닫고 다시 시도하세요.'));
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

export async function all(storeName) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(storeName, value) {
  const db = await open();
  const tx = db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put(value);
  return done(tx);
}

export async function putMany(storeName, values) {
  if (!values.length) return;
  const db = await open();
  const tx = db.transaction(storeName, 'readwrite');
  const os = tx.objectStore(storeName);
  for (const v of values) os.put(v);
  return done(tx);
}

export async function removeMany(storeName, keys) {
  if (!keys.length) return;
  const db = await open();
  const tx = db.transaction(storeName, 'readwrite');
  const os = tx.objectStore(storeName);
  for (const k of keys) os.delete(k);
  return done(tx);
}

/**
 * 백업 복원용. 세 스토어를 하나의 트랜잭션에서 비우고 새로 채운다.
 * 도중에 실패하면 트랜잭션 전체가 롤백되므로 반쪽 상태가 남지 않는다.
 */
export async function replaceAll({ folders, questions, settings }) {
  const db = await open();
  const tx = db.transaction(['folders', 'questions', 'settings'], 'readwrite');
  const f = tx.objectStore('folders');
  const q = tx.objectStore('questions');
  const s = tx.objectStore('settings');
  f.clear(); q.clear(); s.clear();
  for (const v of folders) f.put(v);
  for (const v of questions) q.put(v);
  for (const v of settings) s.put(v);
  return done(tx);
}
