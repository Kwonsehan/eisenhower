/* ============================================================
   app.js - 아이젠하워 매트릭스 앱 (Supabase 연동 버전)

   ⚠️ 아래 두 값을 반드시 본인 Supabase 값으로 교체하세요!
      STEP A 완료 후 Supabase → Project Settings → API 에서 복사
============================================================ */

'use strict';


/* ============================================================
   1. Supabase 설정 (← 여기만 바꾸면 됩니다!)
============================================================ */

// ⬇️ 여기에 본인 Supabase URL과 anon key를 붙여넣으세요
const SUPABASE_URL      = 'https://xtuanrjjdzstqzoitesb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh0dWFucmpqZHpzdHF6b2l0ZXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk2MjEyMzgsImV4cCI6MjEwNTE5NzIzOH0.DVjT-eFQQOhMF2bFisdh-INm1EbWMH3-swQ1hKdsxvw';

// Supabase 클라이언트 초기화 (window.supabase와의 변수명 충돌 방지를 위해 supabaseClient 사용)
const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Google OAuth 로그인 후 돌아올 주소 (GitHub Pages URL)
const REDIRECT_URL = 'https://kwonsehan.github.io/eisenhower/';


/* ============================================================
   2. 앱 전역 상태
============================================================ */

let tasks       = [];         // 현재 로드된 할 일 목록
let currentUser = null;       // 현재 로그인한 사용자 정보
let currentMainTab  = 'matrix';
let dashboardTab    = 'daily';
let historyViewMode = 'month';
let historyBaseDate = new Date();
let historySelectedDate = null;
let openPanelTaskId = null;
let q2Chart = null;


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

function toDateStr(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}`;
}

function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}


/* ============================================================
   4. DB ↔ 앱 데이터 변환 함수
   (DB는 snake_case, 앱은 camelCase로 사용합니다)
============================================================ */

/** DB 행(row) → 앱 task 객체 */
function dbToTask(row) {
  return {
    id:          row.id,
    title:       row.title,
    quadrant:    row.quadrant,
    dueDate:     row.due_date   || null,
    memo:        row.memo       || '',
    completed:   row.completed,
    completedAt: row.completed_at || null,
    createdAt:   row.created_at,
  };
}

/** 앱 task 객체 → DB 삽입용 객체 */
function taskToDb(task) {
  return {
    id:           task.id,
    user_id:      currentUser.id,
    title:        task.title,
    quadrant:     task.quadrant,
    due_date:     task.dueDate    || null,
    memo:         task.memo       || '',
    completed:    task.completed,
    completed_at: task.completedAt || null,
    created_at:   task.createdAt,
  };
}


/* ============================================================
   5. Supabase DB CRUD 함수 (비동기)
============================================================ */

/** Supabase에서 내 모든 할 일 불러오기 */
async function fetchTasksFromDB() {
  const { data, error } = await supabaseClient
    .from('tasks')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw error;
  return (data || []).map(dbToTask);
}

/** Supabase에 새 할 일 추가 */
async function insertTaskToDB(task) {
  const { error } = await supabaseClient
    .from('tasks')
    .insert([taskToDb(task)]);
  if (error) throw error;
}

/** Supabase에서 할 일 수정 */
async function updateTaskInDB(taskId, fields) {
  // camelCase → snake_case 변환
  const dbFields = {};
  if (fields.title       !== undefined) dbFields.title        = fields.title;
  if (fields.quadrant    !== undefined) dbFields.quadrant     = fields.quadrant;
  if (fields.dueDate     !== undefined) dbFields.due_date     = fields.dueDate;
  if (fields.memo        !== undefined) dbFields.memo         = fields.memo;
  if (fields.completed   !== undefined) dbFields.completed    = fields.completed;
  if (fields.completedAt !== undefined) dbFields.completed_at = fields.completedAt;

  const { error } = await supabaseClient
    .from('tasks')
    .update(dbFields)
    .eq('id', taskId);
  if (error) throw error;
}

/** Supabase에서 할 일 삭제 */
async function deleteTaskFromDB(taskId) {
  const { error } = await supabaseClient
    .from('tasks')
    .delete()
    .eq('id', taskId);
  if (error) throw error;
}

/** 여러 할 일을 한번에 upsert (Import 기능에 사용) */
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

/** Google OAuth로 로그인 */
async function signInWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: REDIRECT_URL,
    },
  });
  if (error) {
    showToast('⚠️ 로그인 실패: ' + error.message, 'error');
  }
}

/** 로그아웃 */
async function signOut() {
  await supabaseClient.auth.signOut();
  // auth state change 이벤트가 자동으로 로그인 화면으로 전환함
}

/** 로그인 화면 표시 */
function showLoginScreen() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-body').classList.add('hidden');
  document.getElementById('loading-screen').classList.add('hidden');
  tasks = [];
}

/** 앱 본체 표시 (로그인 완료 후) */
function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-body').classList.remove('hidden');
  document.getElementById('loading-screen').classList.add('hidden');

  // 사용자 정보 표시
  if (currentUser) {
    const avatarEl = document.getElementById('user-avatar');
    const nameEl   = document.getElementById('user-name');
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

/** 로딩 화면 표시 */
function showLoadingScreen() {
  document.getElementById('loading-screen').classList.remove('hidden');
}


/* ============================================================
   7. 앱 데이터 로드 & 렌더링
============================================================ */

/** DB에서 할 일 불러와서 화면 갱신 */
async function loadAndRender() {
  showLoadingScreen();
  try {
    tasks = await fetchTasksFromDB();
    showApp();
    renderAll();
  } catch (e) {
    console.error('데이터 로드 실패:', e);
    showToast('⚠️ 데이터를 불러오지 못했습니다.', 'error');
    showApp();
    renderAll();
  }
}

/** 할 일 카드 DOM 생성 */
function createTaskCard(task) {
  const card = document.createElement('div');
  const hasMemo = task.memo && task.memo.trim().length > 0;
  card.className = `task-card ${task.completed ? 'completed' : ''} ${hasMemo ? 'has-memo' : ''}`;
  card.dataset.id = task.id;
  card.draggable = true;

  const dueBadgeType = getDueBadgeType(task.dueDate);
  const dueBadgeHtml = task.dueDate
    ? `<span class="due-badge ${dueBadgeType}">${formatDueDate(task.dueDate)}</span>` : '';
  const completedHtml = task.completed && task.completedAt
    ? `<p class="text-xs text-gray-400 mt-1">✅ ${formatCompletedAt(task.completedAt)} 완료</p>` : '';

  card.innerHTML = `
    <div class="flex items-start gap-2">
      <input type="checkbox" class="task-check mt-0.5 flex-shrink-0" ${task.completed ? 'checked' : ''} title="완료로 표시" />
      <div class="flex-1 min-w-0 cursor-pointer" data-open-panel>
        <p class="task-title text-sm font-medium text-gray-800 leading-snug break-words">${escapeHtml(task.title)}</p>
        ${dueBadgeHtml ? `<div class="mt-1">${dueBadgeHtml}</div>` : ''}
        ${completedHtml}
      </div>
      <div class="flex items-center gap-1 flex-shrink-0 relative">
        <button class="btn-move text-gray-400 hover:text-blue-500 p-1 rounded hover:bg-blue-50 transition-colors text-xs" title="이동">↔️</button>
        <button class="btn-delete text-gray-400 hover:text-red-500 p-1 rounded hover:bg-red-50 transition-colors text-xs" title="삭제">🗑️</button>
      </div>
    </div>
  `;
  return card;
}

/** 전체 화면 다시 그리기 */
function renderAll() {
  ['Q1', 'Q2', 'Q3', 'Q4'].forEach((q) => {
    const listEl = document.getElementById(`list-${q}`);
    listEl.innerHTML = '';
    const qTasks = tasks.filter((t) => t.quadrant === q);

    if (qTasks.length === 0) {
      listEl.innerHTML = `<div class="empty-hint">할 일을 추가하거나<br>드래그해서 놓으세요</div>`;
    } else {
      qTasks.forEach((task) => {
        const card = createTaskCard(task);
        bindCardEvents(card, task);
        listEl.appendChild(card);
      });
    }
    document.getElementById(`count-${q}`).textContent = `${qTasks.length}개`;
  });

  updateDashboard();
  if (currentMainTab === 'history') renderHistoryView();
}


/* ============================================================
   8. 할 일 CRUD (앱 레벨 - DB와 로컬 상태 동시 업데이트)
============================================================ */

/** 새 할 일 추가 */
async function addTask() {
  const titleEl = document.getElementById('input-title');
  const title   = titleEl.value.trim();
  if (!title) {
    showToast('⚠️ 할 일 제목을 입력해주세요.', 'warning');
    titleEl.focus();
    return;
  }

  const newTask = {
    id:          generateId(),
    title,
    quadrant:    document.getElementById('input-quadrant').value,
    dueDate:     document.getElementById('input-due').value || null,
    memo:        '',
    completed:   false,
    completedAt: null,
    createdAt:   new Date().toISOString(),
  };

  // 1) 로컬에 즉시 추가 (빠른 UI 반응)
  tasks.push(newTask);
  renderAll();

  // 2) 입력창 초기화
  titleEl.value = '';
  document.getElementById('input-due').value = '';
  titleEl.focus();

  // 3) DB에 저장
  try {
    await insertTaskToDB(newTask);
    showToast(`✅ "${title}" 추가되었습니다.`);
  } catch (e) {
    // DB 저장 실패 시 로컬에서도 제거하고 에러 표시
    tasks = tasks.filter((t) => t.id !== newTask.id);
    renderAll();
    showToast('⚠️ 저장 실패. 인터넷 연결을 확인하세요.', 'error');
  }
}

/** 완료 토글 */
async function toggleComplete(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  // 1) 로컬 즉시 반영
  task.completed   = !task.completed;
  task.completedAt = task.completed ? new Date().toISOString() : null;
  renderAll();

  // 2) DB 업데이트
  try {
    await updateTaskInDB(taskId, {
      completed:   task.completed,
      completedAt: task.completedAt,
    });
  } catch (e) {
    // 실패 시 되돌리기
    task.completed   = !task.completed;
    task.completedAt = task.completed ? new Date().toISOString() : null;
    renderAll();
    showToast('⚠️ 저장 실패.', 'error');
  }
}

/** 할 일 삭제 */
async function deleteTask(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (!confirm(`"${task.title}" 을(를) 삭제할까요?`)) return;

  // 1) 로컬 즉시 제거
  tasks = tasks.filter((t) => t.id !== taskId);
  closeDetailPanel();
  renderAll();

  // 2) DB 삭제
  try {
    await deleteTaskFromDB(taskId);
    showToast('🗑️ 삭제되었습니다.');
  } catch (e) {
    // 실패 시 DB에서 다시 불러오기
    await loadAndRender();
    showToast('⚠️ 삭제 실패.', 'error');
  }
}

/** 사분면 이동 */
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

/** 상세 패널에서 저장 (여러 필드 동시 수정) */
async function updateTask(taskId, fields) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  const prev = { ...task }; // 실패 시 복원용
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


/* ============================================================
   9. 카드 이벤트 바인딩
============================================================ */

function bindCardEvents(card, task) {
  card.querySelector('.task-check').addEventListener('change', () => toggleComplete(task.id));
  card.querySelector('.btn-delete').addEventListener('click', (e) => { e.stopPropagation(); deleteTask(task.id); });
  card.querySelector('.btn-move').addEventListener('click', (e) => { e.stopPropagation(); toggleMoveDropdown(card, task); });
  card.querySelector('[data-open-panel]').addEventListener('click', (e) => { e.stopPropagation(); openDetailPanel(task.id); });

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


/* ============================================================
   10. 드래그 앤 드롭
============================================================ */

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
   11. 대시보드 & Chart.js
============================================================ */

function updateDashboard() {
  const filtered = getFilteredTasksForDashboard();
  const total = filtered.length;
  const done  = filtered.filter((t) => t.completed).length;
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
}

function getFilteredTasksForDashboard() {
  if (dashboardTab === 'daily') {
    const today = getTodayStr();
    return tasks.filter((t) => t.createdAt.slice(0, 10) === today);
  }
  const { start, end } = getWeekRange();
  return tasks.filter((t) => { const d = t.createdAt.slice(0, 10); return d >= start && d <= end; });
}

function updateQ2Chart(filteredTasks) {
  const completed = filteredTasks.filter((t) => t.completed);
  const total = completed.length;
  const counts = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  completed.forEach((t) => counts[t.quadrant]++);

  const q2Pct = total === 0 ? 0 : Math.round((counts.Q2 / total) * 100);
  document.getElementById('q2-pct-label').textContent = `${q2Pct}%`;
  document.getElementById('q2-desc').textContent = total === 0 ? '완료된 작업이 없습니다' : `완료 작업 ${total}개 기준`;

  const chartData = {
    labels: ['Q1 긴급+중요','Q2 중요+여유','Q3 긴급+덜중요','Q4 제거대상'],
    datasets: [{ data: [counts.Q1,counts.Q2,counts.Q3,counts.Q4], backgroundColor: ['#f87171','#60a5fa','#facc15','#d1d5db'], borderColor: '#fff', borderWidth: 2, hoverOffset: 4 }],
  };

  const ctx = document.getElementById('q2-chart').getContext('2d');
  if (q2Chart) { q2Chart.data = chartData; q2Chart.update(); }
  else {
    q2Chart = new Chart(ctx, {
      type: 'doughnut', data: chartData,
      options: {
        responsive: true, maintainAspectRatio: true, cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => { const v = c.parsed; const s = c.dataset.data.reduce((a,b)=>a+b,0); return ` ${c.label}: ${v}개 (${s===0?0:Math.round((v/s)*100)}%)`; } } },
        },
        animation: { duration: 400 },
      },
    });
  }
}


/* ============================================================
   12. 카드 상세 편집 슬라이드 패널
============================================================ */

function openDetailPanel(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  openPanelTaskId = taskId;

  document.getElementById('detail-title').value    = task.title || '';
  document.getElementById('detail-quadrant').value = task.quadrant || 'Q1';
  document.getElementById('detail-due').value      = task.dueDate || '';
  document.getElementById('detail-memo').value     = task.memo || '';

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
}

async function saveDetailPanel() {
  if (!openPanelTaskId) return;
  const newTitle = document.getElementById('detail-title').value.trim();
  if (!newTitle) { showToast('⚠️ 제목을 입력해주세요.', 'warning'); return; }

  await updateTask(openPanelTaskId, {
    title:    newTitle,
    quadrant: document.getElementById('detail-quadrant').value,
    dueDate:  document.getElementById('detail-due').value || null,
    memo:     document.getElementById('detail-memo').value.trim(),
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
}


/* ============================================================
   13. 히스토리 달력 뷰 (월/주)
============================================================ */

function renderHistoryView() {
  if (historyViewMode === 'month') renderMonthCalendar();
  else renderWeekCalendar();
  updateHistoryPeriodLabel();
}

function updateHistoryPeriodLabel() {
  const d = historyBaseDate;
  if (historyViewMode === 'month') {
    document.getElementById('history-period-label').textContent = `${d.getFullYear()}년 ${d.getMonth()+1}월`;
  } else {
    const { start, end } = getWeekRange(d);
    document.getElementById('history-period-label').textContent = `${start.slice(5)} ~ ${end.slice(5)}`;
  }
}

function getCompletedByDate() {
  const result = {};
  tasks.forEach((t) => {
    if (!t.completed || !t.completedAt) return;
    const date = t.completedAt.slice(0, 10);
    if (!result[date]) result[date] = { Q1:0, Q2:0, Q3:0, Q4:0 };
    result[date][t.quadrant] = (result[date][t.quadrant] || 0) + 1;
  });
  return result;
}

function renderMonthCalendar() {
  const area  = document.getElementById('history-calendar-area');
  const year  = historyBaseDate.getFullYear();
  const month = historyBaseDate.getMonth();
  const today = getTodayStr();

  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month+1, 0);
  let startDow   = firstDay.getDay();

  const cells = [];
  for (let i = 0; i < startDow; i++) {
    const d = new Date(year, month, -startDow+i+1);
    cells.push({ date: toDateStr(d), isCurrentMonth: false });
  }
  for (let d = 1; d <= lastDay.getDate(); d++) cells.push({ date: toDateStr(new Date(year,month,d)), isCurrentMonth: true });
  while (cells.length % 7 !== 0) {
    const last = new Date(cells[cells.length-1].date);
    last.setDate(last.getDate()+1);
    cells.push({ date: toDateStr(last), isCurrentMonth: false });
  }

  const completedByDate = getCompletedByDate();
  const dowClasses = ['sunday','','','','','','saturday'];
  let html = `<div class="calendar-grid">`;
  DAY_LABELS.forEach((label, i) => { html += `<div class="calendar-day-header ${dowClasses[i]}">${label}</div>`; });

  cells.forEach(({ date, isCurrentMonth }) => {
    const dateObj = parseLocalDate(date);
    const dow     = dateObj.getDay();
    const dayNum  = dateObj.getDate();
    const isToday = date === today;
    const isSel   = date === historySelectedDate;
    let cls = 'calendar-cell';
    if (!isCurrentMonth) cls += ' other-month';
    if (isToday)         cls += ' today';
    if (isSel)           cls += ' selected';
    if (dow === 0)       cls += ' sunday';
    if (dow === 6)       cls += ' saturday';

    const counts = completedByDate[date] || {};
    let badges = '<div class="calendar-dot-area">';
    if (counts.Q1) badges += `<span class="calendar-task-badge q1">Q1·${counts.Q1}</span>`;
    if (counts.Q2) badges += `<span class="calendar-task-badge q2">Q2·${counts.Q2}</span>`;
    if (counts.Q3) badges += `<span class="calendar-task-badge q3">Q3·${counts.Q3}</span>`;
    if (counts.Q4) badges += `<span class="calendar-task-badge q4">Q4·${counts.Q4}</span>`;
    badges += '</div>';

    html += `<div class="${cls}" data-date="${date}"><div class="calendar-date-num">${dayNum}</div>${badges}</div>`;
  });
  html += `</div>`;
  area.innerHTML = html;

  area.querySelectorAll('.calendar-cell[data-date]').forEach((cell) => {
    cell.addEventListener('click', () => { historySelectedDate = cell.dataset.date; renderHistoryView(); renderDayDetail(cell.dataset.date); });
  });
  if (historySelectedDate) renderDayDetail(historySelectedDate);
}

function renderWeekCalendar() {
  const area = document.getElementById('history-calendar-area');
  const { monday } = getWeekRange(historyBaseDate);
  const today = getTodayStr();
  const dowClasses = ['sunday','','','','','','saturday'];

  let html = `<div class="week-grid">`;
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday); d.setDate(monday.getDate()+i);
    const dateStr = toDateStr(d);
    const dow     = d.getDay();
    const isToday = dateStr === today;
    let hCls = 'week-day-header';
    if (isToday) hCls += ' today';
    if (dow===0) hCls += ' sunday';
    if (dow===6) hCls += ' saturday';

    const dayTasks = tasks.filter((t) => t.completed && t.completedAt && t.completedAt.slice(0,10) === dateStr);
    let tasksHtml = dayTasks.length === 0
      ? `<div class="week-empty">—</div>`
      : dayTasks.map((t) => `<div class="week-task-item ${t.quadrant.toLowerCase()}" data-id="${t.id}" title="${escapeHtml(t.title)}">${escapeHtml(t.title.length > 20 ? t.title.slice(0,20)+'…' : t.title)}</div>`).join('');

    html += `<div class="week-day-col" data-date="${dateStr}"><div class="${hCls}"><div class="week-day-name">${DAY_LABELS[dow]}</div><div class="week-day-num">${d.getDate()}</div></div>${tasksHtml}</div>`;
  }
  html += `</div>`;
  area.innerHTML = html;
  area.querySelectorAll('.week-task-item[data-id]').forEach((el) => { el.addEventListener('click', () => openDetailPanel(el.dataset.id)); });
  document.getElementById('history-day-detail').classList.add('hidden');
}

function renderDayDetail(dateStr) {
  const detailEl = document.getElementById('history-day-detail');
  const titleEl  = document.getElementById('history-day-title');
  const listEl   = document.getElementById('history-day-list');

  const dayTasks = tasks.filter((t) => t.completed && t.completedAt && t.completedAt.slice(0,10) === dateStr);
  const d   = parseLocalDate(dateStr);
  const dow = ['일','월','화','수','목','금','토'][d.getDay()];
  titleEl.textContent = `📌 ${d.getFullYear()}년 ${d.getMonth()+1}월 ${d.getDate()}일 (${dow}) 완료 항목`;

  if (dayTasks.length === 0) {
    listEl.innerHTML = `<p class="text-sm text-gray-400 text-center py-4">완료된 항목이 없습니다.</p>`;
  } else {
    listEl.innerHTML = dayTasks.map((t) => `
      <div class="history-task-card ${t.quadrant.toLowerCase()} cursor-pointer hover:opacity-80 transition-opacity" data-id="${t.id}">
        <div class="flex items-center justify-between">
          <span class="font-medium text-gray-800">${escapeHtml(t.title)}</span>
          <span class="text-xs px-2 py-0.5 rounded-full bg-white/70 text-gray-500">${QUADRANT_INFO[t.quadrant].label.split(' ')[0]}</span>
        </div>
        <p class="text-xs text-gray-400 mt-1">✅ ${formatCompletedAt(t.completedAt)}</p>
        ${t.memo ? `<p class="text-xs text-gray-500 mt-1 truncate">📝 ${escapeHtml(t.memo)}</p>` : ''}
      </div>
    `).join('');
    listEl.querySelectorAll('[data-id]').forEach((el) => { el.addEventListener('click', () => openDetailPanel(el.dataset.id)); });
  }
  detailEl.classList.remove('hidden');
}

function initHistoryView() {
  document.getElementById('history-view-month').addEventListener('click', () => { historyViewMode = 'month'; setHistoryViewBtn('month'); renderHistoryView(); });
  document.getElementById('history-view-week').addEventListener('click', () => { historyViewMode = 'week'; setHistoryViewBtn('week'); renderHistoryView(); });
  document.getElementById('history-prev').addEventListener('click', () => {
    if (historyViewMode === 'month') historyBaseDate.setMonth(historyBaseDate.getMonth()-1);
    else historyBaseDate.setDate(historyBaseDate.getDate()-7);
    historySelectedDate = null;
    document.getElementById('history-day-detail').classList.add('hidden');
    renderHistoryView();
  });
  document.getElementById('history-next').addEventListener('click', () => {
    if (historyViewMode === 'month') historyBaseDate.setMonth(historyBaseDate.getMonth()+1);
    else historyBaseDate.setDate(historyBaseDate.getDate()+7);
    historySelectedDate = null;
    document.getElementById('history-day-detail').classList.add('hidden');
    renderHistoryView();
  });
  document.getElementById('history-today').addEventListener('click', () => {
    historyBaseDate = new Date(); historySelectedDate = getTodayStr();
    renderHistoryView(); renderDayDetail(historySelectedDate);
  });
}

function setHistoryViewBtn(mode) {
  ['month','week'].forEach((m) => {
    const btn = document.getElementById(`history-view-${m}`);
    const active = (m === mode);
    btn.classList.toggle('active', active);
    btn.classList.toggle('bg-white', active);
    btn.classList.toggle('text-blue-600', active);
    btn.classList.toggle('shadow-sm', active);
    btn.classList.toggle('text-gray-500', !active);
  });
}


/* ============================================================
   14. Export / Import
============================================================ */

function exportTasks() {
  if (tasks.length === 0) { showToast('⚠️ 내보낼 할 일이 없습니다.', 'warning'); return; }
  const exportData = { exportedAt: new Date().toISOString(), version: '3.0', count: tasks.length, tasks };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href = url; a.download = `tasks_${getTodayStr()}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  showToast(`📤 ${tasks.length}개 할 일을 내보냈습니다.`);
}

let pendingImportData = null;

function handleImportFile(file) {
  if (!file || !file.name.endsWith('.json')) { showToast('⚠️ .json 파일만 가져올 수 있습니다.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!Array.isArray(parsed.tasks)) throw new Error('올바른 형식이 아닙니다.');
      pendingImportData = parsed.tasks;
      document.getElementById('import-modal').classList.add('active');
    } catch (err) { showToast('⚠️ 파일 오류: ' + err.message, 'error'); }
  };
  reader.readAsText(file);
}

async function executeImport(mode) {
  if (!pendingImportData) return;
  let toUpsert = [];

  if (mode === 'merge') {
    const existingIds = new Set(tasks.map((t) => t.id));
    toUpsert = pendingImportData.filter((t) => !existingIds.has(t.id));
    tasks = [...tasks, ...toUpsert];
    showToast(`🔀 ${toUpsert.length}개 항목이 병합되었습니다.`);
  } else {
    toUpsert = pendingImportData;
    // 기존 데이터 전체 삭제 후 교체
    await supabaseClient.from('tasks').delete().eq('user_id', currentUser.id);
    tasks = pendingImportData;
    showToast(`🔄 ${tasks.length}개 항목으로 덮어쓰기 완료.`);
  }

  renderAll();

  try {
    await upsertTasksToDB(toUpsert);
  } catch (e) {
    await loadAndRender();
    showToast('⚠️ 가져오기 중 오류 발생.', 'error');
  }

  document.getElementById('import-modal').classList.remove('active');
  pendingImportData = null;
  document.getElementById('import-file-input').value = '';
}


/* ============================================================
   15. 토스트 알림
============================================================ */

let toastTimer = null;

function showToast(message, type = 'default') {
  const toast = document.getElementById('toast');
  if (toastTimer) clearTimeout(toastTimer);
  toast.className = 'fixed bottom-5 right-5 text-sm px-4 py-2.5 rounded-xl shadow-lg transition-all duration-300 z-[60]';
  if (type === 'error')        toast.classList.add('bg-red-600', 'text-white');
  else if (type === 'warning') toast.classList.add('bg-orange-500', 'text-white');
  else                         toast.classList.add('bg-gray-800', 'text-white');
  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}


/* ============================================================
   16. 메인 탭 & 기타 UI 초기화
============================================================ */

function switchMainTab(tab) {
  currentMainTab = tab;
  document.getElementById('view-matrix').classList.toggle('hidden', tab !== 'matrix');
  document.getElementById('view-history').classList.toggle('hidden', tab !== 'history');
  ['matrix','history'].forEach((t) => {
    const btn = document.getElementById(`main-tab-${t}`);
    const active = (t === tab);
    btn.classList.toggle('active', active);
    btn.classList.toggle('border-blue-600', active);
    btn.classList.toggle('text-blue-600', active);
    btn.classList.toggle('border-transparent', !active);
    btn.classList.toggle('text-gray-400', !active);
  });
  if (tab === 'history') renderHistoryView();
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
   17. 앱 초기화 (진입점)
============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // ── 인증 상태 감지 (로그인/로그아웃 자동 처리) ──
  // Supabase가 로그인 상태를 실시간으로 감지하고 이 함수를 호출합니다.
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (session && session.user) {
      // 로그인 상태
      currentUser = session.user;
      await loadAndRender();
    } else {
      // 로그아웃 상태
      currentUser = null;
      tasks = [];
      showLoginScreen();
    }
  });

  // ── Google 로그인 버튼 ──
  document.getElementById('btn-google-login').addEventListener('click', signInWithGoogle);

  // ── 로그아웃 버튼 ──
  document.getElementById('btn-logout').addEventListener('click', async () => {
    if (confirm('로그아웃 하시겠어요?')) await signOut();
  });

  // ── 할 일 추가 ──
  document.getElementById('btn-add').addEventListener('click', addTask);
  document.getElementById('input-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') addTask(); });

  // ── Export/Import ──
  document.getElementById('btn-export').addEventListener('click', exportTasks);
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file-input').click());
  document.getElementById('import-file-input').addEventListener('change', (e) => handleImportFile(e.target.files[0]));
  document.getElementById('import-merge').addEventListener('click', () => executeImport('merge'));
  document.getElementById('import-overwrite').addEventListener('click', () => executeImport('overwrite'));
  document.getElementById('import-cancel').addEventListener('click', () => {
    document.getElementById('import-modal').classList.remove('active');
    pendingImportData = null;
    document.getElementById('import-file-input').value = '';
  });
  document.getElementById('import-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) { document.getElementById('import-modal').classList.remove('active'); pendingImportData = null; }
  });

  // ── 메인 탭 ──
  document.getElementById('main-tab-matrix').addEventListener('click', () => switchMainTab('matrix'));
  document.getElementById('main-tab-history').addEventListener('click', () => switchMainTab('history'));

  // ── 대시보드 탭 ──
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

  // ── 상세 패널, 히스토리, 드래그앤드롭, 토글 ──
  initDetailPanel();
  initHistoryView();
  initDragAndDrop();
  syncTogglesToQuadrant();

  console.log('🎯 아이젠하워 매트릭스 v3 (Supabase 연동) 시작!');
});
