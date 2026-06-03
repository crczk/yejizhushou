const STORAGE_KEY = 'bank-performance-yunduan-webapp-state-v4';
const OLD_STORAGE_KEYS = ['bank-performance-yunduan-webapp-state-v3', 'bank-performance-gitee-webapp-state-v3', 'bank-performance-gitee-webapp-state-v2', 'bank-performance-gitee-webapp-state-v1'];
const CONFIG_KEY = 'bank-performance-yunduan-config-v1';
const SESSION_KEY = 'bank-performance-yunduan-session-v1';
const API_ROOT = 'https://gitee.com/api/v5';
const DEFAULT_ADMIN_PASSWORD_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9'; // admin123

const COLORS = ['#155EEF', '#079455', '#DC6803', '#7A5AF8', '#0E9384', '#D92D20', '#475467', '#2563eb', '#9333ea', '#0891b2'];

const defaultData = () => {
  const now = new Date().toISOString();
  return {
    version: 5,
    registrationCode: '123456',
    users: [
      {
        id: 'user_admin',
        username: 'admin',
        displayName: '管理员',
        role: 'admin',
        memberId: 'member_admin',
        passwordHash: DEFAULT_ADMIN_PASSWORD_HASH,
        active: true,
        createdAt: now
      }
    ],
    members: [
      { id: 'member_admin', name: '管理员', role: '管理员', active: true, createdAt: now },
      { id: 'member_cuizikun', name: '崔子坤', role: '', active: true, createdAt: now }
    ],
    types: [
      { id: 'type_credit_card', name: '信用卡', unit: '张', color: '#7A5AF8', active: true, sortOrder: 1, ownerMemberId: 'global', scope: 'global' }
    ],
    records: [],
    updatedAt: now
  };
};

let state = loadLocal();
let config = loadConfig();
let session = loadSession();
let page = currentUser() ? 'home' : 'auth';
let remoteSha = '';

function uid() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
function pad2(n) { return String(n).padStart(2, '0'); }
function todayStr(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function monthStr(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function num(n) { return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
function typeById(id) { return state.types.find(t => t.id === id); }
function memberById(id) { return state.members.find(m => m.id === id); }
function typeOwnerId(t) { return t?.ownerMemberId || t?.memberId || ''; }
function isGlobalType(t) { return t?.scope === 'global' || typeOwnerId(t) === 'global'; }
function canMemberUseType(type, memberId) { return !!type && (isGlobalType(type) || typeOwnerId(type) === memberId); }
function typesForMember(memberId, includeInactive = false) {
  return (state.types || [])
    .filter(t => (isGlobalType(t) || (!memberId || typeOwnerId(t) === memberId)) && (includeInactive || t.active !== false))
    .sort((a, b) => (isGlobalType(a) === isGlobalType(b) ? 0 : isGlobalType(a) ? -1 : 1) || Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
}
function visibleTypes(user = currentUser()) {
  if (!user) return [];
  if (isAdmin(user)) return (state.types || []).slice().sort((a, b) => (isGlobalType(a) === isGlobalType(b) ? 0 : isGlobalType(a) ? -1 : 1) || Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  return typesForMember(user.memberId);
}
function typeOwnerName(t) {
  if (isGlobalType(t)) return '管理员公共类型';
  const m = memberById(typeOwnerId(t));
  return m?.name || '未关联成员';
}
function typesForOwnerCount(types, memberId) {
  return (types || []).filter(t => (memberId === 'global' ? isGlobalType(t) : (t.ownerMemberId || t.memberId || '') === memberId)).length;
}
function safeHtml(s) { return String(s ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])); }
function normalizeUsername(v) { return String(v || '').trim().toLowerCase(); }
function nowLocalText() { return new Date().toLocaleString('zh-CN', { hour12: false }); }
function formatDateTime(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return String(v);
  return d.toLocaleString('zh-CN', { hour12: false });
}
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2300);
}
function saveLocal() {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}
function loadLocal() {
  try {
    const v3 = localStorage.getItem(STORAGE_KEY);
    if (v3) return normalizeData(JSON.parse(v3));
    for (const key of OLD_STORAGE_KEYS) {
      const old = localStorage.getItem(key);
      if (old) return normalizeData(JSON.parse(old));
    }
    return defaultData();
  } catch {
    return defaultData();
  }
}
function saveConfig() { localStorage.setItem(CONFIG_KEY, JSON.stringify(config)); }
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(CONFIG_KEY)) || { owner:'', repo:'', branch:'master', path:'data/performance.json', token:'' }; }
  catch { return { owner:'', repo:'', branch:'master', path:'data/performance.json', token:'' }; }
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || {}; }
  catch { return {}; }
}
function saveSession(user) {
  session = { userId: user.id, username: user.username, loginAt: new Date().toISOString() };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
function clearSession() {
  session = {};
  localStorage.removeItem(SESSION_KEY);
}
function currentUser() {
  if (!session.userId) return null;
  const user = (state.users || []).find(u => u.id === session.userId && u.active !== false);
  return user || null;
}
function isAdmin(user = currentUser()) { return !!user && user.role === 'admin'; }
function requireAuth(message = '请先登录') {
  if (currentUser()) return true;
  page = 'auth';
  render();
  showToast(message);
  return false;
}
function sha256Hex(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const k = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const bitLen = bytes.length * 8;
  const withOne = bytes.length + 1;
  const zeroPad = (64 - ((withOne + 8) % 64)) % 64;
  const msg = new Uint8Array(withOne + zeroPad + 8);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(msg.length - 8, Math.floor(bitLen / 0x100000000));
  view.setUint32(msg.length - 4, bitLen >>> 0);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  const w = new Uint32Array(64);
  for (let i = 0; i < msg.length; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(i + j * 4);
    for (let j = 16; j < 64; j++) {
      const s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      const s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let j = 0; j < 64; j++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (hh + s1 + ch + k[j] + w[j]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h = h.map((x, j) => (x + [a,b,c,d,e,f,g,hh][j]) >>> 0);
  }
  return h.map(x => x.toString(16).padStart(8, '0')).join('');
}
async function hashPassword(password) {
  const text = String(password || '');
  if (window.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256Hex(text);
}
function ensureUserMember(user) {
  if (!user) return '';
  if (!user.memberId) user.memberId = `member_${user.id}`;
  if (!state.members.some(m => m.id === user.memberId)) {
    state.members.push({
      id: user.memberId,
      name: user.displayName || user.username || '未命名用户',
      role: user.role === 'admin' ? '管理员' : '成员',
      active: true,
      createdAt: new Date().toISOString()
    });
  }
  return user.memberId;
}
function firstMemberId() { return state.members[0]?.id || ensureDefaultMember(); }
function ensureDefaultMember() {
  const id = uid();
  state.members = [{ id, name: '成员', role: '', active: true, createdAt: new Date().toISOString() }, ...(state.members || [])];
  saveLocal();
  return id;
}
function canAccessRecord(r, user = currentUser()) {
  if (!user) return false;
  return isAdmin(user) || r.memberId === user.memberId;
}
function accessibleRecords(records = state.records, user = currentUser()) {
  if (!user) return [];
  return isAdmin(user) ? records : records.filter(r => r.memberId === user.memberId);
}
function currentMemberFilter() {
  const user = currentUser();
  if (!user) return 'none';
  if (!isAdmin(user)) return user.memberId;
  return window.__memberFilter || 'all';
}
function filterByMember(records, memberId = currentMemberFilter()) {
  const recs = accessibleRecords(records);
  if (isAdmin() && (!memberId || memberId === 'all')) return recs;
  return recs.filter(r => r.memberId === memberId);
}
function dateRecords(date, memberId = currentMemberFilter()) {
  return filterByMember(state.records.filter(r => r.date === date), memberId);
}
function monthRecords(month, memberId = currentMemberFilter()) {
  return filterByMember(state.records.filter(r => r.date && r.date.startsWith(month)), memberId);
}
function typeSummary(records) {
  const map = new Map();
  records.forEach(r => {
    const t = typeById(r.typeId) || { id: r.typeId, name: '已删除类型', unit: '', color: '#98A2B3' };
    if (!map.has(t.id)) map.set(t.id, { type: t, value: 0, count: 0 });
    const item = map.get(t.id);
    item.value += Number(r.value || 0);
    item.count += 1;
  });
  return Array.from(map.values()).sort((a, b) => b.value - a.value || b.count - a.count);
}
function memberSummary(records) {
  const map = new Map();
  records.forEach(r => {
    const m = memberById(r.memberId) || { id: r.memberId, name: '未分配成员', role: '' };
    if (!map.has(m.id)) map.set(m.id, { member: m, count: 0, typeCount: new Set() });
    const item = map.get(m.id);
    item.count += 1;
    item.typeCount.add(r.typeId);
  });
  return Array.from(map.values()).map(x => ({ ...x, typeCount: x.typeCount.size })).sort((a, b) => b.count - a.count);
}
function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function formatValue(value, unit) {
  return `${num(value)}${unit ? ' ' + safeHtml(unit) : ''}`;
}
function renderHeader() {
  const user = currentUser();
  const eyebrow = document.querySelector('.eyebrow');
  const title = document.querySelector('.topbar h1');
  const syncBtn = document.getElementById('syncBtn');
  if (!eyebrow || !title || !syncBtn) return;
  title.textContent = '业绩助手';
  if (!user) {
    eyebrow.textContent = '账号登录 · 权限隔离版';
    syncBtn.style.display = 'none';
    return;
  }
  const roleText = isAdmin(user) ? '管理员' : '个人账号';
  eyebrow.textContent = `${safeHtml(user.displayName || user.username)} · ${roleText}`;
  syncBtn.textContent = '立即同步';
  syncBtn.style.display = '';
}
function render() {
  const user = currentUser();
  document.body.classList.toggle('auth-mode', !user);
  const tabbar = document.querySelector('.tabbar');
  if (tabbar) tabbar.style.display = user ? 'grid' : 'none';
  renderHeader();
  const view = document.getElementById('view');
  if (!user) {
    view.innerHTML = authTpl();
    bindAuthPage();
    return;
  }
  if (page === 'auth') page = 'home';
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  if (page === 'home') view.innerHTML = homeTpl();
  if (page === 'add') view.innerHTML = addTpl();
  if (page === 'day') view.innerHTML = dayTpl();
  if (page === 'month') view.innerHTML = monthTpl();
  if (page === 'settings') view.innerHTML = settingsTpl();
  bindPage();
}
function memberFilterTpl(id = 'memberFilter', includeAll = true, value = currentMemberFilter()) {
  if (!isAdmin()) return `<span class="pill">我的数据</span>`;
  return `<select id="${id}" class="compact-select">
    ${includeAll ? `<option value="all" ${value === 'all' ? 'selected' : ''}>全部成员</option>` : ''}
    ${state.members.map(m => `<option value="${m.id}" ${value === m.id ? 'selected' : ''}>${safeHtml(m.name)}</option>`).join('')}
  </select>`;
}
function typeSelectOptions(selected = '', memberId = '', includePlaceholder = false) {
  const user = currentUser();
  const list = isAdmin(user) && !memberId ? visibleTypes(user) : typesForMember(memberId || user?.memberId || '');
  if (!list.length) return '<option value="" disabled selected>请先新增该成员的业绩类型</option>';
  const placeholder = includePlaceholder ? `<option value="" disabled ${selected ? '' : 'selected'}>请选择业绩类型</option>` : '';
  return placeholder + list.map(t => `<option value="${t.id}" ${selected === t.id ? 'selected' : ''}>${safeHtml(t.name)}（${safeHtml(t.unit)}）</option>`).join('');
}
function cloudReady() { return !!(config.owner && config.repo && config.branch && config.path && config.token); }
function cloudConfigTpl() {
  return `<section class="card">
    <div class="section-title"><h2>使用前先连接云端数据</h2><span class="pill">必填</span></div>
    <p class="muted">请粘贴管理员提供的云端配置，保存并拉取成功后再登录或注册。登录和注册都会先校验云端数据库中的最新账号、密码和注册校验码。</p>
    <div class="field"><label>一键粘贴导入</label><textarea id="cloudConfigPaste" placeholder="支持格式：
用户名：xxx
仓库名：xxx
分支：master
数据路径：data/performance.json
私人令牌：xxxxx

也支持 owner=xxx、repo=xxx、branch=xxx、path=xxx、token=xxx"></textarea></div>
    <button id="importConfigBtn" class="ghost full" type="button">一键导入到下方表单</button>
    <form id="preAuthConfigForm" class="mini-form">
      <div class="grid">
        <div class="field"><label>用户名/组织</label><input name="owner" value="${safeHtml(config.owner)}" placeholder="例如 zhangsan" required></div>
        <div class="field"><label>仓库名</label><input name="repo" value="${safeHtml(config.repo)}" placeholder="例如 performance-data" required></div>
      </div>
      <div class="grid">
        <div class="field"><label>分支</label><input name="branch" value="${safeHtml(config.branch || 'master')}" required></div>
        <div class="field"><label>数据路径</label><input name="path" value="${safeHtml(config.path || 'data/performance.json')}" required></div>
      </div>
      <div class="field"><label>私人令牌</label><input name="token" type="password" value="${safeHtml(config.token)}" required></div>
      <div class="row wrap">
        <button class="primary" type="submit">保存并拉取云端数据</button>
        <button id="testCloudBtn" class="soft" type="button">测试连接/拉取</button>
      </div>
    </form>
  </section>`;
}
function authTpl() {
  const ready = cloudReady();
  return `<section class="card hero auth-hero">
    <div class="auth-logo">业绩助手</div>
    <h2>登录前先连接云端数据库</h2>
    <p>连接成功后，登录会使用云端最新账号数据；注册会使用管理员最新设置的注册校验码。</p>
  </section>
  ${cloudConfigTpl()}
  <section class="auth-grid ${ready ? '' : 'disabled-auth'}">
    <form id="loginForm" class="card">
      <div class="section-title"><h2>账号登录</h2><span class="pill">云端校验</span></div>
      <div class="field"><label>账号</label><input name="username" autocomplete="username" placeholder="请输入账号" required ${ready ? '' : 'disabled'}></div>
      <div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required ${ready ? '' : 'disabled'}></div>
      <button class="primary full" type="submit" ${ready ? '' : 'disabled'}>登录</button>
    </form>
    <form id="registerForm" class="card">
      <div class="section-title"><h2>注册个人账号</h2><span class="pill">最新校验码</span></div>
      <div class="field"><label>姓名</label><input name="displayName" placeholder="例如：张三" required ${ready ? '' : 'disabled'}></div>
      <div class="field"><label>登录账号</label><input name="username" autocomplete="username" placeholder="建议使用姓名拼音或工号" required ${ready ? '' : 'disabled'}></div>
      <div class="field"><label>密码</label><input name="password" type="password" autocomplete="new-password" minlength="4" placeholder="至少 4 位" required ${ready ? '' : 'disabled'}></div>
      <div class="field"><label>确认密码</label><input name="confirmPassword" type="password" autocomplete="new-password" minlength="4" required ${ready ? '' : 'disabled'}></div>
      <div class="field"><label>注册校验码</label><input name="registrationCode" placeholder="请输入管理员提供的最新校验码" required ${ready ? '' : 'disabled'}></div>
      <button class="soft full" type="submit" ${ready ? '' : 'disabled'}>注册并登录</button>
    </form>
  </section>`;
}
function homeTpl() {
  const today = todayStr();
  const month = monthStr();
  const memberId = currentMemberFilter();
  const dRecs = dateRecords(today, memberId);
  const mRecs = monthRecords(month, memberId);
  const todayTypes = typeSummary(dRecs);
  const monthTypes = typeSummary(mRecs);
  const best = monthTypes[0];
  const user = currentUser();
  return `
    <section class="card hero">
      <div class="row"><div class="muted" style="color:rgba(255,255,255,.78)">${today}</div>${memberFilterTpl('homeMemberFilter')}</div>
      <div class="big">今日上报 ${dRecs.length} 笔</div>
      <div class="muted" style="color:rgba(255,255,255,.78); margin-top:6px">当前账号：${safeHtml(user.displayName || user.username)}${isAdmin(user) ? '（管理员）' : ''}</div>
      <div class="grid" style="margin-top:14px">
        <div class="metric"><div class="label">今日涉及项目</div><div class="value">${todayTypes.length} 项</div></div>
        <div class="metric"><div class="label">本月上报记录</div><div class="value">${mRecs.length} 笔</div></div>
      </div>
    </section>
    <section class="grid">
      <button class="primary" data-page-jump="add">+ 记录业绩</button>
      <button class="ghost" data-page-jump="month">查看月统计</button>
    </section>
    <section class="card">
      <div class="section-title"><h2>今日各项上报汇总</h2><span class="muted">${dRecs.length} 笔</span></div>
      ${summaryList(todayTypes)}
    </section>
    <section class="card">
      <div class="section-title"><h2>本月各项上报汇总</h2><span class="pill">${month}</span></div>
      ${summaryList(monthTypes, true)}
    </section>
    <section class="card">
      <div class="section-title"><h2>本月概况</h2><span class="muted">按记录统计</span></div>
      <div class="grid">
        <div class="metric light"><div class="label">上报最多项目</div><div class="value" style="font-size:18px">${best ? safeHtml(best.type.name) : '暂无'}</div></div>
        <div class="metric light"><div class="label">参与成员</div><div class="value">${memberSummary(mRecs).length} 人</div></div>
      </div>
    </section>`;
}
function addTpl() {
  const user = currentUser();
  ensureUserMember(user);
  const memberField = isAdmin(user)
    ? `<div class="field"><label>成员</label><select id="recordMemberSelect" name="memberId" required>${state.members.map(m => `<option value="${m.id}">${safeHtml(m.name)}${m.role ? ' · ' + safeHtml(m.role) : ''}</option>`).join('')}</select></div>`
    : `<input type="hidden" name="memberId" value="${safeHtml(user.memberId)}"><div class="field"><label>成员</label><div class="readonly-box">${safeHtml(memberById(user.memberId)?.name || user.displayName || user.username)} · 仅记录自己的业绩</div></div>`;
  return `<section class="card">
    <div class="section-title"><h2>新增业绩记录</h2><span class="muted">登录后按账号自动归属</span></div>
    <form id="recordForm">
      ${memberField}
      <div class="field"><label>业绩类型</label><select id="recordTypeSelect" name="typeId" required>${typeSelectOptions('', isAdmin(user) ? (state.members[0]?.id || '') : user.memberId, true)}</select></div>
      <div class="field"><label>上报数量 / 数值</label><input name="value" type="number" inputmode="decimal" step="0.01" min="0" placeholder="例如 50、3、1" required /></div>
      <div class="field"><label>日期</label><input name="date" type="date" value="${todayStr()}" required /></div>
      <div class="field"><label>备注</label><textarea name="remark" placeholder="例如：信用卡上报情况。不要填写身份证、银行卡号等敏感信息。"></textarea></div>
      <button class="primary full" type="submit">保存记录</button>
    </form>
  </section>`;
}
function dayTpl() {
  const date = window.__selectedDate || todayStr();
  const memberId = currentMemberFilter();
  const recs = dateRecords(date, memberId).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  return `<section class="card">
    <div class="section-title"><h2>日报</h2><div class="row narrow"><input id="dayPicker" type="date" value="${date}" style="max-width:150px">${memberFilterTpl('dayMemberFilter')}</div></div>
    <div class="grid">
      <div class="metric light"><div class="label">上报记录</div><div class="value">${recs.length} 笔</div></div>
      <div class="metric light"><div class="label">涉及项目</div><div class="value">${typeSummary(recs).length} 项</div></div>
    </div>
  </section>
  <section class="card">
    <div class="section-title"><h2>各项上报汇总</h2></div>${summaryList(typeSummary(recs))}
  </section>
  ${isAdmin() ? `<section class="card"><div class="section-title"><h2>成员上报概况</h2></div>${memberSummaryList(memberSummary(recs))}</section>` : ''}
  <section class="card">
    <div class="section-title"><h2>明细记录</h2></div>
    ${recs.length ? `<div class="list">${recs.map(recordItem).join('')}</div>` : `<div class="empty">当天还没有记录</div>`}
  </section>`;
}
function monthTpl() {
  const month = window.__selectedMonth || monthStr();
  const memberId = currentMemberFilter();
  const availableTrendTypes = isAdmin() && memberId === 'all' ? visibleTypes() : typesForMember(memberId);
  const selectedType = availableTrendTypes.some(t => t.id === window.__selectedTypeId) ? window.__selectedTypeId : (availableTrendTypes[0]?.id || '');
  const recs = monthRecords(month, memberId);
  const typeItems = typeSummary(recs);
  return `<section class="card">
    <div class="section-title"><h2>月统计</h2><div class="row narrow"><input id="monthPicker" type="month" value="${month}" style="max-width:135px">${memberFilterTpl('monthMemberFilter')}</div></div>
    <div class="big">本月上报 ${recs.length} 笔</div>
    <div class="muted" style="margin-top:6px">按业绩类型分别统计，不再混合金额类与数量类。</div>
  </section>
  <section class="card">
    <div class="section-title"><h2>不同业绩月统计图</h2><span class="muted">按各类型上报总数</span></div>
    ${typeBarChart(typeItems)}
  </section>
  <section class="card">
    <div class="section-title"><h2>单项业绩每日趋势</h2><select id="trendTypePicker" class="compact-select">${isAdmin() && memberId === 'all' ? typeSelectOptions(selectedType, '') : typeSelectOptions(selectedType, memberId)}</select></div>
    ${singleTypeDailyTrend(month, selectedType, memberId)}
  </section>
  <section class="card">
    <div class="section-title"><h2>本月各项上报汇总</h2></div>${summaryList(typeItems, true)}
  </section>
  ${isAdmin() ? `<section class="card"><div class="section-title"><h2>成员月度上报概况</h2></div>${memberSummaryList(memberSummary(recs))}</section>` : ''}`;
}
function settingsTpl() {
  const user = currentUser();
  const toolsTitle = isAdmin(user) ? '数据工具（全部数据）' : '数据工具（仅本人数据）';
  return `<section class="card">
    <div class="section-title"><h2>当前账号</h2><span class="pill">${isAdmin(user) ? '管理员' : '普通用户'}</span></div>
    <div class="profile-box">
      <div><strong>${safeHtml(user.displayName || user.username)}</strong><div class="muted">账号：${safeHtml(user.username)} · ${isAdmin(user) ? '可管理全部数据' : '仅可查看和修改本人数据'}</div></div>
      <button id="logoutBtn" class="ghost small">退出登录</button>
    </div>
    <form id="changePasswordForm" class="mini-form">
      <div class="grid">
        <div class="field"><label>原密码</label><input name="oldPassword" type="password" required></div>
        <div class="field"><label>新密码</label><input name="newPassword" type="password" minlength="4" required></div>
      </div>
      <button class="soft full" type="submit">修改密码</button>
    </form>
  </section>
  ${isAdmin(user) ? `<section class="card">
    <div class="section-title"><h2>yunduan 数据同步设置</h2><span class="pill">管理员管理</span></div>
    <div class="field"><label>一键粘贴导入</label><textarea id="settingsCloudConfigPaste" placeholder="用户名：xxx
仓库名：xxx
分支：master
数据路径：data/performance.json
私人令牌：xxxxx"></textarea></div>
    <button id="settingsImportConfigBtn" class="ghost full" type="button">一键导入到表单</button>
    <form id="configForm">
      <div class="grid">
        <div class="field"><label>yunduan 用户名/组织</label><input name="owner" value="${safeHtml(config.owner)}" placeholder="例如 zhangsan" required></div>
        <div class="field"><label>仓库名</label><input name="repo" value="${safeHtml(config.repo)}" placeholder="例如 performance-data" required></div>
      </div>
      <div class="grid">
        <div class="field"><label>分支</label><input name="branch" value="${safeHtml(config.branch || 'master')}" required></div>
        <div class="field"><label>数据路径</label><input name="path" value="${safeHtml(config.path || 'data/performance.json')}" required></div>
      </div>
      <div class="field"><label>私人令牌 Access Token</label><input name="token" type="password" value="${safeHtml(config.token)}" placeholder="建议只给仓库内容读写权限" required></div>
      <button class="primary full" type="submit">保存同步设置</button>
    </form>
    <div class="row wrap" style="margin-top:10px">
      <button id="pullBtn" class="ghost">从 yunduan 拉取</button>
      <button id="pushBtn" class="soft">上传/覆盖到 yunduan</button>
    </div>
  </section>` : `<section class="card">
    <div class="section-title"><h2>yunduan 数据同步</h2><span class="pill">使用管理员设置</span></div>
    <div class="row wrap">
      <button id="pullBtn" class="ghost">从 yunduan 拉取</button>
      <button id="pushBtn" class="soft">上传/覆盖到 yunduan</button>
    </div>
  </section>`}
  ${isAdmin(user) ? `<section class="card">
    <div class="section-title"><h2>注册校验码</h2><span class="pill">管理员管理</span></div>
    <form id="registrationCodeForm" class="mini-form">
      <div class="field"><label>当前注册校验码</label><input name="registrationCode" value="${safeHtml(state.registrationCode || '')}" placeholder="例如 123456" required></div>
      <button class="soft full" type="submit">保存注册校验码</button>
    </form>
  </section>` : ''}
  ${isAdmin(user) ? `<section class="card">
    <div class="section-title"><h2>用户账号管理</h2><span class="muted">注册用户自动关联成员</span></div>
    <div class="list">${(state.users || []).map(userItem).join('')}</div>
  </section>
  <section class="card">
    <div class="section-title"><h2>成员管理</h2><button id="addMemberBtn" class="ghost small">新增成员</button></div>
    <div class="list">${state.members.map(memberItem).join('')}</div>
  </section>
  <section class="card">
    <div class="section-title"><h2>业绩类型管理</h2><button id="addTypeBtn" class="ghost small">新增公共类型</button></div>
    <div class="list">${visibleTypes(user).map(typeItem).join('') || '<div class="empty">暂无业绩类型</div>'}</div>
  </section>` : `<section class="card">
    <div class="section-title"><h2>我的业绩类型</h2><button id="addTypeBtn" class="ghost small">新增个人类型</button></div>
    <div class="list">${visibleTypes(user).map(typeItem).join('') || '<div class="empty">暂无业绩类型，可点击新增类型</div>'}</div>
  </section>`}
  <section class="card">
    <div class="section-title"><h2>${toolsTitle}</h2></div>
    <div class="row wrap">
      <button id="exportExcelBtn" class="ghost">导出 Excel</button>
      <button id="exportCsvBtn" class="ghost">导出 CSV</button>
      <button id="exportTxtBtn" class="ghost">${isAdmin(user) ? '导出所有人 TXT' : '导出我的 TXT'}</button>
      <button id="clearBtn" class="danger">${isAdmin(user) ? '清空全部记录' : '清空我的记录'}</button>
    </div>
  </section>`;
}
function summaryList(items, withProgress = false) {
  if (!items.length) return `<div class="empty">暂无数据</div>`;
  const max = Math.max(...items.map(x => x.value), 1);
  return `<div class="list">${items.map(x => `
    <div class="item">
      <div style="flex:1">
        <div class="item-title"><span class="dot" style="background:${x.type.color}"></span>${safeHtml(x.type.name)}</div>
        <div class="item-sub">${x.count} 笔上报 · 单位：${safeHtml(x.type.unit)}</div>
        ${withProgress ? `<div class="progress dark" style="margin-top:8px"><span style="width:${Math.max(4, x.value / max * 100)}%"></span></div>` : ''}
      </div>
      <div class="amount">${formatValue(x.value, x.type.unit)}</div>
    </div>`).join('')}</div>`;
}
function memberSummaryList(items) {
  if (!items.length) return `<div class="empty">暂无成员上报数据</div>`;
  return `<div class="list">${items.map(x => `
    <div class="item">
      <div>
        <div class="item-title">${safeHtml(x.member.name)}</div>
        <div class="item-sub">${safeHtml(x.member.role || '未设置岗位')} · 涉及 ${x.typeCount} 项业绩</div>
      </div>
      <div class="amount">${x.count} 笔</div>
    </div>`).join('')}</div>`;
}
function recordItem(r) {
  const t = typeById(r.typeId) || { name:'已删除类型', unit:'', color:'#98A2B3' };
  const m = memberById(r.memberId) || { name:'未分配成员' };
  const canDelete = canAccessRecord(r);
  return `<div class="item">
    <div style="flex:1">
      <div class="item-title"><span class="dot" style="background:${t.color}"></span>${safeHtml(t.name)} <span class="pill mini">${safeHtml(m.name)}</span></div>
      <div class="item-sub">${safeHtml(r.remark || '无备注')} · ${formatDateTime(r.createdAt)}</div>
    </div>
    <div class="row"><div class="amount">${formatValue(r.value, t.unit)}</div>${canDelete ? `<button class="danger small" data-delete-record="${r.id}">删除</button>` : ''}</div>
  </div>`;
}
function typeItem(t) {
  const mine = typeOwnerId(t) === currentUser()?.memberId;
  const global = isGlobalType(t);
  const canDelete = isAdmin() || mine;
  return `<div class="item">
    <div><div class="item-title"><span class="dot" style="background:${t.color}"></span>${safeHtml(t.name)} ${isAdmin() ? `<span class="pill mini">${safeHtml(typeOwnerName(t))}</span>` : global ? '<span class="pill mini">公共类型</span>' : ''}</div><div class="item-sub">单位：${safeHtml(t.unit)}${mine && !isAdmin() ? ' · 我的类型' : ''}</div></div>
    ${canDelete ? `<button class="danger small" data-delete-type="${t.id}">删除</button>` : ''}
  </div>`;
}
function typeItemReadonly(t) {
  return typeItem(t);
}
function memberItem(m) {
  return `<div class="item">
    <div><div class="item-title">${safeHtml(m.name)}</div><div class="item-sub">${safeHtml(m.role || '未设置岗位')}</div></div>
    <button class="danger small" data-delete-member="${m.id}">删除</button>
  </div>`;
}
function userItem(u) {
  const linkedMember = memberById(u.memberId);
  const isSelf = currentUser()?.id === u.id;
  return `<div class="item">
    <div style="flex:1">
      <div class="item-title">${safeHtml(u.displayName || u.username)} <span class="pill mini">${u.role === 'admin' ? '管理员' : '普通用户'}</span>${u.active === false ? '<span class="pill mini danger-pill">已停用</span>' : ''}</div>
      <div class="item-sub">账号：${safeHtml(u.username)} · 成员：${safeHtml(linkedMember?.name || '未关联')}</div>
    </div>
    <div class="row wrap user-actions">
      <button class="ghost small" data-reset-password="${u.id}">重置密码</button>
      ${isSelf ? '' : `<button class="soft small" data-toggle-role="${u.id}">${u.role === 'admin' ? '设为普通' : '设为管理员'}</button>`}
      ${isSelf ? '' : `<button class="danger small" data-toggle-user="${u.id}">${u.active === false ? '启用' : '停用'}</button>`}
    </div>
  </div>`;
}
function typeBarChart(items) {
  if (!items.length) return `<div class="empty">本月暂无业绩数据</div>`;
  const max = Math.max(...items.map(x => x.value), 1);
  return `<div class="type-chart">${items.map(x => `
    <div class="type-bar-row">
      <div class="type-bar-label"><span class="dot" style="background:${x.type.color}"></span>${safeHtml(x.type.name)}</div>
      <div class="type-bar-track"><span style="width:${Math.max(3, x.value / max * 100)}%; background:${x.type.color}"></span></div>
      <div class="type-bar-value">${formatValue(x.value, x.type.unit)}</div>
    </div>`).join('')}</div>`;
}
function singleTypeDailyTrend(month, typeId, memberId = currentMemberFilter()) {
  const t = typeById(typeId);
  if (!t) return `<div class="empty">请先新增业绩类型</div>`;
  const days = daysInMonth(month);
  const monthRecs = monthRecords(month, memberId);
  const values = Array.from({ length: days }, (_, i) => {
    const day = `${month}-${String(i + 1).padStart(2, '0')}`;
    return monthRecs.filter(r => r.date === day && r.typeId === typeId).reduce((sum, r) => sum + Number(r.value || 0), 0);
  });
  const total = values.reduce((a, b) => a + b, 0);
  const max = Math.max(...values, 1);
  return `<div class="trend-head"><div><strong>${safeHtml(t.name)}</strong><div class="muted">本月合计：${formatValue(total, t.unit)}</div></div></div>
    <div class="chart scroll-chart">${values.map((v, i) => `<div class="bar" title="${i + 1}日 ${num(v)} ${safeHtml(t.unit)}" style="height:${v ? Math.max(5, v / max * 115) : 3}px; background:${t.color}">${v ? `<em>${num(v)}</em>` : ''}<span>${i + 1}</span></div>`).join('')}</div>`;
}

function parseCloudConfigText(text) {
  const result = {};
  const raw = String(text || '').trim();
  if (!raw) return result;
  try {
    const json = JSON.parse(raw);
    return {
      owner: json.owner || json.username || json.user || json['用户名'] || json['用户名/组织'],
      repo: json.repo || json.repository || json['仓库名'] || json['仓库'],
      branch: json.branch || json['分支'],
      path: json.path || json.filePath || json['数据路径'] || json['路径'],
      token: json.token || json.access_token || json['私人令牌'] || json['令牌']
    };
  } catch {}
  const aliases = {
    owner: ['owner','username','user','用户名','用户名/组织','用户','组织'],
    repo: ['repo','repository','仓库名','仓库'],
    branch: ['branch','分支'],
    path: ['path','filepath','file_path','数据路径','路径'],
    token: ['token','access_token','私人令牌','令牌','access token']
  };
  raw.split(/\n|;|；/).forEach(line => {
    const parts = line.split(/[:：=]/);
    if (parts.length < 2) return;
    const key = parts.shift().trim().toLowerCase();
    const value = parts.join('=').trim();
    Object.entries(aliases).forEach(([field, keys]) => {
      if (keys.map(k => k.toLowerCase()).includes(key)) result[field] = value;
    });
  });
  if (!Object.keys(result).length) {
    const parts = raw.split(/[\s,，|]+/).map(x => x.trim()).filter(Boolean);
    if (parts.length >= 5) [result.owner, result.repo, result.branch, result.path, result.token] = parts;
  }
  return result;
}
function fillConfigForm(form, data) {
  ['owner','repo','branch','path','token'].forEach(k => {
    if (data[k] && form?.elements?.[k]) form.elements[k].value = data[k];
  });
}
function readConfigFromForm(form) {
  const fd = new FormData(form);
  return {
    owner: String(fd.get('owner') || '').trim(),
    repo: String(fd.get('repo') || '').trim(),
    branch: String(fd.get('branch') || 'master').trim(),
    path: String(fd.get('path') || 'data/performance.json').trim(),
    token: String(fd.get('token') || '').trim()
  };
}
async function pullRemoteForAuth() {
  if (!cloudReady()) { showToast('请先填写并保存云端连接信息'); return false; }
  try {
    showToast('正在校验云端数据...');
    const remote = await getRemoteFile();
    if (!remote) {
      showToast('云端尚无数据文件；管理员可登录后上传初始化数据');
      return true;
    }
    state = normalizeData(remote.data);
    saveLocal();
    return true;
  } catch (err) {
    console.error(err);
    showToast('云端连接失败，请检查配置、令牌和仓库权限');
    return false;
  }
}
async function saveThenPullPreAuth(form) {
  config = readConfigFromForm(form);
  saveConfig();
  const ok = await pullRemoteForAuth();
  render();
  showToast(ok ? '云端连接成功，可以登录或注册' : '云端连接失败');
}
function bindAuthPage() {
  const preAuthConfigForm = document.getElementById('preAuthConfigForm');
  const importConfigBtn = document.getElementById('importConfigBtn');
  const testCloudBtn = document.getElementById('testCloudBtn');
  if (importConfigBtn) importConfigBtn.onclick = () => {
    const parsed = parseCloudConfigText(document.getElementById('cloudConfigPaste')?.value || '');
    fillConfigForm(preAuthConfigForm, parsed);
    if (Object.keys(parsed).length) showToast('已导入，请检查后保存并拉取');
    else showToast('未识别到配置，请按示例格式粘贴');
  };
  if (preAuthConfigForm) preAuthConfigForm.onsubmit = async e => { e.preventDefault(); await saveThenPullPreAuth(preAuthConfigForm); };
  if (testCloudBtn) testCloudBtn.onclick = async () => { if (preAuthConfigForm) config = readConfigFromForm(preAuthConfigForm); saveConfig(); await pullRemoteForAuth(); render(); };

  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.onsubmit = async e => {
    e.preventDefault();
    if (!cloudReady()) { showToast('请先连接云端数据'); return; }
    const ok = await pullRemoteForAuth();
    if (!ok) return;
    const fd = new FormData(loginForm);
    const username = normalizeUsername(fd.get('username'));
    const passwordHash = await hashPassword(fd.get('password'));
    const user = (state.users || []).find(u => normalizeUsername(u.username) === username && u.active !== false);
    if (!user || user.passwordHash !== passwordHash) { showToast('账号或密码错误'); return; }
    ensureUserMember(user);
    saveLocal();
    saveSession(user);
    page = 'home';
    render();
    showToast('登录成功，已使用云端最新数据');
  };
  const registerForm = document.getElementById('registerForm');
  if (registerForm) registerForm.onsubmit = async e => {
    e.preventDefault();
    if (!cloudReady()) { showToast('请先连接云端数据'); return; }
    const ok = await pullRemoteForAuth();
    if (!ok) return;
    const fd = new FormData(registerForm);
    const displayName = String(fd.get('displayName') || '').trim();
    const username = normalizeUsername(fd.get('username'));
    const password = String(fd.get('password') || '');
    const confirmPassword = String(fd.get('confirmPassword') || '');
    const inputCode = String(fd.get('registrationCode') || '').trim();
    const requiredCode = String(state.registrationCode || '').trim();
    if (!requiredCode) { showToast('管理员尚未设置注册校验码，请联系管理员'); return; }
    if (inputCode !== requiredCode) { showToast('注册校验码不正确，请使用管理员最新设置的校验码'); return; }
    if (!displayName || !username) { showToast('请填写姓名和账号'); return; }
    if (password.length < 4) { showToast('密码至少 4 位'); return; }
    if (password !== confirmPassword) { showToast('两次密码不一致'); return; }
    if ((state.users || []).some(u => normalizeUsername(u.username) === username)) { showToast('该账号已存在'); return; }
    const memberId = uid();
    const now = new Date().toISOString();
    const user = {
      id: uid(),
      username,
      displayName,
      role: 'user',
      memberId,
      passwordHash: await hashPassword(password),
      active: true,
      createdAt: now
    };
    state.users.push(user);
    state.members.push({ id: memberId, name: displayName, role: '成员', active: true, createdAt: now });
    saveLocal();
    saveSession(user);
    await pushToYunduan(false);
    page = 'home';
    render();
    showToast('注册成功，已同步云端');
  };
}
function bindPage() {
  document.querySelectorAll('[data-page-jump]').forEach(b => b.onclick = () => { page = b.dataset.pageJump; render(); });
  ['homeMemberFilter', 'dayMemberFilter', 'monthMemberFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.onchange = e => { window.__memberFilter = e.target.value; render(); };
  });
  const recordMemberSelect = document.getElementById('recordMemberSelect');
  const recordTypeSelect = document.getElementById('recordTypeSelect');
  if (recordMemberSelect && recordTypeSelect) recordMemberSelect.onchange = e => {
    recordTypeSelect.innerHTML = typeSelectOptions('', e.target.value, true);
  };
  const recordForm = document.getElementById('recordForm');
  if (recordForm) recordForm.onsubmit = e => {
    e.preventDefault();
    if (!requireAuth('请先登录后再记录业绩')) return;
    const fd = new FormData(recordForm);
    const user = currentUser();
    const memberId = isAdmin(user) ? fd.get('memberId') : user.memberId;
    const typeId = String(fd.get('typeId') || '');
    const selectedType = typeById(typeId);
    if (!canMemberUseType(selectedType, memberId)) { showToast('请选择该成员可用的业绩类型'); return; }
    state.records.push({
      id: uid(),
      memberId,
      typeId,
      value: Number(fd.get('value')),
      date: fd.get('date') || todayStr(),
      remark: fd.get('remark'),
      createdAt: new Date().toISOString(),
      createdBy: user.id
    });
    saveLocal();
    showToast('已保存到本地');
    recordForm.reset();
    if (recordForm.memberId) recordForm.memberId.value = isAdmin(user) ? (state.members[0]?.id || '') : user.memberId;
    if (recordTypeSelect) recordTypeSelect.innerHTML = typeSelectOptions('', isAdmin(user) ? (state.members[0]?.id || '') : user.memberId, true);
    recordForm.date.value = todayStr();
  };
  const dayPicker = document.getElementById('dayPicker');
  if (dayPicker) dayPicker.onchange = e => { window.__selectedDate = e.target.value; render(); };
  const monthPicker = document.getElementById('monthPicker');
  if (monthPicker) monthPicker.onchange = e => { window.__selectedMonth = e.target.value; render(); };
  const trendTypePicker = document.getElementById('trendTypePicker');
  if (trendTypePicker) trendTypePicker.onchange = e => { window.__selectedTypeId = e.target.value; render(); };
  document.querySelectorAll('[data-delete-record]').forEach(b => b.onclick = () => {
    const rec = state.records.find(r => r.id === b.dataset.deleteRecord);
    if (!rec || !canAccessRecord(rec)) { showToast('无权限删除该记录'); return; }
    if (!confirm('确定删除这条记录？')) return;
    state.records = state.records.filter(r => r.id !== b.dataset.deleteRecord);
    saveLocal(); render();
  });
  document.querySelectorAll('[data-delete-type]').forEach(b => b.onclick = () => {
    const t = typeById(b.dataset.deleteType);
    if (!t) return;
    if (!isAdmin() && typeOwnerId(t) !== currentUser()?.memberId) { showToast('只能删除自己的业绩类型'); return; }
    if (state.records.some(r => r.typeId === b.dataset.deleteType)) { showToast('该类型已有记录，不能直接删除'); return; }
    if (!confirm('确定删除该业绩类型？')) return;
    state.types = state.types.filter(t => t.id !== b.dataset.deleteType);
    saveLocal(); render();
  });
  document.querySelectorAll('[data-delete-member]').forEach(b => b.onclick = () => {
    if (!isAdmin()) { showToast('只有管理员可以维护成员'); return; }
    if (state.records.some(r => r.memberId === b.dataset.deleteMember)) { showToast('该成员已有记录，不能直接删除'); return; }
    if (state.users.some(u => u.memberId === b.dataset.deleteMember)) { showToast('该成员已关联用户账号，不能直接删除'); return; }
    if (state.members.length <= 1) { showToast('至少保留一名成员'); return; }
    if (!confirm('确定删除该成员？')) return;
    state.members = state.members.filter(m => m.id !== b.dataset.deleteMember);
    if (window.__memberFilter === b.dataset.deleteMember) window.__memberFilter = 'all';
    saveLocal(); render();
  });
  const addTypeBtn = document.getElementById('addTypeBtn');
  if (addTypeBtn) addTypeBtn.onclick = () => {
    const user = currentUser();
    const ownerMemberId = isAdmin(user) ? 'global' : user.memberId;
    const name = prompt(isAdmin(user) ? '请输入公共业绩类型名称，例如：养老金账户' : '请输入个人业绩类型名称，例如：养老金账户'); if (!name) return;
    const unit = prompt('请输入单位：万元 / 元 / 笔 / 户 / 张 / 次 / 件 / 份', '笔') || '笔';
    const sameOwnerTypes = typesForOwnerCount(state.types, ownerMemberId);
    state.types.push({ id: uid(), name: name.trim(), unit: unit.trim(), color: COLORS[state.types.length % COLORS.length], active: true, sortOrder: sameOwnerTypes + 1, ownerMemberId, scope: isAdmin(user) ? 'global' : 'private', createdBy: user.id, createdAt: new Date().toISOString() });
    saveLocal(); render();
  };
  const addMemberBtn = document.getElementById('addMemberBtn');
  if (addMemberBtn) addMemberBtn.onclick = () => {
    if (!isAdmin()) { showToast('只有管理员可以新增成员'); return; }
    const name = prompt('请输入成员姓名，例如：崔子坤'); if (!name) return;
    const role = prompt('请输入岗位/备注，例如：客户经理', '客户经理') || '';
    state.members.push({ id: uid(), name, role, active: true, createdAt: new Date().toISOString() });
    saveLocal(); render();
  };
  document.querySelectorAll('[data-reset-password]').forEach(b => b.onclick = async () => {
    if (!isAdmin()) return;
    const u = state.users.find(x => x.id === b.dataset.resetPassword);
    if (!u) return;
    const pwd = prompt(`请输入 ${u.displayName || u.username} 的新密码（至少 4 位）`);
    if (!pwd) return;
    if (pwd.length < 4) { showToast('密码至少 4 位'); return; }
    u.passwordHash = await hashPassword(pwd);
    saveLocal(); render(); showToast('密码已重置');
  });
  document.querySelectorAll('[data-toggle-user]').forEach(b => b.onclick = () => {
    if (!isAdmin()) return;
    const u = state.users.find(x => x.id === b.dataset.toggleUser);
    if (!u || u.id === currentUser()?.id) return;
    u.active = u.active === false;
    saveLocal(); render(); showToast(u.active ? '账号已启用' : '账号已停用');
  });
  document.querySelectorAll('[data-toggle-role]').forEach(b => b.onclick = () => {
    if (!isAdmin()) return;
    const u = state.users.find(x => x.id === b.dataset.toggleRole);
    if (!u || u.id === currentUser()?.id) return;
    u.role = u.role === 'admin' ? 'user' : 'admin';
    saveLocal(); render(); showToast('账号角色已更新');
  });
  const changePasswordForm = document.getElementById('changePasswordForm');
  if (changePasswordForm) changePasswordForm.onsubmit = async e => {
    e.preventDefault();
    const user = currentUser();
    const fd = new FormData(changePasswordForm);
    const oldHash = await hashPassword(fd.get('oldPassword'));
    if (user.passwordHash !== oldHash) { showToast('原密码不正确'); return; }
    const newPassword = String(fd.get('newPassword') || '');
    if (newPassword.length < 4) { showToast('新密码至少 4 位'); return; }
    user.passwordHash = await hashPassword(newPassword);
    saveLocal(); changePasswordForm.reset(); showToast('密码已修改');
  };
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = () => { clearSession(); page = 'auth'; render(); showToast('已退出登录'); };
  const configForm = document.getElementById('configForm');
  if (configForm) configForm.onsubmit = e => { e.preventDefault(); config = readConfigFromForm(configForm); saveConfig(); showToast('同步设置已保存'); };
  const settingsImportConfigBtn = document.getElementById('settingsImportConfigBtn');
  if (settingsImportConfigBtn) settingsImportConfigBtn.onclick = () => { const parsed = parseCloudConfigText(document.getElementById('settingsCloudConfigPaste')?.value || ''); fillConfigForm(configForm, parsed); showToast(Object.keys(parsed).length ? '已导入，请检查后保存' : '未识别到配置'); };
  const registrationCodeForm = document.getElementById('registrationCodeForm');
  if (registrationCodeForm) registrationCodeForm.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(registrationCodeForm);
    const nextCode = String(fd.get('registrationCode') || '').trim();
    if (!nextCode) { showToast('注册校验码不能为空'); return; }
    try {
      if (cloudReady()) { const remote = await getRemoteFile(); if (remote?.data) state = normalizeData(remote.data); }
    } catch (err) { console.error(err); showToast('读取云端失败，未保存校验码'); return; }
    state.registrationCode = nextCode;
    saveLocal();
    await pushToYunduan(false);
    render();
    showToast('注册校验码已保存并同步云端');
  };
  const pullBtn = document.getElementById('pullBtn');
  if (pullBtn) pullBtn.onclick = pullFromYunduan;
  const pushBtn = document.getElementById('pushBtn');
  if (pushBtn) pushBtn.onclick = pushToYunduan;
  const exportExcelBtn = document.getElementById('exportExcelBtn');
  if (exportExcelBtn) exportExcelBtn.onclick = exportExcel;
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  if (exportCsvBtn) exportCsvBtn.onclick = exportCsv;
  const exportTxtBtn = document.getElementById('exportTxtBtn');
  if (exportTxtBtn) exportTxtBtn.onclick = exportTxt;
  const clearBtn = document.getElementById('clearBtn');
  if (clearBtn) clearBtn.onclick = () => {
    if (!requireAuth()) return;
    const user = currentUser();
    const msg = isAdmin(user) ? '确定清空所有业绩记录？成员、账号和业绩类型会保留。' : '确定清空你自己的业绩记录？其他用户数据不受影响。';
    if (!confirm(msg)) return;
    if (isAdmin(user)) state.records = [];
    else state.records = state.records.filter(r => r.memberId !== user.memberId);
    saveLocal(); render();
  };
}
function checkConfig() {
  if (!config.owner || !config.repo || !config.branch || !config.path || !config.token) {
    page = 'settings'; render(); showToast(isAdmin() ? '请先填写 yunduan 同步设置' : '同步设置未完成，请联系管理员配置'); return false;
  }
  return true;
}
function encodeBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
function decodeBase64(b64) {
  const binary = atob((b64 || '').replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function fileUrl() {
  return `${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${config.path.split('/').map(encodeURIComponent).join('/')}?access_token=${encodeURIComponent(config.token)}&ref=${encodeURIComponent(config.branch)}`;
}
async function getRemoteFile() {
  const res = await fetch(fileUrl(), { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  remoteSha = json.sha || '';
  const data = JSON.parse(decodeBase64(json.content || 'e30='));
  return { data, sha: json.sha };
}
function upsertById(list, item) {
  const arr = Array.isArray(list) ? [...list] : [];
  const idx = arr.findIndex(x => x.id === item.id);
  if (idx >= 0) arr[idx] = { ...arr[idx], ...item };
  else arr.push(item);
  return arr;
}
function mergeTypes(remoteTypes, localTypes) {
  let merged = Array.isArray(remoteTypes) ? [...remoteTypes] : [];
  (localTypes || []).forEach(t => { if (!merged.some(x => x.id === t.id)) merged.push(t); });
  return merged;
}
function dedupeRecords(records) {
  const map = new Map();
  (records || []).forEach(r => { if (r?.id) map.set(r.id, r); });
  return Array.from(map.values()).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
}
function mergeCurrentUserTypes(remoteTypes = [], localTypes = [], user) {
  if (!user) return mergeTypes(remoteTypes, localTypes);
  const ownLocal = (localTypes || []).filter(t => isGlobalType(t) || typeOwnerId(t) === user.memberId);
  const othersRemote = (remoteTypes || []).filter(t => !isGlobalType(t) && typeOwnerId(t) !== user.memberId);
  return mergeTypes(othersRemote, ownLocal);
}
function mergeCurrentUserData(remoteState, localState, user) {
  if (!user || isAdmin(user)) return remoteState;
  const member = (localState.members || []).find(m => m.id === user.memberId) || { id: user.memberId, name: user.displayName || user.username, role: '成员', active: true, createdAt: user.createdAt || new Date().toISOString() };
  const localOwnRecords = (localState.records || []).filter(r => r.memberId === user.memberId);
  return normalizeData({
    ...remoteState,
    users: upsertById(remoteState.users, user),
    members: upsertById(remoteState.members, member),
    types: mergeCurrentUserTypes(remoteState.types, localState.types, user),
    records: dedupeRecords([...(remoteState.records || []).filter(r => r.memberId !== user.memberId), ...localOwnRecords])
  });
}
async function pullFromYunduan() {
  if (!requireAuth('请先登录后再拉取数据')) return;
  if (!checkConfig()) return;
  try {
    showToast('正在从 yunduan 拉取...');
    const userBefore = currentUser();
    const localBefore = state;
    const remote = await getRemoteFile();
    if (!remote) { showToast('yunduan 上还没有数据文件，可先上传'); return; }
    let nextState = normalizeData(remote.data);
    if (!isAdmin(userBefore)) nextState = mergeCurrentUserData(nextState, localBefore, userBefore);
    state = nextState;
    saveLocal();
    render();
    showToast('已从 yunduan 同步到本机');
  } catch (err) { console.error(err); showToast('拉取失败：请检查 Token、仓库、分支或跨域限制'); }
}
async function pushToYunduan(showMessages = true) {
  if (!requireAuth('请先登录后再上传数据')) return false;
  if (!checkConfig()) return false;
  try {
    if (showMessages) showToast('正在上传到 yunduan...');
    const user = currentUser();
    let sha = '';
    let uploadState = state;
    let remoteState = null;
    try {
      const remote = await getRemoteFile();
      sha = remote?.sha || '';
      if (remote?.data) remoteState = normalizeData(remote.data);
    } catch (e) { if (!String(e).includes('404')) throw e; }
    if (!isAdmin(user)) {
      uploadState = mergeCurrentUserData(remoteState || normalizeData({}), state, user);
    }
    const body = {
      access_token: config.token,
      content: encodeBase64(JSON.stringify(uploadState, null, 2)),
      message: `update performance data ${nowLocalText()}`,
      branch: config.branch
    };
    if (sha) body.sha = sha;
    const url = `${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${config.path.split('/').map(encodeURIComponent).join('/')}`;
    const res = await fetch(url, { method: sha ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json(); remoteSha = json.content?.sha || json.sha || '';
    if (!isAdmin(user)) { state = uploadState; saveLocal(); }
    if (showMessages) showToast('已上传到 yunduan');
    return true;
  } catch (err) { console.error(err); showToast('上传失败：请检查仓库权限、路径或 Token'); return false; }
}
function normalizeData(d = {}) {
  const base = defaultData();
  let members = Array.isArray(d.members) && d.members.length ? d.members.map((m, idx) => ({
    id: m.id || uid(),
    name: m.name || `成员${idx + 1}`,
    role: m.role || '',
    active: m.active !== false,
    createdAt: m.createdAt || new Date().toISOString()
  })) : base.members;
  let types = Array.isArray(d.types) && d.types.length ? d.types.map((t, idx) => {
    const rawOwner = t.ownerMemberId || t.memberId || members[0]?.id || base.members[0].id;
    const global = t.scope === 'global' || rawOwner === 'global' || rawOwner === 'member_admin';
    return {
      id: t.id || uid(),
      name: t.name || `业绩类型${idx + 1}`,
      unit: t.unit || '笔',
      color: t.color || COLORS[idx % COLORS.length],
      active: t.active !== false,
      sortOrder: Number(t.sortOrder || idx + 1),
      ownerMemberId: global ? 'global' : rawOwner,
      scope: global ? 'global' : (t.scope || 'private'),
      createdBy: t.createdBy || '',
      createdAt: t.createdAt || new Date().toISOString()
    };
  }) : base.types.map(t => ({ ...t, ownerMemberId: 'global', scope: 'global', createdAt: new Date().toISOString() }));
  let users = Array.isArray(d.users) && d.users.length ? d.users.map((u, idx) => ({
    id: u.id || uid(),
    username: normalizeUsername(u.username || `user${idx + 1}`),
    displayName: u.displayName || u.name || u.username || `用户${idx + 1}`,
    role: u.role === 'admin' ? 'admin' : 'user',
    memberId: u.memberId || '',
    passwordHash: u.passwordHash || DEFAULT_ADMIN_PASSWORD_HASH,
    active: u.active !== false,
    createdAt: u.createdAt || new Date().toISOString()
  })) : base.users;
  if (!users.some(u => u.role === 'admin')) users.unshift(base.users[0]);
  users = users.map(u => {
    const memberId = u.memberId || (u.id === 'user_admin' ? 'member_admin' : `member_${u.id}`);
    return { ...u, memberId };
  });
  users.forEach(u => {
    if (!members.some(m => m.id === u.memberId)) {
      members.push({ id: u.memberId, name: u.displayName || u.username, role: u.role === 'admin' ? '管理员' : '成员', active: true, createdAt: u.createdAt || new Date().toISOString() });
    }
  });
  const defaultMemberId = members[0]?.id || base.members[0].id;
  const typeIds = new Set(types.map(t => t.id));
  let records = Array.isArray(d.records) ? d.records.map(r => ({
    id: r.id || uid(),
    memberId: r.memberId || defaultMemberId,
    typeId: r.typeId || types[0]?.id || '',
    value: Number(r.value || 0),
    date: r.date || todayStr(),
    remark: r.remark || '',
    createdAt: r.createdAt || new Date().toISOString(),
    createdBy: r.createdBy || ''
  })).filter(r => r.typeId && typeIds.has(r.typeId)) : [];
  // v4：业绩类型按成员独立。旧数据中没有归属人的类型，会按记录成员自动复制一份，避免历史记录丢失。
  const typeMap = new Map(types.map(t => [t.id, t]));
  const clonedMap = new Map();
  records = records.map(r => {
    const t = typeMap.get(r.typeId);
    if (!t || isGlobalType(t) || typeOwnerId(t) === r.memberId) return r;
    const cloneKey = `${t.id}__${r.memberId}`;
    if (!clonedMap.has(cloneKey)) {
      const clone = { ...t, id: cloneKey, ownerMemberId: r.memberId, sortOrder: typesForOwnerCount(types, r.memberId) + clonedMap.size + 1, createdAt: t.createdAt || new Date().toISOString() };
      clonedMap.set(cloneKey, clone);
      typeMap.set(cloneKey, clone);
    }
    return { ...r, typeId: cloneKey };
  });
  if (clonedMap.size) types = [...types, ...Array.from(clonedMap.values())];
  return { version: 5, registrationCode: d.registrationCode || base.registrationCode || '123456', users, members, types, records, updatedAt: d.updatedAt || new Date().toISOString() };
}
function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function excelCell(v) {
  return safeHtml(v ?? '');
}
function txtUnitSuffix(unit) {
  const u = String(unit || '').trim();
  const map = { '万': 'w', '万元': 'w', '克': 'g', '个': '个', '张': '张', '户': '户', '笔': '笔' };
  return map[u] ?? u;
}
function formatTxtNumber(value) {
  const n = Number(value || 0);
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
function memberMonthlyTxt(member, month, records) {
  const summary = typeSummary(records).filter(x => Number(x.value || 0) !== 0);
  const name = member?.name || member?.displayName || member?.username || '未命名';
  const lines = [`姓名：${name}`, '业绩：'];
  if (summary.length) {
    summary.forEach(x => lines.push(`${x.type.name}${formatTxtNumber(x.value)}${txtUnitSuffix(x.type.unit)}`));
  } else {
    lines.push('暂无业绩');
  }
  return lines.join('\n');
}
function safeFilename(name) {
  return String(name || '未命名').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || '未命名';
}
function exportTxt() {
  if (!requireAuth('请先登录后再导出数据')) return;
  const user = currentUser();
  const month = window.__selectedMonth || monthStr();
  if (isAdmin(user)) {
    const activeMembers = (state.members || []).filter(m => m.active !== false);
    const parts = [];
    activeMembers.forEach(m => {
      const records = monthRecords(month, m.id);
      if (!records.length) return;
      parts.push(memberMonthlyTxt(m, month, records));
    });
    const content = parts.length ? parts.join('\n\n------------------------------\n\n') : '暂无业绩';
    downloadFile(`所有人业绩_${month}.txt`, '\ufeff' + content, 'text/plain;charset=utf-8');
  } else {
    const m = memberById(user.memberId) || { name: user.displayName || user.username };
    const records = monthRecords(month, user.memberId);
    downloadFile(`${safeFilename(m.name)}_${month}_业绩.txt`, '\ufeff' + memberMonthlyTxt(m, month, records), 'text/plain;charset=utf-8');
  }
}
function exportExcel() {
  if (!requireAuth('请先登录后再导出数据')) return;
  const user = currentUser();
  const records = accessibleRecords(state.records, user).slice().sort((a, b) => (a.typeId || '').localeCompare(b.typeId || '') || (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
  const summary = typeSummary(records);
  const scope = isAdmin(user) ? '全部成员数据' : `${memberById(user.memberId)?.name || user.displayName || user.username} 的个人数据`;
  const summaryRows = summary.map(x => `<tr><td>${excelCell(x.type.name)}</td><td>${excelCell(x.type.unit)}</td><td class="num">${x.value}</td><td class="num">${x.count}</td></tr>`).join('') || '<tr><td colspan="4">暂无数据</td></tr>';
  const detailRows = records.map((r, i) => {
    const t = typeById(r.typeId) || { name:'已删除类型', unit:'' };
    const m = memberById(r.memberId) || { name:'未分配成员', role:'' };
    return `<tr><td>${i + 1}</td><td>${excelCell(r.date)}</td><td>${excelCell(m.name)}</td><td>${excelCell(m.role || '')}</td><td>${excelCell(t.name)}</td><td class="num">${Number(r.value || 0)}</td><td>${excelCell(t.unit)}</td><td>${excelCell(r.remark || '')}</td><td>${excelCell(formatDateTime(r.createdAt))}</td></tr>`;
  }).join('') || '<tr><td colspan="9">暂无明细记录</td></tr>';
  const grouped = summary.map(x => {
    const rows = records.filter(r => r.typeId === x.type.id).map((r, idx) => {
      const m = memberById(r.memberId) || { name:'未分配成员', role:'' };
      return `<tr><td>${idx + 1}</td><td>${excelCell(r.date)}</td><td>${excelCell(m.name)}</td><td class="num">${Number(r.value || 0)}</td><td>${excelCell(x.type.unit)}</td><td>${excelCell(r.remark || '')}</td></tr>`;
    }).join('');
    return `<h2>${excelCell(x.type.name)} - 每次上传记录</h2><table><thead><tr><th>序号</th><th>日期</th><th>成员</th><th>本次上传数值</th><th>单位</th><th>备注</th></tr></thead><tbody>${rows}<tr class="total"><td colspan="3">${excelCell(x.type.name)} 汇总</td><td class="num">${x.value}</td><td>${excelCell(x.type.unit)}</td><td>共 ${x.count} 笔</td></tr></tbody></table>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,'Microsoft YaHei',sans-serif;color:#111827;} h1{font-size:22px;margin:0 0 8px;} h2{font-size:17px;margin:24px 0 8px;color:#155eef;} p{color:#475467;margin:4px 0 14px;} table{border-collapse:collapse;width:100%;margin-bottom:12px;} th{background:#eaf1ff;color:#155eef;font-weight:700;} th,td{border:1px solid #d0d5dd;padding:8px;mso-number-format:'\@';} td.num{mso-number-format:'0.00';text-align:right;} tr.total td{background:#f8fafc;font-weight:700;}
  </style></head><body>
    <h1>业绩数据导出</h1><p>导出范围：${excelCell(scope)}；导出时间：${excelCell(nowLocalText())}</p>
    <h2>业绩类型汇总</h2><table><thead><tr><th>业绩类型</th><th>单位</th><th>总数</th><th>上传笔数</th></tr></thead><tbody>${summaryRows}</tbody></table>
    <h2>全部明细记录</h2><table><thead><tr><th>序号</th><th>日期</th><th>成员</th><th>岗位</th><th>业绩类型</th><th>本次上传数值</th><th>单位</th><th>备注</th><th>上传时间</th></tr></thead><tbody>${detailRows}</tbody></table>
    ${grouped || '<h2>按业绩类型分组</h2><p>暂无数据</p>'}
  </body></html>`;
  downloadFile(`业绩导出_${todayStr()}.xls`, '\ufeff' + html, 'application/vnd.ms-excel;charset=utf-8');
}
function exportCsv() {
  if (!requireAuth('请先登录后再导出数据')) return;
  const records = accessibleRecords(state.records);
  const header = ['日期', '成员', '岗位', '类型', '数值', '单位', '备注', '上传时间'];
  const rows = records.map(r => {
    const t = typeById(r.typeId) || { name:'已删除类型', unit:'' };
    const m = memberById(r.memberId) || { name:'未分配成员', role:'' };
    return [r.date, m.name, m.role || '', t.name, r.value, t.unit, r.remark || '', formatDateTime(r.createdAt)];
  });
  const csv = [header, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadFile('performance-records.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
}

document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => {
  if (!requireAuth('请先登录后再使用')) return;
  page = b.dataset.page; render();
});
document.getElementById('syncBtn').onclick = pushToYunduan;
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
render();
