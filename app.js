/* ============================================================
   app.js - 아이젠하워 매트릭스 앱 (Phase 1+2 업데이트)

   구성:
   1.  상수 & 유틸리티
   2.  데이터 모델 (localStorage)
   3.  매트릭스 렌더링 (카드 그리기)
   4.  할 일 CRUD
   5.  카드 이벤트 바인딩
   6.  드래그 앤 드롭
   7.  대시보드 & Chart.js
   8.  [NEW] 카드 상세 편집 슬라이드 패널
   9.  [NEW] 히스토리 달력 뷰 (월/주)
   10. Export / Import
   11. 토스트 알림
   12. 앱 초기화
============================================================ */

'use strict';


/* ============================================================
   1. 상수 & 유틸리티
============================================================ */

const STORAGE_KEY = 'eisenhower_tasks';

const QUADRANT_INFO = {
  Q1: { label: 'Q1 🔴 긴급+중요',   emoji: '🔥', badgeClass: 'panel-badge-Q1' },
  Q2: { label: 'Q2 🔵 중요+여유',   emoji: '📅', badgeClass: 'panel-badge-Q2' },
  Q3: { label: 'Q3 🟡 긴급+덜중요', emoji: '🤝', badgeClass: 'panel-badge-Q3' },
  Q4: { label: 'Q4 ⚪ 제거 대상',   emoji: '🗑️', badgeClass: 'panel-badge-Q4' },
};

// 요일 한글 레이블 (0=일, 1=월, ... 6=토)
const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];

/** UUID 생성 */
function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** 오늘 날짜 'YYYY-MM-DD' 반환 */
function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** 이번 주 월요일~일요일 범위 반환 */
function getWeekRange(baseDate = new Date()) {
  const d = new Date(baseDate);
  const day = d.getDay(); // 0=일
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (x) => x.toISOString().slice(0, 10);
  return { start: fmt(monday), end: fmt(sunday), monday, sunday };
}

/** 마감일 배지 타입 반환 */
function getDueBadgeType(dueDateStr) {
  if (!dueDateStr) return null;
  const today = getTodayStr();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  if (dueDateStr < today) return 'overdue';
  if (dueDateStr === today) return 'today';
  if (dueDateStr === tomorrowStr) return 'tomorrow';
  return 'normal';
}

/** 마감일 텍스트 */
function formatDueDate(dueDateStr) {
  if (!dueDateStr) return '';
  const type = getDueBadgeType(dueDateStr);
  if (type === 'overdue')  return `⚠️ ${dueDateStr} (마감 지남)`;
  if (type === 'today')    return `🔔 오늘 마감`;
  if (type === 'tomorrow') return `📌 내일 마감`;
  return `📅 ${dueDateStr}`;
}

/** 완료 시각 포맷 */
function formatCompletedAt(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** XSS 방지용 HTML 이스케이프 */
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/** 날짜 문자열 'YYYY-MM-DD' → Date 객체 (로컬 타임존) */
function parseLocalDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Date → 'YYYY-MM-DD' */
function toDateStr(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth()+1)}-${p(date.getDate())}`;
}


/* ============================================================
   2. 데이터 모델 (localStorage)
============================================================ */

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    console.error('localStorage 불러오기 실패:', e);
    return [];
  }
}

function saveTasks(tasks) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (e) {
    showToast('⚠️ 저장에 실패했습니다.', 'error');
  }
}

// 앱 전체 상태
let tasks = loadTasks();


/* ============================================================
   3. 매트릭스 렌더링
============================================================ */

/** 할 일 카드 DOM 요소 생성 */
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

  // 히스토리 탭이 활성화돼 있으면 히스토리도 갱신
  if (currentMainTab === 'history') renderHistoryView();
}


/* ============================================================
   4. 할 일 CRUD
============================================================ */

function addTask() {
  const titleEl = document.getElementById('input-title');
  const title = titleEl.value.trim();
  if (!title) {
    showToast('⚠️ 할 일 제목을 입력해주세요.', 'warning');
    titleEl.focus();
    return;
  }

  const newTask = {
    id: generateId(),
    title,
    quadrant: document.getElementById('input-quadrant').value,
    dueDate: document.getElementById('input-due').value || null,
    memo: '',          // [NEW] 메모 필드
    completed: false,
    completedAt: null,
    createdAt: new Date().toISOString(),
  };

  tasks.push(newTask);
  saveTasks(tasks);
  renderAll();

  titleEl.value = '';
  document.getElementById('input-due').value = '';
  titleEl.focus();
  showToast(`✅ "${title}" 추가되었습니다.`);
}

function toggleComplete(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  task.completed = !task.completed;
  task.completedAt = task.completed ? new Date().toISOString() : null;
  saveTasks(tasks);
  renderAll();
}

function deleteTask(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (!confirm(`"${task.title}" 을(를) 삭제할까요?`)) return;
  tasks = tasks.filter((t) => t.id !== taskId);
  saveTasks(tasks);
  closeDetailPanel();
  renderAll();
  showToast('🗑️ 삭제되었습니다.');
}

function moveTask(taskId, toQuadrant) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  const from = task.quadrant;
  task.quadrant = toQuadrant;
  saveTasks(tasks);
  renderAll();
  showToast(`↔️ ${from} → ${toQuadrant} 으로 이동했습니다.`);
}

/** 할 일 필드 업데이트 (패널에서 저장 시 사용) */
function updateTask(taskId, fields) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;
  Object.assign(task, fields);
  saveTasks(tasks);
  renderAll();
}


/* ============================================================
   5. 카드 이벤트 바인딩
============================================================ */

function bindCardEvents(card, task) {
  // 완료 체크박스
  card.querySelector('.task-check').addEventListener('change', () => toggleComplete(task.id));

  // 삭제 버튼
  card.querySelector('.btn-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteTask(task.id);
  });

  // 이동 버튼 드롭다운
  card.querySelector('.btn-move').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMoveDropdown(card, task);
  });

  // [NEW] 카드 제목 클릭 → 상세 편집 패널 열기
  card.querySelector('[data-open-panel]').addEventListener('click', (e) => {
    e.stopPropagation();
    openDetailPanel(task.id);
  });

  // 드래그 시작
  card.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => card.classList.add('dragging'), 0);
  });

  // 드래그 종료
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    document.querySelectorAll('.quadrant-panel').forEach((p) => p.classList.remove('drag-over'));
  });
}

function toggleMoveDropdown(card, task) {
  document.querySelectorAll('.move-dropdown').forEach((el) => el.remove());

  const dropdown = document.createElement('div');
  dropdown.className = 'move-dropdown';

  ['Q1', 'Q2', 'Q3', 'Q4'].forEach((q) => {
    const btn = document.createElement('button');
    btn.textContent = QUADRANT_INFO[q].label;
    btn.disabled = (q === task.quadrant);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      moveTask(task.id, q);
      dropdown.remove();
    });
    dropdown.appendChild(btn);
  });

  card.querySelector('.btn-move').parentElement.appendChild(dropdown);

  const closeOnOutside = (e) => {
    if (!dropdown.contains(e.target)) {
      dropdown.remove();
      document.removeEventListener('click', closeOnOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnOutside), 50);
}


/* ============================================================
   6. 드래그 앤 드롭
============================================================ */

function initDragAndDrop() {
  document.querySelectorAll('.quadrant-panel').forEach((panel) => {
    const targetQ = panel.dataset.quadrant;

    panel.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      panel.classList.add('drag-over');
    });

    panel.addEventListener('dragleave', (e) => {
      if (!panel.contains(e.relatedTarget)) panel.classList.remove('drag-over');
    });

    panel.addEventListener('drop', (e) => {
      e.preventDefault();
      panel.classList.remove('drag-over');
      const draggedId = e.dataTransfer.getData('text/plain');
      if (!draggedId) return;
      const task = tasks.find((t) => t.id === draggedId);
      if (!task || task.quadrant === targetQ) return;
      moveTask(draggedId, targetQ);
    });
  });
}


/* ============================================================
   7. 대시보드 & Chart.js
============================================================ */

let q2Chart = null;
let dashboardTab = 'daily';

function updateDashboard() {
  const filtered = getFilteredTasksForDashboard();
  const total = filtered.length;
  const done  = filtered.filter((t) => t.completed).length;
  const pct   = total === 0 ? 0 : Math.round((done / total) * 100);

  document.getElementById('overall-pct').textContent = pct;
  document.getElementById('overall-bar').style.width = `${pct}%`;
  document.getElementById('overall-detail').textContent = `${done}개 완료 / 전체 ${total}개`;

  ['Q1', 'Q2', 'Q3', 'Q4'].forEach((q) => {
    const qT = filtered.filter((t) => t.quadrant === q);
    const qD = qT.filter((t) => t.completed).length;
    const qP = qT.length === 0 ? 0 : Math.round((qD / qT.length) * 100);
    document.getElementById(`stat-${q}`).textContent = `${qD}/${qT.length}`;
    document.getElementById(`bar-${q}`).style.width = `${qP}%`;
  });

  updateQ2Chart(filtered);
}

function getFilteredTasksForDashboard() {
  if (dashboardTab === 'daily') {
    const today = getTodayStr();
    return tasks.filter((t) => t.createdAt.slice(0, 10) === today);
  } else {
    const { start, end } = getWeekRange();
    return tasks.filter((t) => {
      const d = t.createdAt.slice(0, 10);
      return d >= start && d <= end;
    });
  }
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
    labels: ['Q1 긴급+중요', 'Q2 중요+여유', 'Q3 긴급+덜중요', 'Q4 제거대상'],
    datasets: [{
      data: [counts.Q1, counts.Q2, counts.Q3, counts.Q4],
      backgroundColor: ['#f87171','#60a5fa','#facc15','#d1d5db'],
      borderColor: '#ffffff',
      borderWidth: 2,
      hoverOffset: 4,
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
        responsive: true, maintainAspectRatio: true, cutout: '68%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const val = ctx.parsed;
                const sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const p = sum === 0 ? 0 : Math.round((val / sum) * 100);
                return ` ${ctx.label}: ${val}개 (${p}%)`;
              },
            },
          },
        },
        animation: { duration: 400 },
      },
    });
  }
}


/* ============================================================
   8. [NEW] 카드 상세 편집 슬라이드 패널
============================================================ */

// 현재 열려있는 패널의 task ID
let openPanelTaskId = null;

/**
 * 패널을 엽니다. 해당 task의 정보를 패널 폼에 채워 넣습니다.
 */
function openDetailPanel(taskId) {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return;

  openPanelTaskId = taskId;

  // 패널 폼에 데이터 채우기
  document.getElementById('detail-title').value    = task.title || '';
  document.getElementById('detail-quadrant').value = task.quadrant || 'Q1';
  document.getElementById('detail-due').value      = task.dueDate || '';
  document.getElementById('detail-memo').value     = task.memo || '';

  // 사분면 배지 색상 업데이트
  const badge = document.getElementById('detail-quadrant-badge');
  badge.textContent = QUADRANT_INFO[task.quadrant].label;
  badge.className   = `text-xs font-semibold px-3 py-1 rounded-full ${QUADRANT_INFO[task.quadrant].badgeClass}`;

  // 생성 정보
  document.getElementById('detail-meta').textContent =
    `생성: ${formatCompletedAt(task.createdAt) || task.createdAt.slice(0,10)}`;
  document.getElementById('detail-completed-at').textContent = task.completedAt
    ? `✅ 완료: ${formatCompletedAt(task.completedAt)}` : '';

  // 사분면 드롭다운을 변경하면 배지도 실시간 업데이트
  document.getElementById('detail-quadrant').onchange = () => {
    const q = document.getElementById('detail-quadrant').value;
    badge.textContent = QUADRANT_INFO[q].label;
    badge.className   = `text-xs font-semibold px-3 py-1 rounded-full ${QUADRANT_INFO[q].badgeClass}`;
  };

  // 패널 & 오버레이 표시
  document.getElementById('detail-panel').classList.add('open');
  document.getElementById('detail-overlay').classList.add('active');
}

/**
 * 패널을 닫습니다.
 */
function closeDetailPanel() {
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('detail-overlay').classList.remove('active');
  openPanelTaskId = null;
}

/**
 * 패널의 내용을 저장합니다.
 */
function saveDetailPanel() {
  if (!openPanelTaskId) return;

  const newTitle = document.getElementById('detail-title').value.trim();
  if (!newTitle) {
    showToast('⚠️ 제목을 입력해주세요.', 'warning');
    document.getElementById('detail-title').focus();
    return;
  }

  updateTask(openPanelTaskId, {
    title:    newTitle,
    quadrant: document.getElementById('detail-quadrant').value,
    dueDate:  document.getElementById('detail-due').value || null,
    memo:     document.getElementById('detail-memo').value.trim(),
  });

  closeDetailPanel();
  showToast('💾 저장되었습니다.');
}

/** 패널 이벤트 바인딩 */
function initDetailPanel() {
  document.getElementById('detail-btn-close').addEventListener('click', closeDetailPanel);
  document.getElementById('detail-overlay').addEventListener('click', closeDetailPanel);
  document.getElementById('detail-btn-save').addEventListener('click', saveDetailPanel);
  document.getElementById('detail-btn-delete').addEventListener('click', () => {
    if (openPanelTaskId) deleteTask(openPanelTaskId);
  });
  // ESC 키로도 닫기
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openPanelTaskId) closeDetailPanel();
  });
}


/* ============================================================
   9. [NEW] 히스토리 달력 뷰 (월/주)
============================================================ */

// 히스토리 뷰 상태
let historyViewMode = 'month'; // 'month' | 'week'
let historyBaseDate = new Date(); // 현재 표시 중인 날짜 기준
let historySelectedDate = null;  // 클릭된 날짜

/**
 * 히스토리 뷰 전체 렌더링
 */
function renderHistoryView() {
  if (historyViewMode === 'month') {
    renderMonthCalendar();
  } else {
    renderWeekCalendar();
  }
  updateHistoryPeriodLabel();
}

/** 기간 레이블 업데이트 */
function updateHistoryPeriodLabel() {
  const d = historyBaseDate;
  if (historyViewMode === 'month') {
    document.getElementById('history-period-label').textContent =
      `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
  } else {
    const { start, end } = getWeekRange(d);
    document.getElementById('history-period-label').textContent =
      `${start.slice(5)} ~ ${end.slice(5)}`;
  }
}

/**
 * 월 보기 달력 렌더링
 * - 해당 월의 1일부터 말일까지 7×N 그리드로 표시
 * - 각 날짜 칸에 완료된 할 일 수 배지 표시
 */
function renderMonthCalendar() {
  const area = document.getElementById('history-calendar-area');
  const year  = historyBaseDate.getFullYear();
  const month = historyBaseDate.getMonth(); // 0-based
  const today = getTodayStr();

  // 1일과 말일 계산
  const firstDay = new Date(year, month, 1);
  const lastDay  = new Date(year, month + 1, 0);

  // 첫 주 시작 요일 (일요일=0 기준)
  let startDow = firstDay.getDay(); // 0=일

  // 달력 셀 배열: 첫 주 시작 전 빈 칸 + 해당 월 날짜 + 다음 월 채우기
  const cells = [];
  // 이전 달 채우기
  for (let i = 0; i < startDow; i++) {
    const d = new Date(year, month, -startDow + i + 1);
    cells.push({ date: toDateStr(d), isCurrentMonth: false });
  }
  // 이번 달
  for (let d = 1; d <= lastDay.getDate(); d++) {
    cells.push({ date: toDateStr(new Date(year, month, d)), isCurrentMonth: true });
  }
  // 마지막 줄 채우기 (7의 배수가 되도록)
  while (cells.length % 7 !== 0) {
    const last = new Date(cells[cells.length - 1].date);
    last.setDate(last.getDate() + 1);
    cells.push({ date: toDateStr(last), isCurrentMonth: false });
  }

  // 날짜별 완료 할 일 집계
  const completedByDate = getCompletedByDate();

  // HTML 생성
  let html = `<div class="calendar-grid">`;

  // 요일 헤더
  const dowClasses = ['sunday','','','','','','saturday'];
  DAY_LABELS.forEach((label, i) => {
    html += `<div class="calendar-day-header ${dowClasses[i]}">${label}</div>`;
  });

  // 날짜 셀
  cells.forEach(({ date, isCurrentMonth }) => {
    const dateObj = parseLocalDate(date);
    const dow     = dateObj.getDay();
    const dayNum  = dateObj.getDate();
    const isToday = date === today;
    const isSel   = date === historySelectedDate;

    let cellClass = 'calendar-cell';
    if (!isCurrentMonth) cellClass += ' other-month';
    if (isToday)         cellClass += ' today';
    if (isSel)           cellClass += ' selected';
    if (dow === 0)       cellClass += ' sunday';
    if (dow === 6)       cellClass += ' saturday';

    // 완료 배지 (사분면별)
    const counts = completedByDate[date] || {};
    let badgesHtml = '<div class="calendar-dot-area">';
    if (counts.Q1) badgesHtml += `<span class="calendar-task-badge q1">Q1·${counts.Q1}</span>`;
    if (counts.Q2) badgesHtml += `<span class="calendar-task-badge q2">Q2·${counts.Q2}</span>`;
    if (counts.Q3) badgesHtml += `<span class="calendar-task-badge q3">Q3·${counts.Q3}</span>`;
    if (counts.Q4) badgesHtml += `<span class="calendar-task-badge q4">Q4·${counts.Q4}</span>`;
    badgesHtml += '</div>';

    html += `
      <div class="${cellClass}" data-date="${date}">
        <div class="calendar-date-num">${dayNum}</div>
        ${badgesHtml}
      </div>
    `;
  });

  html += `</div>`;
  area.innerHTML = html;

  // 날짜 셀 클릭 이벤트
  area.querySelectorAll('.calendar-cell[data-date]').forEach((cell) => {
    cell.addEventListener('click', () => {
      historySelectedDate = cell.dataset.date;
      renderHistoryView();
      renderDayDetail(cell.dataset.date);
    });
  });

  // 선택된 날짜가 있으면 상세 표시
  if (historySelectedDate) {
    renderDayDetail(historySelectedDate);
  }
}

/**
 * 주 보기 달력 렌더링
 * - 해당 주 7일을 열로 표시
 * - 각 열에 완료된 할 일 카드 나열
 */
function renderWeekCalendar() {
  const area = document.getElementById('history-calendar-area');
  const { monday } = getWeekRange(historyBaseDate);
  const today = getTodayStr();

  const completedByDate = getCompletedByDate();
  const dowClasses = ['sunday','','','','','','saturday'];

  let html = `<div class="week-grid">`;

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dateStr = toDateStr(d);
    const dow     = d.getDay();
    const isToday = dateStr === today;

    let headerClass = 'week-day-header';
    if (isToday) headerClass += ' today';
    if (dow === 0) headerClass += ' sunday';
    if (dow === 6) headerClass += ' saturday';

    // 해당 날 완료 목록
    const dayTasks = tasks.filter((t) =>
      t.completed && t.completedAt && t.completedAt.slice(0, 10) === dateStr
    );

    let tasksHtml = '';
    if (dayTasks.length === 0) {
      tasksHtml = `<div class="week-empty">—</div>`;
    } else {
      dayTasks.forEach((t) => {
        tasksHtml += `
          <div class="week-task-item ${t.quadrant.toLowerCase()}" title="${escapeHtml(t.title)}" data-id="${t.id}">
            ${escapeHtml(t.title.length > 20 ? t.title.slice(0, 20) + '…' : t.title)}
          </div>
        `;
      });
    }

    html += `
      <div class="week-day-col" data-date="${dateStr}">
        <div class="${headerClass}">
          <div class="week-day-name">${DAY_LABELS[dow]}</div>
          <div class="week-day-num">${d.getDate()}</div>
        </div>
        ${tasksHtml}
      </div>
    `;
  }
  html += `</div>`;
  area.innerHTML = html;

  // 주 보기에서 할 일 클릭 → 상세 패널 열기
  area.querySelectorAll('.week-task-item[data-id]').forEach((el) => {
    el.addEventListener('click', () => openDetailPanel(el.dataset.id));
  });

  // 날짜별 상세 패널 (월 보기에서 넘어온 경우 숨기기)
  document.getElementById('history-day-detail').classList.add('hidden');
}

/**
 * 특정 날짜의 완료 항목 상세 목록을 렌더링합니다.
 */
function renderDayDetail(dateStr) {
  const detailEl = document.getElementById('history-day-detail');
  const titleEl  = document.getElementById('history-day-title');
  const listEl   = document.getElementById('history-day-list');

  const dayTasks = tasks.filter((t) =>
    t.completed && t.completedAt && t.completedAt.slice(0, 10) === dateStr
  );

  // 날짜 포맷: 2026년 9월 15일 (월)
  const d = parseLocalDate(dateStr);
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

    // 클릭 → 상세 패널
    listEl.querySelectorAll('[data-id]').forEach((el) => {
      el.addEventListener('click', () => openDetailPanel(el.dataset.id));
    });
  }

  detailEl.classList.remove('hidden');
}

/**
 * 완료된 할 일을 날짜별, 사분면별로 집계합니다.
 * 반환 예: { '2026-09-15': { Q1: 2, Q2: 1, ... }, ... }
 */
function getCompletedByDate() {
  const result = {};
  tasks.forEach((t) => {
    if (!t.completed || !t.completedAt) return;
    const date = t.completedAt.slice(0, 10);
    if (!result[date]) result[date] = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
    result[date][t.quadrant] = (result[date][t.quadrant] || 0) + 1;
  });
  return result;
}

/** 히스토리 뷰 이벤트 초기화 */
function initHistoryView() {
  // 월/주 전환 버튼
  document.getElementById('history-view-month').addEventListener('click', () => {
    historyViewMode = 'month';
    setHistoryViewBtn('month');
    renderHistoryView();
  });
  document.getElementById('history-view-week').addEventListener('click', () => {
    historyViewMode = 'week';
    setHistoryViewBtn('week');
    renderHistoryView();
  });

  // 이전/다음 이동
  document.getElementById('history-prev').addEventListener('click', () => {
    if (historyViewMode === 'month') {
      historyBaseDate.setMonth(historyBaseDate.getMonth() - 1);
    } else {
      historyBaseDate.setDate(historyBaseDate.getDate() - 7);
    }
    historySelectedDate = null;
    document.getElementById('history-day-detail').classList.add('hidden');
    renderHistoryView();
  });
  document.getElementById('history-next').addEventListener('click', () => {
    if (historyViewMode === 'month') {
      historyBaseDate.setMonth(historyBaseDate.getMonth() + 1);
    } else {
      historyBaseDate.setDate(historyBaseDate.getDate() + 7);
    }
    historySelectedDate = null;
    document.getElementById('history-day-detail').classList.add('hidden');
    renderHistoryView();
  });

  // 오늘로
  document.getElementById('history-today').addEventListener('click', () => {
    historyBaseDate = new Date();
    historySelectedDate = getTodayStr();
    renderHistoryView();
    renderDayDetail(historySelectedDate);
  });
}

function setHistoryViewBtn(mode) {
  document.getElementById('history-view-month').classList.toggle('active', mode === 'month');
  document.getElementById('history-view-month').classList.toggle('bg-white', mode === 'month');
  document.getElementById('history-view-month').classList.toggle('text-blue-600', mode === 'month');
  document.getElementById('history-view-month').classList.toggle('shadow-sm', mode === 'month');
  document.getElementById('history-view-month').classList.toggle('text-gray-500', mode !== 'month');

  document.getElementById('history-view-week').classList.toggle('active', mode === 'week');
  document.getElementById('history-view-week').classList.toggle('bg-white', mode === 'week');
  document.getElementById('history-view-week').classList.toggle('text-blue-600', mode === 'week');
  document.getElementById('history-view-week').classList.toggle('shadow-sm', mode === 'week');
  document.getElementById('history-view-week').classList.toggle('text-gray-500', mode !== 'week');
}


/* ============================================================
   10. Export / Import
============================================================ */

function exportTasks() {
  if (tasks.length === 0) {
    showToast('⚠️ 내보낼 할 일이 없습니다.', 'warning');
    return;
  }
  const exportData = {
    exportedAt: new Date().toISOString(),
    version: '2.0',
    count: tasks.length,
    tasks,
  };
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `tasks_${getTodayStr()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast(`📤 ${tasks.length}개 할 일을 내보냈습니다.`);
}

let pendingImportData = null;

function handleImportFile(file) {
  if (!file || !file.name.endsWith('.json')) {
    showToast('⚠️ .json 파일만 가져올 수 있습니다.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!Array.isArray(parsed.tasks)) throw new Error('올바른 형식이 아닙니다.');
      pendingImportData = parsed.tasks;
      document.getElementById('import-modal').classList.add('active');
    } catch (err) {
      showToast('⚠️ 파일 오류: ' + err.message, 'error');
    }
  };
  reader.readAsText(file);
}

function executeImport(mode) {
  if (!pendingImportData) return;
  if (mode === 'merge') {
    const existingIds = new Set(tasks.map((t) => t.id));
    const newItems = pendingImportData.filter((t) => !existingIds.has(t.id));
    tasks = [...tasks, ...newItems];
    showToast(`🔀 ${newItems.length}개 항목이 병합되었습니다.`);
  } else {
    tasks = pendingImportData;
    showToast(`🔄 ${tasks.length}개 항목으로 덮어쓰기 완료.`);
  }
  saveTasks(tasks);
  renderAll();
  document.getElementById('import-modal').classList.remove('active');
  pendingImportData = null;
  document.getElementById('import-file-input').value = '';
}


/* ============================================================
   11. 토스트 알림
============================================================ */

let toastTimer = null;

function showToast(message, type = 'default') {
  const toast = document.getElementById('toast');
  if (toastTimer) clearTimeout(toastTimer);

  toast.className = 'fixed bottom-5 right-5 text-sm px-4 py-2.5 rounded-xl shadow-lg transition-all duration-300 z-[60]';
  if (type === 'error')   toast.classList.add('bg-red-600', 'text-white');
  else if (type === 'warning') toast.classList.add('bg-orange-500', 'text-white');
  else toast.classList.add('bg-gray-800', 'text-white');

  toast.textContent = message;
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}


/* ============================================================
   12. 앱 초기화 (이벤트 바인딩 & 최초 렌더링)
============================================================ */

// 현재 활성화된 메인 탭
let currentMainTab = 'matrix';

/** 메인 탭 전환 */
function switchMainTab(tab) {
  currentMainTab = tab;

  document.getElementById('view-matrix').classList.toggle('hidden', tab !== 'matrix');
  document.getElementById('view-history').classList.toggle('hidden', tab !== 'history');

  document.getElementById('main-tab-matrix').classList.toggle('active', tab === 'matrix');
  document.getElementById('main-tab-matrix').classList.toggle('border-blue-600', tab === 'matrix');
  document.getElementById('main-tab-matrix').classList.toggle('text-blue-600', tab === 'matrix');
  document.getElementById('main-tab-matrix').classList.toggle('border-transparent', tab !== 'matrix');
  document.getElementById('main-tab-matrix').classList.toggle('text-gray-400', tab !== 'matrix');

  document.getElementById('main-tab-history').classList.toggle('active', tab === 'history');
  document.getElementById('main-tab-history').classList.toggle('border-blue-600', tab === 'history');
  document.getElementById('main-tab-history').classList.toggle('text-blue-600', tab === 'history');
  document.getElementById('main-tab-history').classList.toggle('border-transparent', tab !== 'history');
  document.getElementById('main-tab-history').classList.toggle('text-gray-400', tab !== 'history');

  if (tab === 'history') renderHistoryView();
}

/** 긴급/중요 토글 ↔ 사분면 드롭다운 연동 */
function syncTogglesToQuadrant() {
  const urgentEl    = document.getElementById('toggle-urgent');
  const importantEl = document.getElementById('toggle-important');
  const quadrantEl  = document.getElementById('input-quadrant');

  urgentEl.addEventListener('change', () => {
    const u = urgentEl.checked, i = importantEl.checked;
    quadrantEl.value = u && i ? 'Q1' : !u && i ? 'Q2' : u && !i ? 'Q3' : 'Q4';
  });
  importantEl.addEventListener('change', () => {
    const u = urgentEl.checked, i = importantEl.checked;
    quadrantEl.value = u && i ? 'Q1' : !u && i ? 'Q2' : u && !i ? 'Q3' : 'Q4';
  });
  quadrantEl.addEventListener('change', () => {
    const q = quadrantEl.value;
    urgentEl.checked    = (q === 'Q1' || q === 'Q3');
    importantEl.checked = (q === 'Q1' || q === 'Q2');
  });
}

document.addEventListener('DOMContentLoaded', () => {

  // ── 메인 탭 ──
  document.getElementById('main-tab-matrix').addEventListener('click', () => switchMainTab('matrix'));
  document.getElementById('main-tab-history').addEventListener('click', () => switchMainTab('history'));

  // ── 할 일 추가 ──
  document.getElementById('btn-add').addEventListener('click', addTask);
  document.getElementById('input-title').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addTask();
  });

  // ── Export/Import ──
  document.getElementById('btn-export').addEventListener('click', exportTasks);
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-file-input').click();
  });
  document.getElementById('import-file-input').addEventListener('change', (e) => {
    handleImportFile(e.target.files[0]);
  });
  document.getElementById('import-merge').addEventListener('click', () => executeImport('merge'));
  document.getElementById('import-overwrite').addEventListener('click', () => executeImport('overwrite'));
  document.getElementById('import-cancel').addEventListener('click', () => {
    document.getElementById('import-modal').classList.remove('active');
    pendingImportData = null;
    document.getElementById('import-file-input').value = '';
  });
  document.getElementById('import-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      document.getElementById('import-modal').classList.remove('active');
      pendingImportData = null;
    }
  });

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

  // ── 슬라이드 패널 ──
  initDetailPanel();

  // ── 히스토리 뷰 ──
  initHistoryView();

  // ── 긴급/중요 토글 연동 ──
  syncTogglesToQuadrant();

  // ── 드래그 앤 드롭 ──
  initDragAndDrop();

  // ── 최초 렌더링 ──
  renderAll();

  console.log('🎯 아이젠하워 매트릭스 v2 시작!', `총 ${tasks.length}개의 할 일 로드됨`);
});
