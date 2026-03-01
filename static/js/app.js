/* ═══════════════════════════════════════════════════════════════
   SPENDLY — Frontend Application v2
   SPA Router, API Client, Chart.js, Auth, Goals, AI Chat,
   Heatmap, Export, Recurring, FX Rates, PWA Budget Alerts
═══════════════════════════════════════════════════════════════ */

const API = '/api';
let state = {
  user: null,
  token: null,
  expenses: [],
  summary: null,
  budgets: [],
  goals: [],
  categories: [],
  charts: {},
  deleteTarget: null,
  deleteType: 'expense',     // 'expense' | 'goal'
  fxRates: {},
  chatHistory: [],
};

/* ─── Currency ─────────────────────────────────────────────── */
const CURRENCY_SYMBOLS = {
  INR: '₹', USD: '$', EUR: '€', GBP: '£',
  JPY: '¥', AUD: 'A$', CAD: 'C$', SGD: 'S$', AED: 'د.إ'
};
function sym() {
  return CURRENCY_SYMBOLS[state.user?.currency || 'INR'] || '₹';
}
function fmt(n) {
  if (n === null || n === undefined) return '—';
  return `${sym()}${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/* ─── HTTP Client ──────────────────────────────────────────── */
async function http(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (state.token) opts.headers['Authorization'] = `Bearer ${state.token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${API}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

/* ─── Toast ────────────────────────────────────────────────── */
let toastTimer;
function showToast(msg, type = 'success') {
  const toast = $('#toast');
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  $('#toast-icon').textContent = icons[type] || '✅';
  $('#toast-msg').textContent = msg;
  toast.classList.remove('hidden', 'hiding');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add('hiding');
    setTimeout(() => toast.classList.add('hidden'), 300);
  }, 3000);
}

/* ─── $() Shorthand ────────────────────────────────────────── */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ─── Auth ─────────────────────────────────────────────────── */
function saveAuth(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('spendly_token', token);
  localStorage.setItem('spendly_user', JSON.stringify(user));
}
function clearAuth() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('spendly_token');
  localStorage.removeItem('spendly_user');
}
function loadAuth() {
  const token = localStorage.getItem('spendly_token');
  const user = localStorage.getItem('spendly_user');
  if (token && user) { state.token = token; state.user = JSON.parse(user); return true; }
  return false;
}
function showApp() {
  $('#auth-screen').classList.add('hidden');
  $('#app-shell').classList.remove('hidden');
  updateSidebarUser();
  navigateTo('dashboard');
}
function showAuth() {
  $('#auth-screen').classList.remove('hidden');
  $('#app-shell').classList.add('hidden');
}
function updateSidebarUser() {
  if (!state.user) return;
  $('#sidebar-user-name').textContent = state.user.name;
  $('#sidebar-user-income').textContent = `${fmt(state.user.monthly_income)} / mo`;
  $('#user-avatar-initials').textContent = state.user.name.charAt(0).toUpperCase();
}

/* ─── Auth Tab Toggle ──────────────────────────────────────── */
$$('.auth-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    $$('.auth-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    $$('.auth-form').forEach(f => f.classList.remove('active'));
    $(`#${target}-form`).classList.add('active');
  });
});
$$('.eye-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const input = $(`#${btn.dataset.target}`);
    input.type = input.type === 'password' ? 'text' : 'password';
  });
});

/* ─── Login ────────────────────────────────────────────────── */
$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#login-btn');
  setLoading(btn, true);
  $('#login-error').classList.add('hidden');
  try {
    const data = await http('POST', '/auth/login', {
      email: $('#login-email').value,
      password: $('#login-password').value,
    });
    saveAuth(data.token, data.user);
    showApp();
  } catch (err) {
    showEl('#login-error', err.message);
  } finally { setLoading(btn, false); }
});

/* ─── Register ─────────────────────────────────────────────── */
$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#register-btn');
  setLoading(btn, true);
  $('#register-error').classList.add('hidden');
  try {
    const data = await http('POST', '/auth/register', {
      name: $('#reg-name').value,
      email: $('#reg-email').value,
      password: $('#reg-password').value,
      monthly_income: parseFloat($('#reg-income').value) || 0,
      currency: $('#reg-currency').value,
    });
    saveAuth(data.token, data.user);
    showApp();
  } catch (err) {
    showEl('#register-error', err.message);
  } finally { setLoading(btn, false); }
});

/* ─── Logout ───────────────────────────────────────────────── */
function logout() {
  clearAuth();
  destroyAllCharts();
  showAuth();
  showToast('Signed out successfully', 'info');
}
$('#logout-btn').addEventListener('click', logout);
$('#settings-logout').addEventListener('click', logout);

/* ─── Router ───────────────────────────────────────────────── */
const PAGE_LOADERS = {
  dashboard: loadDashboard,
  expenses: loadExpenses,
  analytics: loadAnalytics,
  budgets: loadBudgets,
  goals: loadGoals,
  settings: loadSettings,
};
function navigateTo(page) {
  $$('.nav-link').forEach(l => l.classList.remove('active'));
  $$(`.nav-link[data-page="${page}"]`).forEach(l => l.classList.add('active'));
  $$('.page').forEach(p => p.classList.remove('active'));
  $(`#page-${page}`)?.classList.add('active');
  window.location.hash = page;
  if (PAGE_LOADERS[page]) PAGE_LOADERS[page]();
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').style.display = '';
}
$$('.nav-link').forEach(link => {
  link.addEventListener('click', (e) => { e.preventDefault(); navigateTo(link.dataset.page); });
});
$$('[data-page]').forEach(el => {
  if (!el.classList.contains('nav-link')) {
    el.addEventListener('click', (e) => { e.preventDefault(); navigateTo(el.dataset.page); });
  }
});

/* ─── Mobile ───────────────────────────────────────────────── */
$('#hamburger-btn').addEventListener('click', () => {
  const open = $('#sidebar').classList.toggle('open');
  $('#sidebar-overlay').style.display = open ? 'block' : '';
});
$('#sidebar-overlay').addEventListener('click', () => {
  $('#sidebar').classList.remove('open');
  $('#sidebar-overlay').style.display = '';
});
$('#mobile-add-btn').addEventListener('click', () => openExpenseModal());

/* ─── Dashboard ────────────────────────────────────────────── */
async function loadDashboard() {
  updateGreeting();
  try {
    const [summary, expenses] = await Promise.all([
      http('GET', '/analytics/summary'),
      http('GET', '/expenses'),
    ]);
    state.summary = summary;
    state.expenses = expenses;
    renderKPIs(summary);
    renderTrendChart(summary.monthly_trend);
    renderDonutChart(summary.by_category);
    renderInsights(summary.insights);
    renderRecentList(expenses.slice(0, 6));
    checkBudgetAlerts();
  } catch (err) { console.error('Dashboard load error:', err); }
}

function updateGreeting() {
  const h = new Date().getHours();
  const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  $('#dash-greeting').textContent = `${greet}, ${state.user?.name?.split(' ')[0] || 'there'}! Here's your financial overview.`;
}

function renderKPIs(s) {
  $('#kpi-total-spent').textContent = fmt(s.total_spent);
  $('#kpi-savings').textContent = fmt(s.savings);
  const pctEl = $('#kpi-savings-pct');
  pctEl.textContent = `${s.savings_pct}%`;
  pctEl.style.color = s.savings_pct >= 20 ? 'var(--success)' : s.savings_pct >= 10 ? 'var(--warning)' : 'var(--danger)';
  $('#kpi-prediction').textContent = s.prediction ? fmt(s.prediction) : 'Need more data';
  $('#kpi-anomalies').textContent = s.anomalies.length;
}

function renderInsights(insights) {
  const el = $('#insights-list');
  if (!insights || !insights.length) {
    el.innerHTML = '<p class="muted-text">Add expenses to get personalized insights.</p>';
    return;
  }
  el.innerHTML = insights.map(i => `<div class="insight-item">${i}</div>`).join('');
}

function renderRecentList(expenses) {
  const el = $('#recent-list');
  if (!expenses.length) { el.innerHTML = '<p class="muted-text">No transactions yet.</p>'; return; }
  el.innerHTML = expenses.map(e => `
    <div class="recent-item">
      <span class="recent-cat-badge">${e.category}</span>
      <span class="recent-notes">${e.notes || e.date}</span>
      <span class="recent-amount">${fmt(e.amount)}</span>
    </div>`).join('');
}

/* ─── Charts ───────────────────────────────────────────────── */
const CHART_COLORS = [
  '#7c3aed', '#06b6d4', '#f472b6', '#f59e0b', '#10b981',
  '#3b82f6', '#a855f7', '#ec4899', '#14b8a6', '#f97316'
];
const CHART_DEFAULTS = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#94a3b8', font: { size: 12 } } } },
};
function destroyChart(key) {
  if (state.charts[key]) { state.charts[key].destroy(); delete state.charts[key]; }
}
function destroyAllCharts() {
  Object.keys(state.charts).forEach(k => destroyChart(k));
}

function renderTrendChart(trend) {
  destroyChart('trend');
  const ctx = $('#trend-chart'); if (!ctx) return;
  if (!trend || !trend.length) { ctx.parentElement.innerHTML = '<p class="muted-text" style="padding:2rem">Not enough data yet.</p>'; return; }
  state.charts.trend = new Chart(ctx, {
    type: 'line',
    data: {
      labels: trend.map(t => t.month),
      datasets: [{
        label: 'Monthly Spending', data: trend.map(t => t.total),
        borderColor: '#7c3aed', backgroundColor: 'rgba(124,58,237,0.12)', borderWidth: 2.5,
        fill: true, tension: 0.4, pointBackgroundColor: '#7c3aed', pointRadius: 5, pointHoverRadius: 8
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: { ...CHART_DEFAULTS.plugins, tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.parsed.y)}` } } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94a3b8', callback: v => `${sym()}${v.toLocaleString()}` } }
      }
    }
  });
}

function renderDonutChart(byCategory) {
  destroyChart('donut');
  const ctx = $('#donut-chart'); if (!ctx) return;
  const labels = Object.keys(byCategory || {});
  if (!labels.length) { ctx.parentElement.innerHTML = '<p class="muted-text" style="padding:2rem">No category data yet.</p>'; return; }
  state.charts.donut = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: labels.map(l => byCategory[l]), backgroundColor: CHART_COLORS, borderColor: '#07080f', borderWidth: 3, hoverOffset: 8 }] },
    options: {
      ...CHART_DEFAULTS, cutout: '68%',
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 12, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.parsed)}` } }
      }
    }
  });
}

/* ─── Expenses Page ────────────────────────────────────────── */
async function loadExpenses() {
  try {
    const expenses = await http('GET', '/expenses');
    state.expenses = expenses;
    populateCategoryFilters();
    renderExpensesTable(expenses);
    if (state.summary?.anomalies?.length) {
      $('#anomaly-panel').classList.remove('hidden');
      $('#anomaly-list').innerHTML = state.summary.anomalies.map(a => `
        <div class="anomaly-item">
          <span class="cat-badge cat-${a.category}">${a.category}</span>
          <span>${a.date}</span><span>${a.notes || '—'}</span>
          <span style="font-weight:700;margin-left:auto">${fmt(a.amount)}</span>
        </div>`).join('');
    }
  } catch (err) { console.error('Expenses load error:', err); }
}

function populateCategoryFilters() {
  const cats = state.categories;
  const selects = ['#expense-filter-cat', '#exp-category', '#budget-category'];
  selects.forEach(sel => {
    const el = $(sel); if (!el) return;
    const isFilter = sel === '#expense-filter-cat';
    el.innerHTML = isFilter ? '<option value="">All Categories</option>' : '';
    cats.forEach(c => { const opt = document.createElement('option'); opt.value = c; opt.textContent = c; el.appendChild(opt); });
  });
}

function renderExpensesTable(expenses) {
  const tbody = $('#expenses-tbody');
  if (!expenses.length) { tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No expenses found. Add one!</td></tr>'; return; }
  tbody.innerHTML = expenses.map(e => `
    <tr>
      <td>${e.date}</td>
      <td><span class="cat-badge cat-${e.category}">${e.category}${e.is_recurring ? ' 🔄' : ''}</span></td>
      <td>${e.notes || '<span class="muted-text">—</span>'}</td>
      <td class="text-right amount-cell">${fmt(e.amount)}</td>
      <td><div class="actions-cell">
        <button class="btn-icon btn-edit" onclick="openEditModal(${e.id})" title="Edit">✏️</button>
        <button class="btn-icon btn-delete" onclick="openDeleteConfirm(${e.id},'expense')" title="Delete">🗑</button>
      </div></td>
    </tr>`).join('');
}

function applyExpenseFilters() {
  const search = $('#expense-search').value.toLowerCase();
  const cat = $('#expense-filter-cat').value;
  const start = $('#filter-start').value;
  const end = $('#filter-end').value;
  const filtered = state.expenses.filter(e => {
    const matchSearch = !search || e.notes?.toLowerCase().includes(search) || e.category.toLowerCase().includes(search);
    const matchCat = !cat || e.category === cat;
    const matchStart = !start || e.date >= start;
    const matchEnd = !end || e.date <= end;
    return matchSearch && matchCat && matchStart && matchEnd;
  });
  renderExpensesTable(filtered);
}
['#expense-search', '#expense-filter-cat', '#filter-start', '#filter-end'].forEach(sel => {
  $(sel)?.addEventListener('input', applyExpenseFilters);
  $(sel)?.addEventListener('change', applyExpenseFilters);
});
$('#clear-filters-btn')?.addEventListener('click', () => {
  $('#expense-search').value = '';
  $('#expense-filter-cat').value = '';
  $('#filter-start').value = '';
  $('#filter-end').value = '';
  renderExpensesTable(state.expenses);
});

/* ─── Export ───────────────────────────────────────────────── */
function downloadFromAPI(path, label) {
  if (!state.token) return;
  const a = document.createElement('a');
  a.href = `${API}${path}`;
  a.setAttribute('download', '');
  // Include auth via fetch + blob
  fetch(`${API}${path}`, { headers: { 'Authorization': `Bearer ${state.token}` } })
    .then(r => r.blob())
    .then(blob => {
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
      showToast(`${label} downloaded!`);
    })
    .catch(() => showToast('Export failed', 'error'));
}
$('#export-csv-btn')?.addEventListener('click', () => downloadFromAPI('/export/csv', 'CSV'));
$('#export-pdf-btn')?.addEventListener('click', () => downloadFromAPI('/export/pdf', 'PDF'));
$('#settings-export-csv')?.addEventListener('click', () => downloadFromAPI('/export/csv', 'CSV'));
$('#settings-export-pdf')?.addEventListener('click', () => downloadFromAPI('/export/pdf', 'PDF'));

/* ─── Expense Modal ────────────────────────────────────────── */
function openExpenseModal(expense = null) {
  populateCategoryFilters();
  const isEdit = !!expense;
  $('#modal-title').textContent = isEdit ? 'Edit Expense' : 'Add Expense';
  $('#edit-expense-id').value = isEdit ? expense.id : '';
  $('#exp-date').value = isEdit ? expense.date : new Date().toISOString().slice(0, 10);
  $('#exp-category').value = isEdit ? expense.category : (state.categories[0] || 'Food');
  $('#exp-amount').value = isEdit ? expense.amount : '';
  $('#exp-notes').value = isEdit ? expense.notes : '';
  $('#exp-recurring').checked = isEdit ? (expense.is_recurring || false) : false;
  $('#exp-recurring-day').value = isEdit ? (expense.recurring_day || '') : '';
  $('#recurring-day-wrap').classList.toggle('hidden', !$('#exp-recurring').checked);
  $('#expense-form-error').classList.add('hidden');
  $('#amount-prefix').textContent = sym();
  $('#expense-modal').classList.remove('hidden');
  $('#exp-amount').focus();
}
function closeExpenseModal() { $('#expense-modal').classList.add('hidden'); }

// Recurring toggle
$('#exp-recurring').addEventListener('change', () => {
  $('#recurring-day-wrap').classList.toggle('hidden', !$('#exp-recurring').checked);
});

$('#add-expense-btn').addEventListener('click', () => openExpenseModal());
$('#add-exp-btn2').addEventListener('click', () => openExpenseModal());
$('#modal-close').addEventListener('click', closeExpenseModal);
$('#modal-cancel').addEventListener('click', closeExpenseModal);
$('#expense-modal').addEventListener('click', e => { if (e.target === $('#expense-modal')) closeExpenseModal(); });

$('#expense-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#expense-submit-btn');
  setLoading(btn, true);
  $('#expense-form-error').classList.add('hidden');
  const id = $('#edit-expense-id').value;
  const isRecurring = $('#exp-recurring').checked;
  const payload = {
    date: $('#exp-date').value,
    category: $('#exp-category').value,
    amount: parseFloat($('#exp-amount').value),
    notes: $('#exp-notes').value,
    is_recurring: isRecurring,
    recurring_day: isRecurring ? parseInt($('#exp-recurring-day').value) || null : null,
  };
  try {
    if (id) { await http('PUT', `/expenses/${id}`, payload); showToast('Expense updated!'); }
    else { await http('POST', '/expenses', payload); showToast('Expense added! 💳'); }
    closeExpenseModal();
    await loadDashboard();
    const page = window.location.hash.replace('#', '') || 'dashboard';
    if (page === 'expenses') await loadExpenses();
    if (page === 'analytics') await loadAnalytics();
    if (page === 'budgets') await loadBudgets();
  } catch (err) {
    showEl('#expense-form-error', err.message);
  } finally { setLoading(btn, false); }
});

function openEditModal(id) {
  const expense = state.expenses.find(e => e.id === id);
  if (expense) openExpenseModal(expense);
}

/* ─── Delete Modal ─────────────────────────────────────────── */
function openDeleteConfirm(id, type = 'expense') {
  state.deleteTarget = id;
  state.deleteType = type;
  $('#delete-modal').classList.remove('hidden');
}
$('#delete-cancel').addEventListener('click', () => { $('#delete-modal').classList.add('hidden'); state.deleteTarget = null; });
$('#delete-confirm').addEventListener('click', async () => {
  if (!state.deleteTarget) return;
  try {
    if (state.deleteType === 'goal') {
      await http('DELETE', `/goals/${state.deleteTarget}`);
      showToast('Goal deleted', 'warning');
      await loadGoals();
    } else {
      await http('DELETE', `/expenses/${state.deleteTarget}`);
      showToast('Expense deleted', 'warning');
      await loadDashboard();
      if (window.location.hash === '#expenses') await loadExpenses();
    }
    $('#delete-modal').classList.add('hidden');
    state.deleteTarget = null;
  } catch (err) { showToast(err.message, 'error'); }
});
$('#delete-modal').addEventListener('click', e => {
  if (e.target === $('#delete-modal')) { $('#delete-modal').classList.add('hidden'); state.deleteTarget = null; }
});

/* ─── Analytics Page ───────────────────────────────────────── */
async function loadAnalytics() {
  try {
    const [summary, weekly] = await Promise.all([
      http('GET', '/analytics/summary'),
      http('GET', '/analytics/weekly'),
    ]);
    state.summary = summary;
    renderBarChart(summary.monthly_trend);
    renderPieChart(summary.by_category);
    renderWeeklyChart(weekly);
    renderVelocity(summary);
    populateHeatmapMonths();
    loadHeatmap();
    const fullInsights = $('#full-insights-list');
    if (!summary.insights.length) {
      fullInsights.innerHTML = '<p class="muted-text">Add more expenses for AI analysis.</p>';
    } else {
      fullInsights.innerHTML = summary.insights.map(i => `<div class="insight-item">${i}</div>`).join('');
    }
  } catch (err) { console.error('Analytics load error:', err); }
}

function renderVelocity(summary) {
  const totalSpent = summary.total_spent || 0;
  const income = state.user?.monthly_income || 0;
  const today = new Date().getDate();
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const dailyRate = totalSpent / (today || 1);
  const safeRate = income > 0 ? income / daysInMonth : null;
  const pct = safeRate ? Math.min((dailyRate / safeRate) * 100, 100) : 0;
  const gauge = $('#gauge-fill');
  if (gauge) {
    gauge.style.width = `${pct}%`;
    gauge.style.background = pct > 90 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--success)';
  }
  const vel = $('#velocity-value');
  if (vel) vel.textContent = fmt(dailyRate) + '/day';
  const sub = $('#velocity-sub');
  if (sub) {
    if (safeRate) {
      sub.textContent = pct > 90 ? '🚨 Overspending pace!' : pct > 60 ? `⚠️ Safe rate: ${fmt(safeRate)}/day` : `✅ Safe rate: ${fmt(safeRate)}/day`;
    } else {
      sub.textContent = 'Set income in settings for pace analysis';
    }
  }
}

function populateHeatmapMonths() {
  const sel = $('#heatmap-month-select');
  if (!sel) return;
  const now = new Date();
  sel.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
    sel.innerHTML += `<option value="${val}">${label}</option>`;
  }
  sel.addEventListener('change', loadHeatmap);
}

async function loadHeatmap() {
  const sel = $('#heatmap-month-select');
  const month = sel?.value || new Date().toISOString().slice(0, 7);
  try {
    const data = await http('GET', `/analytics/heatmap?month=${month}`);
    renderHeatmap(data.data);
  } catch (e) { }
}

function renderHeatmap(dayData) {
  const grid = $('#heatmap-grid');
  if (!grid) return;
  const values = Object.values(dayData).filter(v => v > 0);
  const maxVal = values.length ? Math.max(...values) : 1;
  let html = '';
  for (let d = 1; d <= 31; d++) {
    const val = dayData[d] || 0;
    const intensity = val > 0 ? Math.max(0.15, val / maxVal) : 0;
    const bg = val > 0 ? `rgba(124,58,237,${intensity})` : 'rgba(255,255,255,0.03)';
    const title = val > 0 ? `Day ${d}: ${fmt(val)}` : `Day ${d}: No spending`;
    html += `<div class="heatmap-cell" style="background:${bg}" title="${title}">
      <span class="heatmap-day">${d}</span>
      ${val > 0 ? `<span class="heatmap-amt">${sym()}${val >= 1000 ? (val / 1000).toFixed(1) + 'k' : val.toFixed(0)}</span>` : ''}
    </div>`;
  }
  grid.innerHTML = html;
}

function renderBarChart(trend) {
  destroyChart('bar');
  const ctx = $('#analytics-bar-chart');
  if (!ctx || !trend?.length) return;
  state.charts.bar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: trend.map(t => t.month),
      datasets: [{
        label: 'Spending', data: trend.map(t => t.total),
        backgroundColor: CHART_COLORS.map(c => c + 'cc'), borderColor: CHART_COLORS,
        borderWidth: 1.5, borderRadius: 8, borderSkipped: false
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: { ...CHART_DEFAULTS.plugins, tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.parsed.y)}` } } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94a3b8', callback: v => `${sym()}${v.toLocaleString()}` } }
      }
    }
  });
}

function renderPieChart(byCategory) {
  destroyChart('pie');
  const ctx = $('#analytics-pie-chart'); if (!ctx) return;
  const labels = Object.keys(byCategory || {}); if (!labels.length) return;
  state.charts.pie = new Chart(ctx, {
    type: 'pie',
    data: { labels, datasets: [{ data: labels.map(l => byCategory[l]), backgroundColor: CHART_COLORS, borderColor: '#07080f', borderWidth: 3 }] },
    options: {
      ...CHART_DEFAULTS,
      plugins: {
        legend: { position: 'bottom', labels: { color: '#94a3b8', padding: 10, font: { size: 11 } } },
        tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.parsed)}` } }
      }
    }
  });
}

function renderWeeklyChart(weekly) {
  destroyChart('weekly');
  const ctx = $('#analytics-weekly-chart'); if (!ctx || !weekly?.labels) return;
  state.charts.weekly = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: weekly.labels.map(l => l.slice(0, 3)),
      datasets: [{
        label: 'Avg. Spend', data: weekly.values,
        backgroundColor: 'rgba(6,182,212,0.2)', borderColor: '#06b6d4',
        borderWidth: 2, borderRadius: 8, borderSkipped: false
      }]
    },
    options: {
      ...CHART_DEFAULTS,
      plugins: { ...CHART_DEFAULTS.plugins, tooltip: { callbacks: { label: ctx => ` ${fmt(ctx.parsed.y)}` } } },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94a3b8' } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#94a3b8', callback: v => `${sym()}${v.toLocaleString()}` } }
      }
    }
  });
}

/* ─── Budgets ──────────────────────────────────────────────── */
async function loadBudgets() {
  try {
    const budgets = await http('GET', '/budgets');
    state.budgets = budgets;
    renderBudgets(budgets);
  } catch (err) { console.error('Budgets load error:', err); }
}

function renderBudgets(budgets) {
  const grid = $('#budget-grid');
  if (!budgets.length) {
    grid.innerHTML = `<div class="budget-empty"><div class="empty-icon">🎯</div><h3>No budgets set</h3><p>Set category budgets to control your spending.</p><button class="btn-primary" onclick="document.getElementById('add-budget-btn').click()">Set First Budget</button></div>`;
    return;
  }
  grid.innerHTML = budgets.map(b => {
    const pct = Math.min(b.percentage, 100);
    const cls = pct >= 90 ? 'progress-over' : pct >= 70 ? 'progress-warn' : 'progress-ok';
    const over = b.percentage > 100;
    return `<div class="budget-card">
      <div class="budget-card-header">
        <span class="budget-cat cat-badge cat-${b.category}">${b.category}</span>
        <button class="btn-icon btn-delete" onclick="deleteBudget(${b.id})" title="Remove">🗑</button>
      </div>
      <div class="budget-amounts">Spent: <strong style="color:${over ? 'var(--danger)' : 'var(--text-primary)'}">${fmt(b.spent)}</strong> of <strong>${fmt(b.limit_amount)}</strong>${over ? ' <span style="color:var(--danger);font-weight:700">⚠️ Over!</span>' : ''}</div>
      <div class="progress-bar-bg"><div class="progress-bar-fill ${cls}" style="width:${pct}%"></div></div>
      <div style="margin-top:0.4rem;font-size:0.75rem;color:var(--text-muted)">${b.percentage.toFixed(0)}% used this month</div>
    </div>`;
  }).join('');
}

async function deleteBudget(id) {
  try { await http('DELETE', `/budgets/${id}`); showToast('Budget removed', 'warning'); await loadBudgets(); }
  catch (err) { showToast(err.message, 'error'); }
}

$('#add-budget-btn').addEventListener('click', () => {
  populateCategoryFilters();
  $('#budget-prefix').textContent = sym();
  $('#budget-modal').classList.remove('hidden');
  $('#budget-limit').focus();
});
$('#budget-modal-close').addEventListener('click', () => $('#budget-modal').classList.add('hidden'));
$('#budget-modal-cancel').addEventListener('click', () => $('#budget-modal').classList.add('hidden'));
$('#budget-modal').addEventListener('click', e => { if (e.target === $('#budget-modal')) $('#budget-modal').classList.add('hidden'); });

$('#budget-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await http('POST', '/budgets', { category: $('#budget-category').value, limit_amount: parseFloat($('#budget-limit').value) });
    showToast('Budget saved! 🎯');
    $('#budget-modal').classList.add('hidden');
    $('#budget-form').reset();
    await loadBudgets();
  } catch (err) { showEl('#budget-form-error', err.message); }
});

/* ─── Budget Alerts (Browser Notifications) ────────────────── */
function checkBudgetAlerts() {
  if (!$('#notif-budget-toggle')?.checked) return;
  if (!state.budgets.length) return;
  const overBudget = state.budgets.filter(b => b.percentage >= 80);
  overBudget.forEach(b => {
    const msg = b.percentage >= 100
      ? `🚨 ${b.category} budget exceeded! ${fmt(b.spent)} of ${fmt(b.limit_amount)} spent.`
      : `⚠️ ${b.category} budget at ${b.percentage.toFixed(0)}% — ${fmt(b.limit_amount - b.spent)} remaining.`;
    sendBrowserNotif('Spendly Budget Alert', msg);
  });
}

function sendBrowserNotif(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/manifest.json' });
  }
}

$('#notif-budget-toggle')?.addEventListener('change', async () => {
  if ($('#notif-budget-toggle').checked) {
    if ('Notification' in window && Notification.permission !== 'granted') {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { $('#notif-budget-toggle').checked = false; showToast('Notification permission denied', 'warning'); }
    }
    checkBudgetAlerts();
  }
});

// Load saved email pref
if (localStorage.getItem('spendly_email_alerts') === 'true') {
  if ($('#notif-email-toggle')) $('#notif-email-toggle').checked = true;
}

$('#notif-email-toggle')?.addEventListener('change', (e) => {
  localStorage.setItem('spendly_email_alerts', e.target.checked);
  if (e.target.checked) showToast('Email alerts enabled. Ensure SMTP is configured in .env');
});

$('#test-email-btn')?.addEventListener('click', async () => {
  const btn = $('#test-email-btn');
  const ogText = btn.textContent;
  btn.textContent = 'Sending...';
  btn.disabled = true;
  try {
    const res = await http('POST', '/settings/test-email');
    showToast(res.message || 'Test email sent! Check your inbox.');
  } catch (err) {
    showToast('Send failed: Check SMTP settings in .env', 'error');
    console.error(err);
  } finally {
    btn.textContent = ogText;
    btn.disabled = false;
  }
});

/* ─── Goals ────────────────────────────────────────────────── */
async function loadGoals() {
  try {
    const goals = await http('GET', '/goals');
    state.goals = goals;
    renderGoals(goals);
  } catch (err) { console.error('Goals load error:', err); }
}

function renderGoals(goals) {
  const grid = $('#goals-grid');
  if (!goals.length) {
    grid.innerHTML = `<div class="budget-empty"><div class="empty-icon">🏆</div><h3>No goals set yet</h3><p>Set a financial goal to start tracking your progress.</p><button class="btn-primary" onclick="document.getElementById('add-goal-btn').click()">Set First Goal</button></div>`;
    return;
  }
  grid.innerHTML = goals.map(g => {
    const pct = g.target_amount > 0 ? Math.min((g.saved_amount / g.target_amount) * 100, 100) : 0;
    const remaining = Math.max(0, g.target_amount - g.saved_amount);
    // Estimate completion based on current savings rate
    let projHtml = '';
    if (g.deadline) {
      const daysLeft = Math.ceil((new Date(g.deadline) - new Date()) / 86400000);
      projHtml = daysLeft > 0 ? `<span class="muted-text" style="font-size:0.78rem">📅 ${daysLeft} days to deadline</span>` : `<span style="color:var(--danger);font-size:0.78rem">⏰ Deadline passed</span>`;
    }
    const cls = pct >= 100 ? 'progress-ok' : pct >= 50 ? 'progress-warn' : 'progress-over';
    return `<div class="budget-card goal-card">
      <div class="budget-card-header">
        <span style="font-size:1.6rem">${g.emoji}</span>
        <div style="flex:1;margin-left:0.75rem">
          <strong>${g.name}</strong><br/>
          <span class="muted-text" style="font-size:0.8rem">${fmt(g.saved_amount)} of ${fmt(g.target_amount)}</span>
        </div>
        <div style="display:flex;gap:0.5rem">
          <button class="btn-icon btn-edit" onclick="openGoalEditModal(${g.id})" title="Edit">✏️</button>
          <button class="btn-icon btn-delete" onclick="openDeleteConfirm(${g.id},'goal')" title="Delete">🗑</button>
        </div>
      </div>
      <div class="progress-bar-bg" style="margin-top:0.75rem"><div class="progress-bar-fill ${cls}" style="width:${pct}%"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:0.4rem;font-size:0.78rem;color:var(--text-muted)">
        <span>${pct.toFixed(0)}% complete</span>
        ${pct < 100 ? `<span>${fmt(remaining)} to go</span>` : '<span style="color:var(--success);font-weight:700">🎉 Goal Reached!</span>'}
      </div>
      ${projHtml ? `<div style="margin-top:0.4rem">${projHtml}</div>` : ''}
      <button class="btn-secondary" style="margin-top:0.75rem;width:100%;font-size:0.8rem" onclick="openGoalAddSavings(${g.id}, ${g.saved_amount}, ${g.target_amount})">+ Add Savings</button>
    </div>`;
  }).join('');
}

function openGoalModal(goal = null) {
  const isEdit = !!goal;
  $('#goal-modal-title').textContent = isEdit ? 'Edit Goal' : 'Add Financial Goal';
  $('#edit-goal-id').value = isEdit ? goal.id : '';
  $('#goal-emoji').value = isEdit ? goal.emoji : '🎯';
  $('#goal-name').value = isEdit ? goal.name : '';
  $('#goal-target').value = isEdit ? goal.target_amount : '';
  $('#goal-saved').value = isEdit ? goal.saved_amount : '0';
  $('#goal-deadline').value = isEdit ? (goal.deadline || '') : '';
  $('#goal-prefix').textContent = sym();
  $('#goal-form-error').classList.add('hidden');
  $('#goal-modal').classList.remove('hidden');
  $('#goal-name').focus();
}

function openGoalEditModal(id) {
  const g = state.goals.find(g => g.id === id);
  if (g) openGoalModal(g);
}

function openGoalAddSavings(goalId, currentSaved, target) {
  const add = parseFloat(prompt(`Add savings for this goal:\nCurrently saved: ${fmt(currentSaved)}\nTarget: ${fmt(target)}\n\nEnter amount to add:`));
  if (!isNaN(add) && add > 0) {
    http('PUT', `/goals/${goalId}`, { saved_amount: currentSaved + add })
      .then(() => { showToast(`Added ${fmt(add)} to your goal! 💰`); loadGoals(); })
      .catch(err => showToast(err.message, 'error'));
  }
}

$('#add-goal-btn').addEventListener('click', () => openGoalModal());
$('#goal-modal-close').addEventListener('click', () => $('#goal-modal').classList.add('hidden'));
$('#goal-modal-cancel').addEventListener('click', () => $('#goal-modal').classList.add('hidden'));
$('#goal-modal').addEventListener('click', e => { if (e.target === $('#goal-modal')) $('#goal-modal').classList.add('hidden'); });

$('#goal-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#goal-submit-btn');
  setLoading(btn, true);
  $('#goal-form-error').classList.add('hidden');
  const id = $('#edit-goal-id').value;
  const payload = {
    name: $('#goal-name').value,
    emoji: $('#goal-emoji').value || '🎯',
    target_amount: parseFloat($('#goal-target').value),
    saved_amount: parseFloat($('#goal-saved').value) || 0,
    deadline: $('#goal-deadline').value || null,
  };
  try {
    if (id) { await http('PUT', `/goals/${id}`, payload); showToast('Goal updated! 🏆'); }
    else { await http('POST', '/goals', payload); showToast('Goal created! 🏆'); }
    $('#goal-modal').classList.add('hidden');
    await loadGoals();
  } catch (err) { showEl('#goal-form-error', err.message); }
  finally { setLoading(btn, false); }
});

/* ─── Settings ─────────────────────────────────────────────── */
async function loadSettings() {
  try {
    const profile = await http('GET', '/auth/profile');
    state.user = { ...state.user, ...profile };
    localStorage.setItem('spendly_user', JSON.stringify(state.user));
    $('#settings-name').value = profile.name;
    $('#settings-email').value = profile.email;
    $('#settings-income').value = profile.monthly_income;
    $('#settings-currency').value = profile.currency;
    updateSidebarUser();
  } catch (err) { console.error('Settings load error:', err); }
}

$('#settings-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#settings-success').classList.add('hidden');
  try {
    await http('PUT', '/auth/profile', {
      name: $('#settings-name').value,
      monthly_income: parseFloat($('#settings-income').value) || 0,
      currency: $('#settings-currency').value,
    });
    state.user.name = $('#settings-name').value;
    state.user.monthly_income = parseFloat($('#settings-income').value) || 0;
    state.user.currency = $('#settings-currency').value;
    localStorage.setItem('spendly_user', JSON.stringify(state.user));
    updateSidebarUser();
    showEl('#settings-success', '✅ Profile updated!', true);
    setTimeout(() => $('#settings-success').classList.add('hidden'), 3000);
    showToast('Profile updated!');
  } catch (err) { showToast(err.message, 'error'); }
});

$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#password-error').classList.add('hidden');
  $('#password-success').classList.add('hidden');
  const p1 = $('#new-password').value;
  const p2 = $('#confirm-password').value;
  if (p1 !== p2) { showEl('#password-error', 'Passwords do not match'); return; }
  try {
    await http('PUT', '/auth/profile', { password: p1 });
    $('#new-password').value = ''; $('#confirm-password').value = '';
    showEl('#password-success', '✅ Password updated!', true);
    setTimeout(() => $('#password-success').classList.add('hidden'), 3000);
    showToast('Password updated!');
  } catch (err) { showEl('#password-error', err.message); }
});

/* ─── AI Chat ──────────────────────────────────────────────── */
const chatBubble = $('#chat-bubble');
const chatPanel = $('#chat-panel');
const chatMessages = $('#chat-messages');

chatBubble.addEventListener('click', () => {
  chatPanel.classList.toggle('hidden');
  if (!chatPanel.classList.contains('hidden')) {
    $('#chat-input').focus();
  }
});
$('#chat-close').addEventListener('click', () => chatPanel.classList.add('hidden'));

async function sendChatMessage() {
  const input = $('#chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  input.value = '';

  // Add user bubble
  chatMessages.innerHTML += `<div class="chat-msg chat-user"><span>${escapeHtml(msg)}</span></div>`;
  chatMessages.innerHTML += `<div class="chat-msg chat-bot" id="chat-typing"><span>...</span></div>`;
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    const data = await http('POST', '/chat', { message: msg });
    const typingEl = document.getElementById('chat-typing');
    if (typingEl) typingEl.outerHTML = `<div class="chat-msg chat-bot"><span>${escapeHtml(data.reply)}</span></div>`;
  } catch (err) {
    const typingEl = document.getElementById('chat-typing');
    if (typingEl) typingEl.outerHTML = `<div class="chat-msg chat-bot" style="color:var(--danger)"><span>Sorry, I couldn't reach the server. Try again!</span></div>`;
  }
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

$('#chat-send').addEventListener('click', sendChatMessage);
$('#chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChatMessage(); });

function escapeHtml(str) {
  const d = document.createElement('div');
  d.appendChild(document.createTextNode(str));
  return d.innerHTML;
}

/* ─── FX Rates ─────────────────────────────────────────────── */
async function loadFxRates() {
  try {
    const data = await http('GET', '/fx/rates?base=USD');
    state.fxRates = data.rates || {};
  } catch (e) {
    state.fxRates = { USD: 1, INR: 83.5, EUR: 0.93, GBP: 0.79 };
  }
}

/* ─── Helpers ──────────────────────────────────────────────── */
function setLoading(btn, loading) {
  const txt = btn.querySelector('.btn-text');
  const ldr = btn.querySelector('.btn-loader');
  btn.disabled = loading;
  if (txt) txt.classList.toggle('hidden', loading);
  if (ldr) ldr.classList.toggle('hidden', !loading);
}
function showEl(selector, msg, isSuccess = false) {
  const el = $(selector); if (!el) return;
  el.textContent = msg;
  el.classList.remove('hidden');
}

/* ─── Init ─────────────────────────────────────────────────── */
async function init() {
  try {
    state.categories = await fetch(`${API}/categories`).then(r => r.json());
  } catch { state.categories = ['Food', 'Rent', 'Travel', 'Shopping', 'Bills', 'Health', 'Entertainment', 'Education', 'Other']; }

  if (loadAuth()) {
    showApp();
    // Auto-check recurring expenses in background
    try {
      const result = await http('POST', '/recurring/check');
      if (result.count > 0 && $('#notif-recurring-toggle')?.checked) {
        showToast(`🔄 ${result.count} recurring expense(s) auto-logged!`, 'info');
      }
    } catch (e) { }
    // Load FX rates in background
    loadFxRates();
  } else {
    showAuth();
  }
}

init();
