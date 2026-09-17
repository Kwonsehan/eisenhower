/* ============================================================
   app.js - 아이젠하워 매트릭스 & 캘린더 플래너 v5
   (드래그 앤 드롭 일정 배정 & 월/주 연동 & 스마트 코칭)
============================================================ */

'use strict';


/* ============================================================
   1. Supabase 설정
============================================================ */

const SUPABASE_URL      = 'https://xtuanrjjdzstqzoitesb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0dWFucmpqZHpzdHF6b2l0ZXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2MjEyMzgsImV4cCI6MjEwNTE5NzIzOH0.DVjT-eFQQOhMF2bFisdh-INm1EbWMH3-swQ1hKdsxvw';

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const REDIRECT_URL = 'https://kwonsehan.github.io/eisenhower/';


/* ============================================================
   2. 앱 전역 상태
============================================================ */

let tasks           = [];         // 현재 로드된 할 일 목록
let rewards         = [];         // 나에게 주는 선물 & 놀기 계획 목록
let currentUser     = null;       // 로그인 사용자
let currentMainTab  = 'matrix';   // 'matrix' | 'calendar'
let dashboardTab    = 'daily';    // 'daily' | 'weekly'
let openPanelTaskId = null;       // 열린 상세 패널 ID
let q2Chart         = null;       // Chart.js 인스턴스
let isArchiveOpen   = false;      // 아코디언 펼침 여부

// ── 캘린더 플래너 상태 ──
let calViewMode          = 'month';  // 'month' | 'week'
let calBaseDate          = new Date();
let calFilterQuadrant    = 'ALL';    // 'ALL' | 'Q1' | 'Q2' | 'Q3' | 'Q4'
let selectedBlockIdForMobile = null; // 모바일 원터치 배정용 선택된 블록 ID


/* ============================================================
   3. 유틸리티 함수
============================================================ */

const QUADRANT_INFO = {
  Q1: { label: 'Q1 🔴 긴급+중요',   emoji: '🔥', badgeClass: 'panel-badge-Q1' },
  Q2: { label: 'Q2 🔵 중요+여유',   emoji: '📅', badgeClass: 'panel-badge-Q2' },
  Q3: { label: 'Q3 🟡 긴급+덜중요', emoji: '🤝', badgeClass: 'panel-badge-Q3' },
  Q4: { label: 'Q4 ⚪ 제거 대상',   emoji: '🗑️', badgeClass: 'panel-badge-Q4' },
};

const DAY_LABELS = ['일','월','화','수','목','금','토'];

function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function getTodayStr() { return new Date().toISOString().slice(0, 10); }

function toDateStr(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}`;
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function getWeekRange(baseDate = new Date()) {
  const d   = new Date(baseDate);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d); monday.setDate(d.getDate() + diff);
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  const fmt = (x) => x.toISOString().slice(0, 10);
  return { start: fmt(monday), end: fmt(sunday), monday, sunday };
}

function getDueBadgeType(dueDateStr) {
  if (!dueDateStr) return null;
  const today    = getTodayStr();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  if (dueDateStr < today)        return 'overdue';
  if (dueDateStr === today)      return 'today';
  if (dueDateStr === tomorrowStr) return 'tomorrow';
  return 'normal';
}

function formatDueDate(dueDateStr) {
  if (!dueDateStr) return '';
  const type = getDueBadgeType(dueDateStr);
  if (type === 'overdue')  return `⚠️ ${dueDateStr} (마감 지남)`;
  if (type === 'today')    return `🔔 오늘 마감`;
  if (type === 'tomorrow') return `📌 내일 마감`;
  return `📅 ${dueDateStr}`;
}

function formatCompletedAt(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/** Q2 항목 중 마감이 지났거나 오늘/내일인 임박 항목인지 판별 */
function isQ2Imminent(task) {
  if (!task || task.quadrant !== 'Q2' || task.completed || !task.dueDate) return false;
  const badgeType = getDueBadgeType(task.dueDate);
  return badgeType === 'overdue' || badgeType === 'today' || badgeType === 'tomorrow';
}



/* ============================================================
   4. DB ↔ 앱 데이터 매핑 (scheduled_date 포함)
============================================================ */

function dbToTask(row) {
  return {
    id:            row.id,
    title:         row.title,
    quadrant:      row.quadrant,
    dueDate:       row.due_date       || null, // 마감일 (데드라인)
    scheduledDate: row.scheduled_date || null, // 실행 예정일 (캘린더 배정 날짜)
    memo:          row.memo           || '',
    subtasks:      Array.isArray(row.subtasks) ? row.subtasks : [], // 미니 체크리스트 세부 단계
    completed:     row.completed,
    completedAt:   row.completed_at   || null,
    createdAt:     row.created_at,
  };
}

function taskToDb(task) {
  const row = {
    id:           task.id,
    user_id:      currentUser.id,
    title:        task.title,
    quadrant:     task.quadrant,
    due_date:     task.dueDate     || null,
    memo:         task.memo        || '',
    subtasks:     task.subtasks    || [], // 미니 체크리스트 JSON 배열
    completed:    task.completed,
    completed_at: task.completedAt || null,
    created_at:   task.createdAt,
  };
  // 캘린더 실행일이 배정되었을 때만 전송
  if (task.scheduledDate) {
    row.scheduled_date = task.scheduledDate;
  }
  return row;
}


/* ============================================================
   5. Supabase CRUD
============================================================ */

async function fetchTasksFromDB() {
  const { data, error } = await supabaseClient
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(dbToTask);
}

async function insertTaskToDB(task) {
  const { error } = await supabaseClient
    .from('tasks')
    .insert([taskToDb(task)]);
  if (error) throw error;
}

async function updateTaskInDB(taskId, fields) {
  const dbFields = {};
  if (fields.title         !== undefined) dbFields.title          = fields.title;
  if (fields.quadrant      !== undefined) dbFields.quadrant       = fields.quadrant;
  if (fields.dueDate       !== undefined) dbFields.due_date       = fields.dueDate;
  if (fields.scheduledDate !== undefined) dbFields.scheduled_date = fields.scheduledDate;
  if (fields.memo          !== undefined) dbFields.memo           = fields.memo;
  if (fields.subtasks      !== undefined) dbFields.subtasks       = fields.subtasks;
  if (fields.completed     !== undefined) dbFields.completed      = fields.completed;
  if (fields.completedAt   !== undefined) dbFields.completed_at   = fields.completedAt;

  const { error } = await supabaseClient
    .from('tasks')
    .update(dbFields)
    .eq('id', taskId);
  if (error) throw error;
}

async function deleteTaskFromDB(taskId) {
  const { error } = await supabaseClient
    .from('tasks')
    .delete()
    .eq('id', taskId);
  if (error) throw error;
}

async function upsertTasksToDB(taskList) {
  const rows = taskList.map(taskToDb);
  const { error } = await supabaseClient
    .from('tasks')
    .upsert(rows, { onConflict: 'id' });
  if (error) throw error;
}


/* ============================================================
   6. 인증 (Authentication)
============================================================ */

async function signInWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: REDIRECT_URL },
  });
  if (error) showToast('⚠️ 로그인 실패: ' + error.message, 'error');
}

async function signOut() {
  await supabaseClient.auth.signOut();
}

function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-body').classList.add('hidden');
  document.getElementById('loading-screen').classList.add('hidden');
  tasks = [];
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-body').classList.remove('hidden');
  document.getElementById('loading-screen').classList.add('hidden');

  if (currentUser) {
    const avatarEl  = document.getElementById('user-avatar');
    const nameEl    = document.getElementById('user-name');
    const avatarUrl = currentUser.user_metadata?.avatar_url;
    const name      = currentUser.user_metadata?.full_name || currentUser.email;

    if (avatarUrl) {
      avatarEl.src = avatarUrl;
      avatarEl.classList.remove('hidden');
    }
    nameEl.textContent = name;
    nameEl.classList.remove('hidden');
  }
}

function showLoadingScreen() {
  document.getElementById('loading-screen').classList.remove('hidden');
}


/* ============================================================
   7. 렌더링 & 동기화
============================================================ */

async function loadAndRender() {
  showLoadingScreen();
  try {
    const [fetchedTasks, fetchedRewards] = await Promise.all([
      fetchTasksFromDB(),
      fetchRewardsFromDB(),
    ]);
    tasks   = fetchedTasks;
    rewards = fetchedRewards;
    showApp();
    renderAll();
  } catch (e) {
    console.error('데이터 로드 실패:', e);
    showToast('⚠️ 데이터를 불러오지 못했습니다.', 'error');
    showApp();
    renderAll();
  }
}

function createTaskCard(task) {
  const card = document.createElement('div');
  const hasMemo = task.memo && task.memo.trim().length > 0;
  const isImminent = isQ2Imminent(task);

  card.className = `task-card ${task.completed ? 'completed' : ''} ${hasMemo ? 'has-memo' : ''} ${isImminent ? 'q2-imminent' : ''}`;
  card.dataset.id = task.id;
  card.draggable = true;

  const dueBadgeType = getDueBadgeType(task.dueDate);
  const dueBadgeHtml = task.dueDate
    ? `<span class="due-badge ${dueBadgeType}">${formatDueDate(task.dueDate)}</span>` : '';
  
  // 실행 예정일이 캘린더에 배정된 경우 뱃지 표시
  const scheduledHtml = task.scheduledDate
    ? `<span class="text-[11px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium ml-1">🗓️ ${task.scheduledDate}</span>` : '';

  // 미니 체크리스트 진행률 뱃지 (하위 단계가 있을 때만 표시)
  let subtaskBadgeHtml = '';
  if (task.subtasks && task.subtasks.length > 0) {
    const totalSub = task.subtasks.length;
    const doneSub = task.subtasks.filter((s) => s.completed).length;
    const isAllDone = doneSub === totalSub;
    subtaskBadgeHtml = `<span class="task-subtask-badge ${isAllDone ? 'all-done' : ''}" title="세부 단계: ${doneSub}/${totalSub} 완료">☑️ ${doneSub}/${totalSub}</span>`;
  }

  // Q2 마감 임박 뱃지 & 빠른 승격 버튼
  const imminentBadgeHtml = isImminent
    ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-bold border border-red-200 animate-pulse">🚨 마감 임박</span>` : '';

  const escalateBtnHtml = isImminent
    ? `<button class="btn-escalate-quick text-[11px] font-bold px-2 py-0.5 rounded-lg bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-all whitespace-nowrap shadow-xs" title="Q1(긴급·중요)으로 즉시 승격">🔥 Q1 승격</button>` : '';

  const completedHtml = task.completed && task.completedAt
    ? `<p class="text-xs text-gray-400 mt-1">✅ ${formatCompletedAt(task.completedAt)} 완료</p>` : '';

  card.innerHTML = `
    <div class="flex items-start gap-2">
      <input type="checkbox" class="task-check mt-0.5 flex-shrink-0" ${task.completed ? 'checked' : ''} title="완료로 표시" />
      <div class="flex-1 min-w-0 cursor-pointer" data-open-panel>
        <p class="task-title text-sm font-medium text-gray-800 leading-snug break-words">${escapeHtml(task.title)}</p>
        <div class="mt-1 flex flex-wrap gap-1 items-center">
          ${imminentBadgeHtml}
          ${dueBadgeHtml}
          ${scheduledHtml}
          ${subtaskBadgeHtml}
        </div>
        ${completedHtml}
      </div>
      <div class="flex items-center gap-1 flex-shrink-0 relative">
        ${escalateBtnHtml}
        <button class="btn-move text-gray-400 hover:text-blue-500 p-1 rounded hover:bg-blue-50 transition-colors text-xs" title="이동">↔️</button>
        <button class="btn-delete text-gray-400 hover:text-red-500 p-1 rounded hover:bg-red-50 transition-colors text-xs" title="삭제">🗑️</button>
      </div>
    </div>
  `;
  return card;
}

/** Q2 마감 임박 작업들을 Q1으로 일괄 승격 */
async function escalateAllImminentToQ1(imminentList) {
  if (!imminentList || imminentList.length === 0) return;
  const count = imminentList.length;
  imminentList.forEach((t) => { t.quadrant = 'Q1'; });
  renderAll();

  try {
    await upsertTasksToDB(imminentList);
    showToast(`🔥 ${count}개 작업이 Q1(긴급·중요)으로 승격되었습니다!`);
  } catch (e) {
    await loadAndRender();
    showToast('⚠️ 승격 처리 중 오류 발생.', 'error');
  }
}

function renderAll() {
  // 1) 2x2 매트릭스 렌더링
  ['Q1', 'Q2', 'Q3', 'Q4'].forEach((q) => {
    const listEl = document.getElementById(`list-${q}`);
    listEl.innerHTML = '';
    const qTasks = tasks.filter((t) => t.quadrant === q);

    // Q2 마감 임박 알림 스마트 배너
    if (q === 'Q2') {
      const imminentTasks = qTasks.filter(isQ2Imminent);
      if (imminentTasks.length > 0) {
        const banner = document.createElement('div');
        banner.className = 'q2-imminent-banner p-2 mb-2 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-between gap-2 shadow-xs';
        banner.innerHTML = `
          <div class="flex items-center gap-1.5 text-xs text-orange-800 font-semibold">
            <span>🚨</span>
            <span>마감 임박 <strong>${imminentTasks.length}건</strong></span>
          </div>
          <button class="btn-escalate-all text-[11px] font-bold px-2 py-1 rounded-lg bg-orange-500 hover:bg-orange-600 text-white transition-all shadow-sm active:scale-95 whitespace-nowrap">
            🔥 모두 Q1 승격
          </button>
        `;
        banner.querySelector('.btn-escalate-all').addEventListener('click', () => escalateAllImminentToQ1(imminentTasks));
        listEl.appendChild(banner);
      }
    }

    if (qTasks.length === 0) {
      listEl.innerHTML += `<div class="empty-hint">할 일을 추가하거나<br>드래그해서 놓으세요</div>`;
    } else {
      qTasks.forEach((task) => {
        const card = createTaskCard(task);
        bindCardEvents(card, task);
        listEl.appendChild(card);
      });
    }
    document.getElementById(`count-${q}`).textContent = `${qTasks.length}개`;
  });

  // 2) 대시보드 & 코칭
  updateDashboard();
  renderCompletedArchive();

  // 3) 캘린더 플래너 렌더링 (캘린더 탭일 때 또는 백그라운드 동기화)
  renderCalendarPlanner();

  // 4) 나에게 주는 선물 & 노는 계획 렌더링
  renderRewards();
}


/* ============================================================
   8. 할 일 CRUD
============================================================ */

async function addTask() {
  const titleEl = document.getElementById('input-title');
  const title   = titleEl.value.trim();
  if (!title) {
    showToast('⚠️ 할 일 제목을 입력해주세요.', 'warning');
    titleEl.focus();
    return;
  }

  const newTask = {
    id:            generateId(),
    title,
    quadrant:      document.getElementById('input-quadrant').value,
    dueDate:       document.getElementById('input-due').value || null,
    scheduledDate: null,
    memo:          '',
    subtasks:      [], // 미니 체크리스트 초기값
    completed:     false,
    completedAt:   null,
    createdAt:     new Date().toISOString(),
  };

  tasks.push(newTask);
  renderAll();

  titleEl.value = '';
  document.getElementById('input-due').value = '';
  titleEl.focus();

  try {
    await insertTaskToDB(newTask);
    showToast(`✅ "${title}" 추가되었습니다.`);
  } catch (e) {
    tasks = tasks.filter((t) => t.id !== newTask.id);
    renderAll();
    showToast('⚠️ 저장 실패. 인터넷 연결을 확인하세요.', 'error');
  }
}

async function toggleComplete(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  task.completed   = !task.completed;
  task.completedAt = task.completed ? new Date().toISOString() : null;
  renderAll();

  try {
    await updateTaskInDB(taskId, {
      completed:   task.completed,
      completedAt: task.completedAt,
    });
  } catch (e) {
    task.completed   = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;
    renderAll();
    showToast('⚠️ 저장 실패.', 'error');
  }
}

async function deleteTask(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (!confirm(`"${task.title}" 을(를) 삭제할까요?`)) return;

  tasks = tasks.filter((t) => t.id !== taskId);
  closeDetailPanel();
  renderAll();

  try {
    await deleteTaskFromDB(taskId);
    showToast('🗑️ 삭제되었습니다.');
  } catch (e) {
    await loadAndRender();
    showToast('⚠️ 삭제 실패.', 'error');
  }
}

async function moveTask(taskId, toQuadrant) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const from = task.quadrant;

  task.quadrant = toQuadrant;
  renderAll();

  try {
    await updateTaskInDB(taskId, { quadrant: toQuadrant });
    showToast(`↔️ ${from} → ${toQuadrant} 이동했습니다.`);
  } catch (e) {
    task.quadrant = from;
    renderAll();
    showToast('⚠️ 이동 실패.', 'error');
  }
}

async function updateTask(taskId, fields) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  const prev = { ...task };
  Object.assign(task, fields);
  renderAll();

  try {
    await updateTaskInDB(taskId, fields);
  } catch (e) {
    Object.assign(task, prev);
    renderAll();
    showToast('⚠️ 저장 실패.', 'error');
  }
}

/** 캘린더 날짜 배정 (Scheduled Date 업데이트) */
async function scheduleTaskDate(taskId, targetDateStr) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  await updateTask(taskId, { scheduledDate: targetDateStr });
  showToast(`📅 "${task.title}" 일정이 ${targetDateStr}로 배정되었습니다!`);
}


/* ============================================================
   9. 카드 이벤트 & 드래그앤드롭
============================================================ */

function bindCardEvents(card, task) {
  card.querySelector('.task-check').addEventListener('change', () => toggleComplete(task.id));
  card.querySelector('.btn-delete').addEventListener('click', (e) => { e.stopPropagation(); deleteTask(task.id); });
  card.querySelector('.btn-move').addEventListener('click', (e) => { e.stopPropagation(); toggleMoveDropdown(card, task); });
  card.querySelector('[data-open-panel]').addEventListener('click', (e) => { e.stopPropagation(); openDetailPanel(task.id); });

  // Q2 마감 임박 카드인 경우: 빠른 Q1 승격 버튼 리스너
  const escalateBtn = card.querySelector('.btn-escalate-quick');
  if (escalateBtn) {
    escalateBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      moveTask(task.id, 'Q1');
      showToast(`🔥 "${task.title}" 작업이 Q1(긴급·중요)으로 승격되었습니다!`);
    });
  }

  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.classList.add('dragging'), 0);
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.quadrant-panel').forEach((p) => p.classList.remove('drag-over'));
  });
}

function toggleMoveDropdown(card, task) {
  document.querySelectorAll('.move-dropdown').forEach((el) => el.remove());
  const dropdown = document.createElement('div');
  dropdown.className = 'move-dropdown';
  ['Q1','Q2','Q3','Q4'].forEach((q) => {
    const btn = document.createElement('button');
    btn.textContent = QUADRANT_INFO[q].label;
    btn.disabled = (q === task.quadrant);
    btn.addEventListener('click', (e) => { e.stopPropagation(); moveTask(task.id, q); dropdown.remove(); });
    dropdown.appendChild(btn);
  });
  card.querySelector('.btn-move').parentElement.appendChild(dropdown);
  const closeOnOutside = (e) => {
    if (!dropdown.contains(e.target)) { dropdown.remove(); document.removeEventListener('click', closeOnOutside); }
  };
  setTimeout(() => document.addEventListener('click', closeOnOutside), 50);
}

function initDragAndDrop() {
  document.querySelectorAll('.quadrant-panel').forEach((panel) => {
    const targetQ = panel.dataset.quadrant;
    panel.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; panel.classList.add('drag-over'); });
    panel.addEventListener('dragleave', (e) => { if (!panel.contains(e.relatedTarget)) panel.classList.remove('drag-over'); });
    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      panel.classList.remove('drag-over');
      const id = e.dataTransfer.getData('text/plain');
      const task = tasks.find((t) => t.id === id);
      if (!task || task.quadrant === targetQ) return;
      moveTask(id, targetQ);
    });
  });
}


/* ============================================================
   10. 💡 실시간 지능형 행동 코칭 & 대시보드
============================================================ */

function generateCoachingFeedback(completedTasks) {
  const total = completedTasks.length;

  const cardEl  = document.getElementById('coaching-card');
  const iconEl  = document.getElementById('coaching-icon');
  const badgeEl = document.getElementById('coaching-badge');
  const subEl   = document.getElementById('coaching-sub');
  const titleEl = document.getElementById('coaching-title');
  const descEl  = document.getElementById('coaching-desc');

  cardEl.className = 'coaching-box rounded-2xl p-4 border transition-all duration-300';

  if (total === 0) {
    cardEl.classList.add('coaching-theme-start');
    iconEl.textContent  = '🌱';
    badgeEl.textContent = '스타트업 모드';
    subEl.textContent   = '첫 걸음 시작하기';
    titleEl.textContent = '아직 완료된 작업이 없습니다';
    descEl.textContent  = '오늘 가장 마음에 걸리는 Q1(긴급·중요) 또는 미래를 위한 Q2(중요·여유) 작업 딱 1개만 먼저 해치워보세요!';
    return;
  }

  const counts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  completedTasks.forEach((t) => counts[t.quadrant]++);

  const q1Pct = Math.round((counts.Q1 / total) * 100);
  const q2Pct = Math.round((counts.Q2 / total) * 100);
  const q3Pct = Math.round((counts.Q3 / total) * 100);
  const q4Pct = Math.round((counts.Q4 / total) * 100);
  const urgentTotalPct = q1Pct + q3Pct;

  if (urgentTotalPct >= 60 || q1Pct >= 50) {
    cardEl.classList.add('coaching-theme-firefighter');
    iconEl.textContent  = '🔥';
    badgeEl.textContent = '소방수 모드 (과열)';
    subEl.textContent   = `긴급 작업 비중 ${urgentTotalPct}%`;
    titleEl.textContent = `급한 불 끄기(Q1·Q3)에 에너지가 집중되어 있습니다!`;
    descEl.textContent  = `소방관처럼 일하다 보면 번아웃이 오기 쉽습니다. 내일 하루를 시작할 때 30분 동안은 연락을 끄고 Q2(미래 준비) 작업 1개부터 먼저 끝내보세요.`;
    return;
  }

  if (q3Pct >= 30) {
    cardEl.classList.add('coaching-theme-shield');
    iconEl.textContent  = '🛡️';
    badgeEl.textContent = '방패 모드 (주의)';
    subEl.textContent   = `위임·거절 대상 ${q3Pct}%`;
    titleEl.textContent = `타인의 요청이나 자잘한 잔업에 시간을 많이 쓰고 계시네요.`;
    descEl.textContent  = `내 인생에 덜 중요한 급한 일(Q3)은 정중히 거절하거나 다른 사람에게 위임해 보세요. "아니오"라고 말할 수 있는 일을 1개 찾아보세요.`;
    return;
  }

  if (q2Pct >= 35) {
    cardEl.classList.add('coaching-theme-strategist');
    iconEl.textContent  = '🌟';
    badgeEl.textContent = '전략가 모드 (최상)';
    subEl.textContent   = `미래 투자 비중 ${q2Pct}%`;
    titleEl.textContent = `완벽합니다! 미래를 위한 진짜 가치 있는 일에 집중하고 계십니다.`;
    descEl.textContent  = `급한 일에 휘둘리지 않고 주도적으로 시간을 통제하고 계시네요. 이 훌륭한 리듬을 잃지 않도록 다음 주 Q2 일정도 미리 확보해 두세요!`;
    return;
  }

  if (q4Pct >= 25) {
    cardEl.classList.add('coaching-theme-burnout');
    iconEl.textContent  = '🪤';
    badgeEl.textContent = '에너지 방전 (경고)';
    subEl.textContent   = `제거 대상 비중 ${q4Pct}%`;
    titleEl.textContent = `뇌가 지쳐서 무의미한 일로 도피하고 있을 수 있습니다.`;
    descEl.textContent  = `Q4 작업을 계속 붙잡고 있기보다는, 15분간 가벼운 산책을 하거나 차를 마시며 '진짜 휴식'을 먼저 취해주세요. 뇌가 리셋되어야 집중력이 돌아옵니다.`;
    return;
  }

  cardEl.classList.add('coaching-theme-start');
  iconEl.textContent  = '⚖️';
  badgeEl.textContent = '균형 모드';
  subEl.textContent   = '차분한 페이스 유지 중';
  titleEl.textContent = `사분면이 골고루 분배되며 안정적으로 진행 중입니다.`;
  descEl.textContent  = `완료된 작업 ${total}개 중 Q2 비중은 ${q2Pct}%입니다. 급한 불을 끄셨다면 다음 스텝은 중요한 일(Q2)의 비중을 40% 이상으로 끌어올리는 것입니다!`;
}

function updateDashboard() {
  const filtered = getFilteredTasksForDashboard();
  const total = filtered.length;
  const completed = filtered.filter((t) => t.completed);
  const done  = completed.length;
  const pct   = total === 0 ? 0 : Math.round((done / total) * 100);

  document.getElementById('overall-pct').textContent    = pct;
  document.getElementById('overall-bar').style.width    = `${pct}%`;
  document.getElementById('overall-detail').textContent = `${done}개 완료 / 전체 ${total}개`;

  ['Q1','Q2','Q3','Q4'].forEach((q) => {
    const qT = filtered.filter((t) => t.quadrant === q);
    const qD = qT.filter((t) => t.completed).length;
    const qP = qT.length === 0 ? 0 : Math.round((qD / qT.length) * 100);
    document.getElementById(`stat-${q}`).textContent     = `${qD}/${qT.length}`;
    document.getElementById(`bar-${q}`).style.width      = `${qP}%`;
  });

  updateQ2Chart(filtered);
  generateCoachingFeedback(completed);
}

function getFilteredTasksForDashboard() {
  if (dashboardTab === 'daily') {
    const today = getTodayStr();
    return tasks.filter((t) => t.createdAt.slice(0, 10) === today || (t.completedAt && t.completedAt.slice(0, 10) === today));
  }
  const { start, end } = getWeekRange();
  return tasks.filter((t) => {
    const cDate = t.createdAt.slice(0, 10);
    const dDate = t.completedAt ? t.completedAt.slice(0, 10) : '';
    return (cDate >= start && cDate <= end) || (dDate >= start && dDate <= end);
  });
}

function updateQ2Chart(filteredTasks) {
  const completed = filteredTasks.filter((t) => t.completed);
  const total = completed.length;
  const counts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  completed.forEach((t) => counts[t.quadrant]++);

  const q2Pct = total === 0 ? 0 : Math.round((counts.Q2 / total) * 100);
  document.getElementById('q2-pct-label').textContent = `${q2Pct}%`;
  document.getElementById('q2-desc').textContent = total === 0 ? '완료 작업 없음' : `완료 ${total}개 기준`;

  const chartData = {
    labels: ['Q1 긴급+중요','Q2 중요+여유','Q3 긴급+덜중요','Q4 제거대상'],
    datasets: [{
      data: [counts.Q1, counts.Q2, counts.Q3, counts.Q4],
      backgroundColor: ['#f87171','#60a5fa','#facc15','#d1d5db'],
      borderColor: '#fff',
      borderWidth: 2,
      hoverOffset: 4
    }],
  };

  const ctx = document.getElementById('q2-chart').getContext('2d');
  if (q2Chart) {
    q2Chart.data = chartData;
    q2Chart.update();
  } else {
    q2Chart = new Chart(ctx, {
      type: 'doughnut',
      data: chartData,
      options: {
        responsive: true,
        maintainAspectRatio: true,
        cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => {
                const v = c.parsed;
                const s = c.dataset.data.reduce((a,b)=>a+b,0);
                return ` ${c.label}: ${v}개 (${s===0?0:Math.round((v/s)*100)}%)`;
              }
            }
          },
        },
        animation: { duration: 400 },
      },
    });
  }
}


/* ============================================================
   11. 📦 지난 완료 기록 아카이브 (접이식)
============================================================ */

function renderCompletedArchive() {
  const completedTasks = tasks
    .filter((t) => t.completed && t.completedAt)
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));

  document.getElementById('archive-count').textContent = `${completedTasks.length}개`;
  const listEl = document.getElementById('archive-list');

  if (completedTasks.length === 0) {
    listEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-4">완료된 작업이 없습니다.</p>`;
    return;
  }

  listEl.innerHTML = completedTasks.map((t) => `
    <div class="archive-item-card ${t.quadrant.toLowerCase()}" data-id="${t.id}">
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm font-medium text-gray-800 break-words flex-1">${escapeHtml(t.title)}</span>
        <span class="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-semibold flex-shrink-0">
          ${QUADRANT_INFO[t.quadrant].label.split(' ')[0]}
        </span>
      </div>
      <div class="flex items-center justify-between text-xs text-gray-400 mt-1">
        <span>✅ ${formatCompletedAt(t.completedAt)}</span>
        ${t.memo ? `<span class="text-gray-500 font-medium truncate max-w-[150px]">📝 ${escapeHtml(t.memo)}</span>` : ''}
      </div>
    </div>
  `).join('');

  listEl.querySelectorAll('.archive-item-card[data-id]').forEach((el) => {
    el.addEventListener('click', () => openDetailPanel(el.dataset.id));
  });
}

function initArchiveToggle() {
  const toggleBtn = document.getElementById('archive-toggle-btn');
  const contentEl = document.getElementById('archive-content');
  const chevronEl = document.getElementById('archive-chevron');

  toggleBtn.addEventListener('click', () => {
    isArchiveOpen = !isArchiveOpen;
    contentEl.classList.toggle('hidden', !isArchiveOpen);
    chevronEl.textContent = isArchiveOpen ? '▲ 접기' : '▼ 펼치기';
  });
}


/* ============================================================
   12. 📅 [NEW] 캘린더 플래너 (드래그 앤 드롭 일정 배정 시스템)
============================================================ */

/** 캘린더 플래너 전체 화면 다시 그리기 */
function renderCalendarPlanner() {
  renderCalendarDrawer();
  if (calViewMode === 'month') {
    renderCalendarMonth();
  } else {
    renderCalendarWeek();
  }
  updateCalPeriodLabel();
}

/** 툴바의 연/월/주간 라벨 업데이트 */
function updateCalPeriodLabel() {
  const d = calBaseDate;
  const labelEl = document.getElementById('cal-period-label');
  if (calViewMode === 'month') {
    labelEl.textContent = `${d.getFullYear()}년 ${d.getMonth()+1}월`;
  } else {
    const { start, end } = getWeekRange(d);
    labelEl.textContent = `${start.slice(5)} ~ ${end.slice(5)}`;
  }
}

/** 1) 좌측 할 일 블록 서랍 렌더링 */
function renderCalendarDrawer() {
  const drawerListEl = document.getElementById('cal-drawer-list');
  const countEl      = document.getElementById('cal-drawer-count');

  // 미완료 작업들을 사분면 필터에 맞게 분류
  let drawerTasks = tasks.filter((t) => !t.completed);
  if (calFilterQuadrant !== 'ALL') {
    drawerTasks = drawerTasks.filter((t) => t.quadrant === calFilterQuadrant);
  }

  // 아직 날짜가 미배정된 작업(Unscheduled)을 맨 위로, 그 다음 배정된 작업 정렬
  drawerTasks.sort((a, b) => {
    if (!a.scheduledDate && b.scheduledDate) return -1;
    if (a.scheduledDate && !b.scheduledDate) return 1;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  countEl.textContent = `${drawerTasks.length}개`;

  if (drawerTasks.length === 0) {
    drawerListEl.innerHTML = `<p class="text-xs text-gray-400 text-center py-6">대기 중인 할 일이 없습니다.</p>`;
    return;
  }

  drawerListEl.innerHTML = '';

  drawerTasks.forEach((task) => {
    const block = document.createElement('div');
    const isSelected = (selectedBlockIdForMobile === task.id);
    block.className = `drawer-task-block ${task.quadrant.toLowerCase()} ${isSelected ? 'block-selected' : ''}`;
    block.dataset.id = task.id;
    block.draggable  = true;

    const dueHtml = task.dueDate
      ? `<span class="due-badge ${dueBadgeType} text-[10px]">${formatDueDate(task.dueDate)}</span>` : '';
    
    const schedHtml = task.scheduledDate
      ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-semibold">🗓️ 배정됨: ${task.scheduledDate.slice(5)}</span>`
      : `<span class="text-[10px] text-gray-400">미배정</span>`;

    const subtaskBadge = (task.subtasks && task.subtasks.length > 0)
      ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600 font-medium">☑️ ${task.subtasks.filter((s) => s.completed).length}/${task.subtasks.length}</span>`
      : '';

    block.innerHTML = `
      <div class="flex items-start justify-between gap-1">
        <div class="min-w-0 flex-1">
          <p class="text-xs font-semibold text-gray-800 break-words leading-tight">${escapeHtml(task.title)}</p>
          <div class="mt-1 flex flex-wrap gap-1 items-center">
            ${dueHtml}
            ${schedHtml}
            ${subtaskBadge}
          </div>
        </div>
        <span class="text-gray-300 text-xs select-none">⠿</span>
      </div>
    `;

    // ── PC 드래그 시작 이벤트 ──
    block.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', task.id);
      e.dataTransfer.effectAllowed = 'move';
      block.classList.add('dragging');
    });
    block.addEventListener('dragend', () => {
      block.classList.remove('dragging');
      document.querySelectorAll('.cal-month-cell, .cal-week-col').forEach((c) => c.classList.remove('drag-over'));
    });

    // ── 모바일 터치 배정을 위한 탭(클릭) 선택 이벤트 ──
    block.addEventListener('click', () => {
      if (selectedBlockIdForMobile === task.id) {
        selectedBlockIdForMobile = null;
        showToast('선택 해제되었습니다.');
      } else {
        selectedBlockIdForMobile = task.id;
        showToast(`📌 "${task.title}" 선택됨! 캘린더의 원하는 날짜를 터치하세요.`);
      }
      renderCalendarDrawer();
    });

    drawerListEl.appendChild(block);
  });
}

/** 2) 우측 월간 캘린더 렌더링 */
function renderCalendarMonth() {
  const gridArea = document.getElementById('cal-grid-area');
  const year     = calBaseDate.getFullYear();
  const month    = calBaseDate.getMonth();
  const today    = getTodayStr();

  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month+1, 0);
  const startDow = firstDay.getDay();

  const cells = [];
  // 이전 달 날짜
  for (let i = 0; i < startDow; i++) {
    const d = new Date(year, month, -startDow + i + 1);
    cells.push({ date: toDateStr(d), isCurrentMonth: false });
  }
  // 이번 달 날짜
  for (let d = 1; d <= lastDay.getDate(); d++) {
    cells.push({ date: toDateStr(new Date(year, month, d)), isCurrentMonth: true });
  }
  // 다음 달 날짜 (7의 배수 맞추기)
  while (cells.length % 7 !== 0) {
    const last = new Date(cells[cells.length-1].date);
    last.setDate(last.getDate() + 1);
    cells.push({ date: toDateStr(last), isCurrentMonth: false });
  }

  const dowClasses = ['sunday','','','','','','saturday'];

  let html = `<div class="cal-month-grid grid grid-cols-7 w-full border-t border-l border-gray-200">`;
  DAY_LABELS.forEach((label, i) => {
    html += `<div class="cal-month-header ${dowClasses[i]} text-center py-2 text-xs font-semibold bg-gray-50 border-r border-b border-gray-200">${label}</div>`;
  });

  cells.forEach(({ date, isCurrentMonth }) => {
    const dateObj = parseLocalDate(date);
    const dow     = dateObj.getDay();
    const dayNum  = dateObj.getDate();
    const isToday = date === today;

    let cellCls = 'cal-month-cell cal-drop-zone min-h-[90px] p-1.5 border-r border-b border-gray-200 bg-white flex flex-col transition-colors';
    if (!isCurrentMonth) cellCls += ' other-month bg-gray-50/70 text-gray-300';
    if (isToday)         cellCls += ' today bg-blue-50/50';
    if (dow === 0)       cellCls += ' sunday';
    if (dow === 6)       cellCls += ' saturday';

    html += `
      <div class="${cellCls}" data-date="${date}">
        <div class="cal-date-num font-bold text-xs mb-1 w-5 h-5 flex items-center justify-center rounded-full ${isToday ? 'bg-blue-600 text-white' : 'text-gray-600'}">${dayNum}</div>
        <div class="cal-chips-container flex-1 min-h-[30px]" data-date="${date}"></div>
      </div>
    `;
  });
  html += `</div>`;
  gridArea.innerHTML = html;

  // 각 날짜 칸에 해당하는 할 일들을 축소 칩으로 배치 & 드롭 리스너 바인딩
  gridArea.querySelectorAll('.cal-month-cell').forEach((cell) => {
    const cellDate = cell.dataset.date;
    const chipsContainer = cell.querySelector('.cal-chips-container');

    // 해당 날짜에 실행 배정(scheduledDate)된 작업들
    const cellTasks = tasks.filter((t) => t.scheduledDate === cellDate);
    cellTasks.forEach((task) => {
      const chip = createCalendarChip(task);
      chipsContainer.appendChild(chip);
    });

    // 드래그 오버 & 드롭 바인딩
    bindDropEventsToCell(cell, cellDate);

    // 모바일 클릭 시 원터치 배정 지원
    cell.addEventListener('click', (e) => {
      // 칩 내부 클릭이 아닌 날짜 셀 클릭 시
      if (e.target.closest('.cal-task-chip')) return;
      if (selectedBlockIdForMobile) {
        scheduleTaskDate(selectedBlockIdForMobile, cellDate);
        selectedBlockIdForMobile = null;
        renderCalendarPlanner();
      }
    });
  });
}

/** 3) 우측 주간 캘린더 렌더링 */
function renderCalendarWeek() {
  const gridArea = document.getElementById('cal-grid-area');
  const { monday } = getWeekRange(calBaseDate);
  const today = getTodayStr();
  const dowClasses = ['sunday','','','','','','saturday'];

  let html = `<div class="cal-week-grid grid grid-cols-7 w-full border-t border-l border-gray-200">`;

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = toDateStr(d);
    const dow     = d.getDay();
    const isToday = dateStr === today;

    let hCls = 'cal-week-header py-2 text-center border-b border-r border-gray-200 bg-gray-50';
    if (isToday) hCls += ' today bg-blue-50/60';
    if (dow === 0) hCls += ' sunday text-red-500';
    if (dow === 6) hCls += ' saturday text-blue-500';

    html += `
      <div class="cal-week-col cal-drop-zone min-h-[360px] border-r border-b border-gray-200 flex flex-col bg-white" data-date="${dateStr}">
        <div class="${hCls}">
          <div class="week-day-name text-[11px] font-semibold text-gray-500">${DAY_LABELS[dow]}</div>
          <div class="week-day-num text-sm font-bold mt-0.5 w-6 h-6 mx-auto flex items-center justify-center rounded-full ${isToday ? 'bg-blue-600 text-white' : 'text-gray-700'}">${d.getDate()}</div>
        </div>
        <div class="cal-week-content p-1.5 space-y-1.5 flex-1" data-date="${dateStr}"></div>
      </div>
    `;
  }
  html += `</div>`;
  gridArea.innerHTML = html;

  gridArea.querySelectorAll('.cal-week-col').forEach((col) => {
    const colDate = col.dataset.date;
    const contentEl = col.querySelector('.cal-week-content');

    const colTasks = tasks.filter((t) => t.scheduledDate === colDate);
    colTasks.forEach((task) => {
      const chip = createCalendarChip(task);
      contentEl.appendChild(chip);
    });

    bindDropEventsToCell(col, colDate);

    col.addEventListener('click', (e) => {
      if (e.target.closest('.cal-task-chip')) return;
      if (selectedBlockIdForMobile) {
        scheduleTaskDate(selectedBlockIdForMobile, colDate);
        selectedBlockIdForMobile = null;
        renderCalendarPlanner();
      }
    });
  });
}

/** 캘린더 내부 축소 칩(Chip) DOM 생성 */
function createCalendarChip(task) {
  const chip = document.createElement('div');
  chip.className = `cal-task-chip ${task.quadrant.toLowerCase()} ${task.completed ? 'completed' : ''}`;
  chip.dataset.id = task.id;
  chip.draggable  = true;

  const dueBadgeType = getDueBadgeType(task.dueDate);
  const dueTagHtml = task.dueDate && dueBadgeType === 'overdue'
    ? `<span class="text-[9px] bg-red-500 text-white px-1 rounded font-bold">마감초과</span>`
    : task.dueDate && dueBadgeType === 'today'
    ? `<span class="text-[9px] bg-orange-500 text-white px-1 rounded font-bold">오늘마감</span>`
    : '';

  const subtaskTagHtml = (task.subtasks && task.subtasks.length > 0)
    ? `<span class="text-[9px] text-gray-500 font-medium">☑️${task.subtasks.filter((s) => s.completed).length}/${task.subtasks.length}</span>`
    : '';

  chip.innerHTML = `
    <input type="checkbox" class="task-check mr-1" ${task.completed ? 'checked' : ''} title="완료 처리" />
    <span class="chip-title">${escapeHtml(task.title)}</span>
    ${dueTagHtml}
    ${subtaskTagHtml}
  `;

  // 칩 내부 체크박스
  chip.querySelector('.task-check').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleComplete(task.id);
  });

  // 칩 클릭 시 상세 패널 열기
  chip.addEventListener('click', (e) => {
    e.stopPropagation();
    openDetailPanel(task.id);
  });

  // 칩 자체도 다른 날짜로 드래그 이동 가능!
  chip.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    chip.classList.add('dragging');
  });
  chip.addEventListener('dragend', () => {
    chip.classList.remove('dragging');
    document.querySelectorAll('.cal-drop-zone').forEach((c) => c.classList.remove('drag-over'));
  });

  return chip;
}

/** 날짜 칸 드래그오버 / 드롭 이벤트 바인딩 */
function bindDropEventsToCell(cellEl, targetDateStr) {
  cellEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    cellEl.classList.add('drag-over');
  });
  cellEl.addEventListener('dragleave', (e) => {
    if (!cellEl.contains(e.relatedTarget)) cellEl.classList.remove('drag-over');
  });
  cellEl.addEventListener('drop', (e) => {
    e.preventDefault();
    cellEl.classList.remove('drag-over');
    const taskId = e.dataTransfer.getData('text/plain');
    if (!taskId) return;
    scheduleTaskDate(taskId, targetDateStr);
  });
}

function prevCalendarPeriod() {
  if (calViewMode === 'month') calBaseDate.setMonth(calBaseDate.getMonth() - 1);
  else calBaseDate.setDate(calBaseDate.getDate() - 7);
  renderCalendarPlanner();
  triggerSwipeAnimation('cal-swipe-right');
}

function nextCalendarPeriod() {
  if (calViewMode === 'month') calBaseDate.setMonth(calBaseDate.getMonth() + 1);
  else calBaseDate.setDate(calBaseDate.getDate() + 7);
  renderCalendarPlanner();
  triggerSwipeAnimation('cal-swipe-left');
}

function triggerSwipeAnimation(animClass) {
  const gridArea = document.getElementById('cal-grid-area');
  if (!gridArea) return;
  gridArea.classList.remove('cal-swipe-left', 'cal-swipe-right');
  void gridArea.offsetWidth; // 리플로우 트리거
  gridArea.classList.add(animClass);
}

/** 캘린더 플래너 UI 이벤트 초기화 (모바일 스와이프 포함) */
function initCalendarPlannerEvents() {
  // 월간/주간 전환
  document.getElementById('cal-view-month').addEventListener('click', () => {
    calViewMode = 'month';
    setCalViewBtn('month');
    renderCalendarPlanner();
  });
  document.getElementById('cal-view-week').addEventListener('click', () => {
    calViewMode = 'week';
    setCalViewBtn('week');
    renderCalendarPlanner();
  });

  // 네비게이션 버튼 (클릭 시 애니메이션 포함)
  document.getElementById('cal-prev').addEventListener('click', prevCalendarPeriod);
  document.getElementById('cal-next').addEventListener('click', nextCalendarPeriod);
  document.getElementById('cal-today').addEventListener('click', () => {
    calBaseDate = new Date();
    renderCalendarPlanner();
  });

  // ── [모바일 터치 스와이프 제스처] ──
  // 손가락으로 왼쪽/오른쪽으로 밀면 이전/다음 달(주)로 부드럽게 이동
  let touchStartX = 0;
  let touchStartY = 0;
  const gridArea = document.getElementById('cal-grid-area');

  gridArea.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });

  gridArea.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].clientX;
    const touchEndY = e.changedTouches[0].clientY;
    const diffX = touchEndX - touchStartX;
    const diffY = touchEndY - touchStartY;

    // 수평 이동 거리가 40px 이상이고, 수직 이동보다 명확히 클 때만 스와이프 인정
    if (Math.abs(diffX) > 40 && Math.abs(diffX) > Math.abs(diffY) * 1.3) {
      if (diffX < 0) {
        // 왼쪽으로 밀기 (손가락 ←) : 다음 달/주로 이동
        nextCalendarPeriod();
      } else {
        // 오른쪽으로 밀기 (손가락 →) : 이전 달/주로 이동
        prevCalendarPeriod();
      }
    }
  }, { passive: true });

  // 서랍 사분면 필터 버튼
  document.querySelectorAll('.drawer-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.drawer-filter-btn').forEach((b) => {
        b.classList.remove('active', 'bg-white', 'text-gray-800', 'shadow-sm');
      });
      btn.classList.add('active', 'bg-white', 'text-gray-800', 'shadow-sm');
      calFilterQuadrant = btn.dataset.filter;
      renderCalendarDrawer();
    });
  });
}

function setCalViewBtn(mode) {
  ['month', 'week'].forEach((m) => {
    const btn = document.getElementById(`cal-view-${m}`);
    const active = (m === mode);
    btn.classList.toggle('active', active);
    btn.classList.toggle('bg-white', active);
    btn.classList.toggle('text-blue-600', active);
    btn.classList.toggle('shadow-sm', active);
    btn.classList.toggle('text-gray-500', !active);
  });
}


/* ============================================================
   13. 상세 편집 슬라이드 패널
============================================================ */

let currentEditingSubtasks = [];

function renderDetailSubtasks() {
  const listEl     = document.getElementById('detail-subtasks-list');
  const progressEl = document.getElementById('detail-subtask-progress');
  const barBgEl    = document.getElementById('detail-subtask-bar-bg');
  const barFillEl  = document.getElementById('detail-subtask-bar-fill');
  if (!listEl) return;

  listEl.innerHTML = '';
  const total = currentEditingSubtasks.length;

  if (total === 0) {
    if (progressEl) progressEl.classList.add('hidden');
    if (barBgEl)    barBgEl.classList.add('hidden');
    listEl.innerHTML = '<p class="text-xs text-gray-400 py-1">등록된 세부 단계가 없습니다. 아래 입력창에서 추가해보세요.</p>';
    return;
  }

  const completedCount = currentEditingSubtasks.filter((s) => s.completed).length;
  const pct = Math.round((completedCount / total) * 100);

  if (progressEl) {
    progressEl.textContent = `${completedCount}/${total} (${pct}%)`;
    progressEl.classList.remove('hidden');
    if (completedCount === total) {
      progressEl.className = 'text-[11px] font-semibold text-green-600 bg-green-50 px-2 py-0.5 rounded-full';
    } else {
      progressEl.className = 'text-[11px] font-semibold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full';
    }
  }

  if (barBgEl && barFillEl) {
    barBgEl.classList.remove('hidden');
    barFillEl.style.width = `${pct}%`;
    barFillEl.className = `h-1.5 rounded-full transition-all duration-300 ${completedCount === total ? 'bg-green-500' : 'bg-blue-600'}`;
  }

  currentEditingSubtasks.forEach((subtask) => {
    const itemEl = document.createElement('div');
    itemEl.className = `subtask-item ${subtask.completed ? 'completed' : ''}`;
    itemEl.innerHTML = `
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <input type="checkbox" class="subtask-checkbox cursor-pointer" ${subtask.completed ? 'checked' : ''} />
        <span class="text-xs text-gray-700 break-words leading-tight">${escapeHtml(subtask.text)}</span>
      </div>
      <button type="button" class="btn-del-subtask text-gray-400 hover:text-red-500 text-xs px-1 transition-colors" title="단계 삭제">✕</button>
    `;

    // 체크박스 토글
    itemEl.querySelector('.subtask-checkbox').addEventListener('change', (e) => {
      subtask.completed = e.target.checked;
      renderDetailSubtasks();
    });

    // 단계 삭제 버튼
    itemEl.querySelector('.btn-del-subtask').addEventListener('click', () => {
      currentEditingSubtasks = currentEditingSubtasks.filter((s) => s.id !== subtask.id);
      renderDetailSubtasks();
    });

    listEl.appendChild(itemEl);
  });
}

function addSubtaskFromInput() {
  const inputEl = document.getElementById('detail-subtask-input');
  if (!inputEl) return;
  const text = inputEl.value.trim();
  if (!text) return;

  currentEditingSubtasks.push({
    id: generateId(),
    text,
    completed: false,
  });

  inputEl.value = '';
  renderDetailSubtasks();
  inputEl.focus();
}

function openDetailPanel(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  openPanelTaskId = taskId;

  document.getElementById('detail-title').value     = task.title || '';
  document.getElementById('detail-quadrant').value  = task.quadrant || 'Q1';
  document.getElementById('detail-due').value       = task.dueDate || '';
  document.getElementById('detail-scheduled').value = task.scheduledDate || '';
  document.getElementById('detail-memo').value      = task.memo || '';

  // 서브태스크 복제 및 렌더링
  currentEditingSubtasks = Array.isArray(task.subtasks)
    ? JSON.parse(JSON.stringify(task.subtasks))
    : [];
  renderDetailSubtasks();
  const subtaskInput = document.getElementById('detail-subtask-input');
  if (subtaskInput) subtaskInput.value = '';

  const badge = document.getElementById('detail-quadrant-badge');
  badge.textContent = QUADRANT_INFO[task.quadrant].label;
  badge.className   = `text-xs font-semibold px-3 py-1 rounded-full ${QUADRANT_INFO[task.quadrant].badgeClass}`;

  document.getElementById('detail-meta').textContent = `생성: ${formatCompletedAt(task.createdAt) || task.createdAt.slice(0,10)}`;
  document.getElementById('detail-completed-at').textContent = task.completedAt ? `✅ 완료: ${formatCompletedAt(task.completedAt)}` : '';

  document.getElementById('detail-quadrant').onchange = () => {
    const q = document.getElementById('detail-quadrant').value;
    badge.textContent = QUADRANT_INFO[q].label;
    badge.className   = `text-xs font-semibold px-3 py-1 rounded-full ${QUADRANT_INFO[q].badgeClass}`;
  };

  document.getElementById('detail-panel').classList.add('open');
  document.getElementById('detail-overlay').classList.add('active');
}

function closeDetailPanel() {
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('detail-overlay').classList.remove('active');
  openPanelTaskId = null;
  currentEditingSubtasks = [];
}

async function saveDetailPanel() {
  if (!openPanelTaskId) return;
  const newTitle = document.getElementById('detail-title').value.trim();
  if (!newTitle) { showToast('⚠️ 제목을 입력해주세요.', 'warning'); return; }

  await updateTask(openPanelTaskId, {
    title:         newTitle,
    quadrant:      document.getElementById('detail-quadrant').value,
    dueDate:       document.getElementById('detail-due').value || null,
    scheduledDate: document.getElementById('detail-scheduled').value || null,
    subtasks:      currentEditingSubtasks, // 세부 체크리스트 저장
    memo:          document.getElementById('detail-memo').value.trim(),
  });

  closeDetailPanel();
  showToast('💾 저장되었습니다.');
}

function initDetailPanel() {
  document.getElementById('detail-btn-close').addEventListener('click', closeDetailPanel);
  document.getElementById('detail-overlay').addEventListener('click', closeDetailPanel);
  document.getElementById('detail-btn-save').addEventListener('click', saveDetailPanel);
  document.getElementById('detail-btn-delete').addEventListener('click', () => { if (openPanelTaskId) deleteTask(openPanelTaskId); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && openPanelTaskId) closeDetailPanel(); });

  // 세부 단계 추가 이벤트 바인딩
  const addSubtaskBtn = document.getElementById('detail-subtask-add-btn');
  if (addSubtaskBtn) addSubtaskBtn.addEventListener('click', addSubtaskFromInput);

  const subtaskInput = document.getElementById('detail-subtask-input');
  if (subtaskInput) {
    subtaskInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addSubtaskFromInput();
      }
    });
  }
}

/* ============================================================
   14. 🎁 나에게 주는 선물 & 노는 계획 (Play & Reward Lounge)
============================================================ */

function dbToReward(row) {
  return {
    id:          row.id,
    title:       row.title,
    condition:   row.condition || '',
    targetDate:  row.target_date || null,
    completed:   row.completed || false,
    completedAt: row.completed_at || null,
    createdAt:   row.created_at || new Date().toISOString(),
  };
}

function rewardToDb(reward) {
  return {
    id:           reward.id,
    user_id:      currentUser ? currentUser.id : null,
    title:        reward.title,
    condition:    reward.condition || '',
    target_date:  reward.targetDate || null,
    completed:    reward.completed,
    completed_at: reward.completedAt || null,
    created_at:   reward.createdAt,
  };
}

// ── 로컬 스토리지 Fallback ──
function loadLocalRewards() {
  try {
    const raw = localStorage.getItem('eisenhower_rewards');
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function saveLocalRewards(list) {
  try {
    localStorage.setItem('eisenhower_rewards', JSON.stringify(list));
  } catch (e) {}
}

async function fetchRewardsFromDB() {
  if (!currentUser) return loadLocalRewards();
  try {
    const { data, error } = await supabaseClient
      .from('rewards')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) {
      console.warn('rewards 테이블 조회 실패(로컬스토리지 보존):', error.message);
      return loadLocalRewards();
    }
    const list = (data || []).map(dbToReward);
    saveLocalRewards(list);
    return list;
  } catch (e) {
    return loadLocalRewards();
  }
}

async function addReward() {
  const titleEl = document.getElementById('input-reward-title');
  const condEl  = document.getElementById('input-reward-condition');
  const dateEl  = document.getElementById('input-reward-date');

  const title = titleEl.value.trim();
  if (!title) {
    showToast('⚠️ 선물/놀기 계획 제목을 입력해주세요.', 'warning');
    titleEl.focus();
    return;
  }

  const newReward = {
    id:          generateId(),
    title,
    condition:   condEl.value.trim(),
    targetDate:  dateEl.value || null,
    completed:   false,
    completedAt: null,
    createdAt:   new Date().toISOString(),
  };

  rewards.unshift(newReward);
  saveLocalRewards(rewards);
  renderRewards();

  titleEl.value = '';
  condEl.value  = '';
  dateEl.value  = '';
  document.getElementById('reward-add-form').classList.add('hidden');

  showToast(`🎁 "${title}" 등록되었습니다! 꼭 신나게 즐기세요!`);

  if (currentUser) {
    try {
      await supabaseClient.from('rewards').insert([rewardToDb(newReward)]);
    } catch (e) {
      console.warn('선물 DB 저장 실패 (로컬 유지됨):', e);
    }
  }
}

async function toggleRewardComplete(rewardId) {
  const reward = rewards.find((r) => r.id === rewardId);
  if (!reward) return;

  reward.completed   = !reward.completed;
  reward.completedAt = reward.completed ? new Date().toISOString() : null;

  saveLocalRewards(rewards);
  renderRewards();

  if (reward.completed) {
    launchConfetti();
    showToast(`🎉 "${reward.title}" 선물 즐기기 완료! 수고한 나에게 박수! 👏`);
  } else {
    showToast(`선물 즐기기가 다시 대기 상태로 변경되었습니다.`);
  }

  if (currentUser) {
    try {
      await supabaseClient.from('rewards').update({
        completed:    reward.completed,
        completed_at: reward.completedAt,
      }).eq('id', rewardId);
    } catch (e) {
      console.warn('선물 상태 갱신 실패:', e);
    }
  }
}

async function deleteReward(rewardId) {
  const reward = rewards.find((r) => r.id === rewardId);
  if (!reward) return;
  if (!confirm(`"${reward.title}" 선물 계획을 삭제할까요?`)) return;

  rewards = rewards.filter((r) => r.id !== rewardId);
  saveLocalRewards(rewards);
  renderRewards();
  showToast('🗑️ 삭제되었습니다.');

  if (currentUser) {
    try {
      await supabaseClient.from('rewards').delete().eq('id', rewardId);
    } catch (e) {
      console.warn('선물 삭제 실패:', e);
    }
  }
}

function renderRewards() {
  const gridEl  = document.getElementById('rewards-grid');
  const badgeEl = document.getElementById('rewards-count-badge');
  if (!gridEl) return;

  gridEl.innerHTML = '';
  const activeRewards = rewards.filter((r) => !r.completed);
  const doneRewards   = rewards.filter((r) => r.completed);

  if (badgeEl) {
    badgeEl.textContent = `${activeRewards.length}개 대기 중`;
  }

  if (rewards.length === 0) {
    gridEl.innerHTML = `
      <div class="col-span-full py-6 text-center text-xs text-amber-700/60 bg-white/70 rounded-xl border border-dashed border-amber-200">
        ✨ 등록된 선물이 없습니다. 열심히 일한 나에게 줄 보상이나 주말 놀기 계획을 등록해보세요!
      </div>
    `;
    return;
  }

  // 대기 중인 선물 먼저, 완료된 선물은 뒤에 정렬
  const sorted = [...activeRewards, ...doneRewards];

  sorted.forEach((reward) => {
    const card = document.createElement('div');
    card.className = `reward-card ${reward.completed ? 'completed' : ''}`;

    const dateHtml = reward.targetDate
      ? `<span class="text-[11px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-medium">🗓️ ${reward.targetDate}</span>` : '';

    const condHtml = reward.condition
      ? `<p class="text-xs text-amber-700 font-medium mt-1">🎯 조건: ${escapeHtml(reward.condition)}</p>` : '';

    const completedHtml = reward.completed
      ? `<p class="text-[11px] text-green-600 font-semibold mt-1">🎉 즐기기 완료! (${reward.completedAt ? reward.completedAt.slice(0,10) : ''})</p>` : '';

    card.innerHTML = `
      <div class="flex items-start justify-between gap-1.5 mb-1.5">
        <h3 class="text-sm font-bold text-gray-800 break-words leading-snug flex-1 ${reward.completed ? 'line-through text-gray-400' : ''}">
          ${escapeHtml(reward.title)}
        </h3>
        <button class="btn-del-reward text-gray-300 hover:text-red-500 text-xs p-0.5 transition-colors" title="삭제">✕</button>
      </div>
      ${condHtml}
      <div class="mt-2 pt-2 border-t border-amber-100/80 flex items-center justify-between gap-1.5">
        <div class="flex items-center gap-1">
          ${dateHtml}
        </div>
        <button class="btn-complete-reward text-xs font-bold px-2.5 py-1 rounded-lg transition-all shadow-xs active:scale-95 ${reward.completed ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-amber-500 hover:bg-amber-600 text-white'}">
          ${reward.completed ? '다시 대기 ↩️' : '🎉 즐기기 완료!'}
        </button>
      </div>
      ${completedHtml}
    `;

    card.querySelector('.btn-complete-reward').addEventListener('click', () => toggleRewardComplete(reward.id));
    card.querySelector('.btn-del-reward').addEventListener('click', () => deleteReward(reward.id));

    gridEl.appendChild(card);
  });
}

/** 🎊 축하 폭죽 효과 (순수 JS/CSS 파티클) */
function launchConfetti() {
  const colors = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6'];
  const particleCount = 35;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');
    el.className = 'confetti-particle';

    const color = colors[Math.floor(Math.random() * colors.length)];
    const size = Math.floor(Math.random() * 8) + 6;
    const startX = Math.random() * window.innerWidth;
    const startY = window.innerHeight * 0.4 + (Math.random() * 100 - 50);

    const fallX = (Math.random() - 0.5) * 400 + 'px';
    const fallY = (Math.random() * 300 + 200) + 'px';
    const fallRot = (Math.random() * 720 - 360) + 'deg';
    const duration = (Math.random() * 1 + 1.2) + 's';

    el.style.backgroundColor = color;
    el.style.width  = `${size}px`;
    el.style.height = `${size * 0.7}px`;
    el.style.left   = `${startX}px`;
    el.style.top    = `${startY}px`;
    el.style.setProperty('--fall-x', fallX);
    el.style.setProperty('--fall-y', fallY);
    el.style.setProperty('--fall-rot', fallRot);
    el.style.animationDuration = duration;

    document.body.appendChild(el);

    setTimeout(() => {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2500);
  }
}




/* ============================================================
   15. 토스트 알림
============================================================ */

let toastTimer = null;

function showToast(message, type = 'default') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  if (toastTimer) clearTimeout(toastTimer);

  // 알림 종류별 배경 색상 지정
  let bgClass = 'bg-gray-800 text-white';
  if (type === 'error')        bgClass = 'bg-red-600 text-white';
  else if (type === 'warning') bgClass = 'bg-orange-500 text-white';

  toast.className = `fixed bottom-5 right-5 text-sm px-4 py-2.5 rounded-xl shadow-lg z-[60] ${bgClass}`;
  toast.textContent = message;

  // 다음 프레임에서 show 클래스를 붙여 부드럽게 나타나게 함
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // 사용자 요청: 1초(1000ms) 후 자동으로 사라짐
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 1000);
}


/* ============================================================
   16. 메인 탭 전환 & 토글 연동
============================================================ */

function switchMainTab(tab) {
  currentMainTab = tab;
  document.getElementById('view-matrix').classList.toggle('hidden', tab !== 'matrix');
  document.getElementById('view-calendar').classList.toggle('hidden', tab !== 'calendar');

  const matrixBtn = document.getElementById('main-tab-matrix');
  const calBtn    = document.getElementById('main-tab-calendar');

  if (tab === 'matrix') {
    matrixBtn.classList.add('active', 'border-blue-600', 'text-blue-600');
    matrixBtn.classList.remove('border-transparent', 'text-gray-400');
    calBtn.classList.remove('active', 'border-blue-600', 'text-blue-600');
    calBtn.classList.add('border-transparent', 'text-gray-400');
  } else {
    calBtn.classList.add('active', 'border-blue-600', 'text-blue-600');
    calBtn.classList.remove('border-transparent', 'text-gray-400');
    matrixBtn.classList.remove('active', 'border-blue-600', 'text-blue-600');
    matrixBtn.classList.add('border-transparent', 'text-gray-400');
    renderCalendarPlanner();
  }
}

function syncTogglesToQuadrant() {
  const urgentEl    = document.getElementById('toggle-urgent');
  const importantEl = document.getElementById('toggle-important');
  const quadrantEl  = document.getElementById('input-quadrant');
  const calc = () => {
    const u = urgentEl.checked, i = importantEl.checked;
    quadrantEl.value = u&&i ? 'Q1' : !u&&i ? 'Q2' : u&&!i ? 'Q3' : 'Q4';
  };
  urgentEl.addEventListener('change', calc);
  importantEl.addEventListener('change', calc);
  quadrantEl.addEventListener('change', () => {
    const q = quadrantEl.value;
    urgentEl.checked    = (q==='Q1'||q==='Q3');
    importantEl.checked = (q==='Q1'||q==='Q2');
  });
}


/* ============================================================
   17. 앱 초기화
============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // ── 인증 상태 감지 ──
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (session && session.user) {
      currentUser = session.user;
      await loadAndRender();
    } else {
      currentUser = null;
      tasks = [];
      rewards = [];
      showLoginScreen();
    }
  });

  // ── Google 로그인 / 로그아웃 ──
  document.getElementById('btn-google-login').addEventListener('click', signInWithGoogle);
  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (confirm('로그아웃 하시겠어요?')) await signOut();
  });

  // ── 상단 메인 탭 전환 ──
  document.getElementById('main-tab-matrix').addEventListener('click', () => switchMainTab('matrix'));
  document.getElementById('main-tab-calendar').addEventListener('click', () => switchMainTab('calendar'));

  // ── 빠른 추가 ──
  document.getElementById('btn-add').addEventListener('click', addTask);
  document.getElementById('input-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTask(); });

  // ── 나에게 주는 선물 & 노는 계획 (Rewards) 이벤트 ──
  const toggleRewardBtn = document.getElementById('btn-toggle-add-reward');
  const rewardFormEl    = document.getElementById('reward-add-form');
  const cancelRewardBtn = document.getElementById('btn-cancel-reward');
  const saveRewardBtn   = document.getElementById('btn-save-reward');

  if (toggleRewardBtn && rewardFormEl) {
    toggleRewardBtn.addEventListener('click', () => {
      rewardFormEl.classList.toggle('hidden');
      if (!rewardFormEl.classList.contains('hidden')) {
        document.getElementById('input-reward-title').focus();
      }
    });
  }
  if (cancelRewardBtn && rewardFormEl) {
    cancelRewardBtn.addEventListener('click', () => rewardFormEl.classList.add('hidden'));
  }
  if (saveRewardBtn) {
    saveRewardBtn.addEventListener('click', addReward);
  }
  const rewardTitleInput = document.getElementById('input-reward-title');
  if (rewardTitleInput) {
    rewardTitleInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addReward(); });
  }

  // ── 대시보드 일간/주간 탭 ──
  document.getElementById('tab-daily').addEventListener('click', () => {
    dashboardTab = 'daily';
    document.getElementById('tab-daily').classList.add('active','bg-white','text-blue-600','shadow-sm');
    document.getElementById('tab-daily').classList.remove('text-gray-500');
    document.getElementById('tab-weekly').classList.remove('active','bg-white','text-blue-600','shadow-sm');
    document.getElementById('tab-weekly').classList.add('text-gray-500');
    updateDashboard();
  });
  document.getElementById('tab-weekly').addEventListener('click', () => {
    dashboardTab = 'weekly';
    document.getElementById('tab-weekly').classList.add('active','bg-white','text-blue-600','shadow-sm');
    document.getElementById('tab-weekly').classList.remove('text-gray-500');
    document.getElementById('tab-daily').classList.remove('active','bg-white','text-blue-600','shadow-sm');
    document.getElementById('tab-daily').classList.add('text-gray-500');
    updateDashboard();
  });

  // ── 서브 컴포넌트 초기화 ──
  initDetailPanel();
  initArchiveToggle();
  initDragAndDrop();
  initCalendarPlannerEvents();
  syncTogglesToQuadrant();

  console.log('🎯 아이젠하워 플래너 (드래그 앤 드롭 캘린더 & 선물 라운지) 준비 완료!');
});
