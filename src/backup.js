// backup.js — 전체 데이터 JSON 내보내기 / 가져오기.
// Local-First 구조에서는 이것이 유일한 안전망이므로 MVP 필수 기능이다 (PRD 47장).

import * as store from './store.js';
import * as ui from './ui.js';
import * as undo from './undo.js';

const BACKUP_REMINDER_DAYS = 14;

function fileName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `ExamTree_Backup_${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

export async function exportBackup() {
  const data = store.exportData();
  const json = JSON.stringify(data, null, 2);
  const name = fileName();
  const blob = new Blob([json], { type: 'application/json' });

  // iOS 전체화면 PWA 에서는 <a download> 가 막히는 경우가 있어 공유 시트를 먼저 시도한다.
  const file = typeof File !== 'undefined' ? new File([blob], name, { type: 'application/json' }) : null;
  if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'ExamTree 백업' });
      store.setSetting('lastBackupAt', Date.now());
      ui.toast('백업 파일을 저장했습니다.');
      return;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // 사용자가 취소
      // 공유 실패 시 아래 다운로드로 넘어간다
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  store.setSetting('lastBackupAt', Date.now());
  ui.toast(`${name} 파일로 내보냈습니다.`);
}

export function pickAndImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (file) await importFile(file);
  });
  input.click();
}

export async function importFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    ui.toast('JSON 파일을 읽을 수 없습니다.');
    return;
  }
  if (!data || !Array.isArray(data.folders) || !Array.isArray(data.questions)) {
    ui.toast('ExamTree 백업 파일 형식이 아닙니다.');
    return;
  }

  const ok = await ui.confirmDialog({
    title: '기존 데이터를 덮어씁니다',
    message: `현재 폴더 ${store.folders.size}개 / 문제 ${store.questions.size}개가 모두 지워지고, `
      + `백업의 폴더 ${data.folders.length}개 / 문제 ${data.questions.length}개로 교체됩니다. 되돌릴 수 없습니다.`,
    okLabel: '복원', danger: true,
  });
  if (!ok) return;

  try {
    await store.importData(data);
    undo.clear();
    ui.toast(`복원 완료: 폴더 ${store.folders.size}개 / 문제 ${store.questions.size}개`);
  } catch (err) {
    console.error(err);
    ui.toast('복원 중 오류가 발생했습니다. 데이터는 그대로 유지됩니다.');
  }
}

/** 마지막 백업이 오래되었으면 true. 툴바에 알림 점을 띄우는 데 쓴다. */
export function backupOverdue() {
  const last = store.getSetting('lastBackupAt') || 0;
  if (!store.questions.size) return false;
  return Date.now() - last > BACKUP_REMINDER_DAYS * 24 * 60 * 60 * 1000;
}
