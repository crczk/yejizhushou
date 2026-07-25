const STORAGE_KEY = 'bank-performance-yunduan-webapp-state-v9';
const OLD_STORAGE_KEYS = ['bank-performance-yunduan-webapp-state-v8', 'bank-performance-yunduan-webapp-state-v7', 'bank-performance-yunduan-webapp-state-v6', 'bank-performance-yunduan-webapp-state-v5', 'bank-performance-yunduan-webapp-state-v4', 'bank-performance-yunduan-webapp-state-v3', 'bank-performance-gitee-webapp-state-v3', 'bank-performance-gitee-webapp-state-v2', 'bank-performance-gitee-webapp-state-v1'];
const CONFIG_KEY = 'bank-performance-yunduan-config-v2';
const SESSION_KEY = 'bank-performance-yunduan-session-v1';
const DEVICE_KEY = 'bank-performance-yunduan-device-v1';
const PENDING_SESSION_RELEASE_KEY = 'bank-performance-yunduan-pending-session-release-v1';
const REMOTE_SESSION_TTL_MS = 30 * 60 * 1000;
const REMOTE_SESSION_TOUCH_INTERVAL_MS = 8 * 60 * 1000;
const APP_VERSION = '29.0';
try {
  if (window.AndroidBridge || window.Android) document.documentElement.classList.add('native-android');
  if (new URLSearchParams(location.search).get('desktop') === 'windows') document.documentElement.classList.add('native-windows');
} catch (err) { console.error(err); }

const REMINDER_SETTINGS_KEY = 'bank-performance-daily-reminder-v1';
const SYNC_META_KEY = 'bank-performance-yunduan-sync-meta-v2';
const API_ROOT = 'https://gitee.com/api/v5';
const PACKAGE_CLOUD_CONFIG = Object.freeze(window.__PERFORMANCE_CLOUD_CONFIG__ || {});
const DEFAULT_ADMIN_PASSWORD_HASH = '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9'; // admin123

const COLORS = ['#155EEF', '#079455', '#DC6803', '#7A5AF8', '#0E9384', '#D92D20', '#475467', '#2563eb', '#9333ea', '#0891b2'];

const defaultData = () => {
  const now = new Date().toISOString();
  return {
    version: 10,
    registrationCode: '123456',
    settings: { amountVisibility: 'all' },
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
      { id: 'type_credit_card', name: '信用卡', unit: '张', price: null, color: '#7A5AF8', active: true, sortOrder: 1, ownerMemberId: 'global', scope: 'global' }
    ],
    records: [],
    deletedRecords: [],
    deletedUsers: [],
    deletedMembers: [],
    coreSummaries: [],
    updatedAt: now
  };
};

let state = loadLocal();
let config = loadConfig();
let session = loadSession();
let page = currentUser() ? 'home' : 'auth';
let remoteSha = '';
let syncMeta = loadSyncMeta();
let syncTimer = null;
let syncInFlight = false;
let accountSessionOperation = null;

function uid() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}
function randomToken() {
  if (window.crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, '');
  const bytes = new Uint8Array(24);
  if (window.crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes).map(v => v.toString(16).padStart(2, '0')).join('');
}
function getDeviceId() {
  let id = String(localStorage.getItem(DEVICE_KEY) || '').trim();
  if (!id) {
    id = `device_${randomToken().slice(0, 24)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}
function deviceLabel() {
  const ua = String(navigator.userAgent || '');
  const platform = /Android/i.test(ua) ? 'Android设备' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS设备' : document.documentElement.classList.contains('native-windows') ? 'Windows设备' : '网页设备';
  return `${platform}-${getDeviceId().slice(-6).toUpperCase()}`;
}
function dateMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isFinite(ms) ? ms : 0;
}
function pad2(n) { return String(n).padStart(2, '0'); }
function nativeBridge() { return window.AndroidBridge || window.Android || null; }
function loadReminderSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(REMINDER_SETTINGS_KEY) || '{}');
    const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(saved.time || '')) ? String(saved.time) : '20:00';
    return { enabled: saved.enabled === true, time };
  } catch {
    return { enabled: false, time: '20:00' };
  }
}
let reminderSettings = loadReminderSettings();
let browserReminderTimer = null;
function saveReminderSettings(settings) {
  reminderSettings = { enabled: settings.enabled === true, time: settings.time || '20:00' };
  localStorage.setItem(REMINDER_SETTINGS_KEY, JSON.stringify(reminderSettings));
}
function hasNativeReminder() {
  const bridge = nativeBridge();
  return !!bridge && typeof bridge.setDailyReminder === 'function';
}
function reminderTimeParts(value = reminderSettings.time) {
  const matched = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  return matched ? { hour: Number(matched[1]), minute: Number(matched[2]) } : { hour: 20, minute: 0 };
}
let nativeReminderStatus = null;
function readNativeReminderStatus() {
  const bridge = nativeBridge();
  if (!bridge || typeof bridge.getReminderStatus !== 'function') return null;
  try {
    const value = bridge.getReminderStatus();
    nativeReminderStatus = typeof value === 'string' ? JSON.parse(value) : value;
    return nativeReminderStatus;
  } catch (err) {
    console.error(err);
    return null;
  }
}
function applyNativeReminder(settings = reminderSettings) {
  const bridge = nativeBridge();
  if (!bridge || typeof bridge.setDailyReminder !== 'function') return false;
  const { hour, minute } = reminderTimeParts(settings.time);
  try {
    const value = bridge.setDailyReminder(!!settings.enabled, hour, minute);
    if (typeof value === 'string' && value.trim()) nativeReminderStatus = JSON.parse(value);
    else readNativeReminderStatus();
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}
function formatReminderDateTime(value) {
  const ms = Number(value || 0);
  if (!ms) return '尚未安排';
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '尚未安排';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function reminderStatusText(value) {
  const map = {
    none: '暂无记录',
    sent_alarm: '系统闹钟已成功发送',
    sent_backup_job: '备用后台任务已成功发送',
    sent_test_alarm: '后台测试已成功发送',
    blocked_alarm: '系统闹钟已触发，但通知权限被阻止',
    blocked_backup_job: '备用任务已触发，但通知权限被阻止',
    blocked_test_alarm: '后台测试已触发，但通知权限被阻止'
  };
  return map[String(value || '')] || String(value || '暂无记录').replaceAll('_', ' ');
}
function nativeReminderStatusTpl() {
  if (!hasNativeReminder()) return '';
  const status = nativeReminderStatus || readNativeReminderStatus() || {};
  const exact = status.exactAlarmAllowed === true;
  const notify = status.notificationAllowed === true;
  const battery = status.batteryExempt === true;
  const mode = String(status.scheduleMode || 'none');
  return `<div class="reminder-status-panel">
    <div class="reminder-status-title"><strong>系统提醒状态</strong><span class="status-pill ${notify && exact ? 'ok' : 'warn'}">${notify && exact ? '可按时提醒' : '需要检查权限'}</span></div>
    <div class="reminder-status-grid">
      <span>通知权限</span><strong class="${notify ? 'status-ok' : 'status-warn'}">${notify ? '已允许' : '未允许'}</strong>
      <span>精确定时</span><strong class="${exact ? 'status-ok' : 'status-warn'}">${exact ? '已允许' : '未允许，可能延迟'}</strong>
      <span>后台电池策略</span><strong class="${battery ? 'status-ok' : 'status-warn'}">${battery ? '已设为不受限制' : '系统优化中，建议允许后台'}</strong>
      <span>下次计划</span><strong>${safeHtml(formatReminderDateTime(status.nextTrigger))}</strong>
      <span>调度方式</span><strong>${safeHtml(mode)}</strong>
      <span>最近一次结果</span><strong>${safeHtml(reminderStatusText(status.lastResult))}</strong>
    </div>
  </div>`;
}
window.refreshReminderStatusFromNative = () => {
  readNativeReminderStatus();
  if (page === 'settings') render();
};
async function showBrowserReminder() {
  if (!('Notification' in window)) return false;
  try {
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    if (permission !== 'granted') return false;
    const notification = new Notification('业绩录入提醒', {
      body: '请及时录入今天的业绩信息。',
      icon: './icon.svg',
      tag: 'performance-daily-reminder'
    });
    notification.onclick = () => { window.focus(); window.openPerformanceEntryFromNotification?.(); notification.close(); };
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}
function scheduleBrowserReminderLoop() {
  clearTimeout(browserReminderTimer);
  browserReminderTimer = null;
  if (hasNativeReminder() || !reminderSettings.enabled) return;
  const { hour, minute } = reminderTimeParts();
  const now = new Date();
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const delay = Math.min(next.getTime() - now.getTime(), 2147483000);
  browserReminderTimer = setTimeout(async () => {
    await showBrowserReminder();
    scheduleBrowserReminderLoop();
  }, delay);
}
function reminderPlatformHint() {
  if (hasNativeReminder()) {
    return 'Android 系统会在应用关闭后继续按时发送任务栏通知；请允许通知权限，并避免系统管家禁止本应用后台提醒。';
  }
  if (document.documentElement.classList.contains('native-windows')) {
    return 'Windows 桌面版在软件窗口保持运行时发送系统通知；关闭软件后不会继续后台提醒。首次测试时请允许 Microsoft Edge 通知权限。';
  }
  return '网页端仅在页面保持打开时尝试提醒；关闭浏览器后的可靠任务栏通知需要使用 Android APK。';
}
function todayStr(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function monthStr(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; }
function num(n) { return Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 }); }
function money(n) { return `¥${Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function amountVisibilityMode() {
  const mode = state?.settings?.amountVisibility;
  return ['all', 'own', 'hidden'].includes(mode) ? mode : 'all';
}
function canViewAnyAmount(user = currentUser()) {
  return !!user && (isAdmin(user) || amountVisibilityMode() !== 'hidden');
}
function canViewAmountForMember(memberId, user = currentUser()) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const mode = amountVisibilityMode();
  if (mode === 'all') return true;
  if (mode === 'own') return memberId === user.memberId;
  return false;
}
function canViewAggregateAmounts(records = [], user = currentUser()) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const mode = amountVisibilityMode();
  if (mode === 'all') return true;
  if (mode === 'hidden') return false;
  return (records || []).every(r => r.memberId === user.memberId);
}
function hiddenAmountText() { return '金额已隐藏'; }
function amountVisibilityLabel() {
  return { all: '普通用户可查看全部公开金额', own: '普通用户仅查看本人金额', hidden: '普通用户不显示任何金额' }[amountVisibilityMode()];
}
function canonicalTypeName(name) { return String(name || '').trim().toLowerCase().replace(/[\s_-]+/g, '').replace(/[（(].*?[）)]/g, ''); }
function typeById(id) { return state.types.find(t => t.id === id); }
function typePrice(t) { return Number.isFinite(Number(t?.price)) && t?.price !== null && t?.price !== '' ? Math.max(0, Number(t.price)) : null; }
function recordPrice(r) { const p = typePrice(typeById(r.typeId)); return p === null ? null : Number(r.value || 0) * p; }
function totalRecordPrice(records) { return (records || []).reduce((sum, r) => sum + (recordPrice(r) ?? 0), 0); }
function unpricedRecordCount(records) { return (records || []).filter(r => typePrice(typeById(r.typeId)) === null).length; }
function findGlobalTypeByName(name) { const key = canonicalTypeName(name); return (state.types || []).find(t => t.active !== false && isGlobalType(t) && canonicalTypeName(t.name) === key); }
function coreSummaries() { return (state.coreSummaries || []).filter(x => x.active !== false).slice().sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)); }
function reconcileTypeCollections(types = [], records = [], groups = []) {
  const globalByName = new Map();
  types.filter(isGlobalType).forEach(t => { const key = canonicalTypeName(t.name); if (key && !globalByName.has(key)) globalByName.set(key, t); });
  const remap = new Map();
  types.forEach(t => {
    if (isGlobalType(t)) return;
    const match = globalByName.get(canonicalTypeName(t.name));
    if (match) remap.set(t.id, match.id);
  });
  if (!remap.size) return { types, records, groups };
  const now = new Date().toISOString();
  const nextTypes = types.map(t => remap.has(t.id) ? { ...t, active: false, mergedIntoTypeId: remap.get(t.id), updatedAt: t.updatedAt || now } : t);
  const nextRecords = records.map(r => remap.has(r.typeId) ? { ...r, typeId: remap.get(r.typeId) } : r);
  const nextGroups = groups.map(g => ({ ...g, typeIds: Array.from(new Set((g.typeIds || []).map(id => remap.get(id) || id))).filter(id => nextTypes.some(t => t.id === id)) }));
  return { types: nextTypes, records: nextRecords, groups: nextGroups };
}
function reconcileStateGlobalTypes() {
  const fixed = reconcileTypeCollections(state.types || [], state.records || [], state.coreSummaries || []);
  state.types = fixed.types;
  state.records = fixed.records;
  state.coreSummaries = fixed.groups;
}
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
  if (isAdmin(user)) return (state.types || []).filter(t => t.active !== false).slice().sort((a, b) => (isGlobalType(a) === isGlobalType(b) ? 0 : isGlobalType(a) ? -1 : 1) || Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
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
function loadSyncMeta() {
  try {
    return { pending: false, status: 'idle', lastSyncedAt: '', lastError: '', ...(JSON.parse(localStorage.getItem(SYNC_META_KEY)) || {}) };
  } catch {
    return { pending: false, status: 'idle', lastSyncedAt: '', lastError: '' };
  }
}
function saveSyncMeta(patch = {}) {
  syncMeta = { ...syncMeta, ...patch };
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(syncMeta));
  updateSyncStatusDom();
}
function markSyncPending() {
  saveSyncMeta({ pending: true, status: navigator.onLine === false ? 'offline' : 'pending', lastError: '' });
}
function scheduleAutoSync(delay = 1800) {
  clearTimeout(syncTimer);
  if (!currentUser() || !cloudReady()) return;
  syncTimer = setTimeout(() => pushToYunduan(false), delay);
}
function saveLocal(markDirty = true) {
  state.updatedAt = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (markDirty && currentUser()) {
    markSyncPending();
    scheduleAutoSync();
  }
}
function syncStatusText() {
  if (!currentUser()) return '';
  if (syncMeta.status === 'syncing') return '同步中…';
  if (navigator.onLine === false || syncMeta.status === 'offline') return syncMeta.pending ? '离线 · 有待上传数据' : '离线模式';
  if (syncMeta.status === 'error') return `同步失败${syncMeta.lastError ? ' · ' + syncMeta.lastError : ''}`;
  if (syncMeta.pending) return '有数据等待同步';
  if (syncMeta.lastSyncedAt) return `已同步 · ${formatDateTime(syncMeta.lastSyncedAt)}`;
  return '尚未同步';
}
function syncStatusPanelTpl() {
  return `<section class="card sync-status-card"><div class="section-title"><h2>自动同步状态</h2><span id="syncStatusPill" class="pill ${syncMeta.status === 'error' ? 'danger-pill' : syncMeta.pending ? 'warning-pill' : 'success-pill'}">${safeHtml(syncStatusText())}</span></div><p class="muted">新增或删除业绩后会自动安全同步；应用打开、重新联网及每隔 90 秒会检查云端更新。</p><div class="row wrap"><button id="pullBtnStatus" class="ghost">立即拉取</button><button id="pushBtnStatus" class="soft">立即安全同步</button></div></section>`;
}
function updateSyncStatusDom() {
  const el = document.getElementById('syncStatusPill');
  if (!el) return;
  el.textContent = syncStatusText();
  el.className = `pill ${syncMeta.status === 'error' ? 'danger-pill' : syncMeta.pending ? 'warning-pill' : 'success-pill'}`;
  const top = document.getElementById('syncBtn');
  if (top && currentUser()) top.textContent = syncMeta.status === 'syncing' ? '同步中…' : syncMeta.pending ? '有待同步' : '立即同步';
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
function normalizeCloudConfig(value = {}) {
  const next = { companyName:'', owner:'', repo:'', branch:'master', path:'data/performance-v14', token:'', locked:false, ...(value || {}) };
  if (/\.json$/i.test(String(next.path || ''))) next.path = String(next.path).replace(/\.json$/i, '') + '-split';
  next.locked = next.locked === true;
  return next;
}
function completeCloudConfig(value = {}) {
  const v = normalizeCloudConfig(value);
  return !!(v.owner && v.repo && v.branch && v.path && v.token);
}
function packageCloudConfigReady() { return completeCloudConfig(PACKAGE_CLOUD_CONFIG); }
function packageCloudConfigLocked() { return packageCloudConfigReady() && PACKAGE_CLOUD_CONFIG.locked === true; }
function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(CONFIG_KEY)) || {}; } catch {}
  const packaged = normalizeCloudConfig(PACKAGE_CLOUD_CONFIG);
  if (packageCloudConfigLocked()) return packaged;
  if (completeCloudConfig(saved)) return normalizeCloudConfig(saved);
  if (packageCloudConfigReady()) return packaged;
  return normalizeCloudConfig(saved);
}
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) || {}; }
  catch { return {}; }
}
function saveSession(user, remoteSession = null) {
  const sameUser = session?.userId === user.id;
  session = {
    userId: user.id,
    username: user.username,
    loginAt: sameUser && session.loginAt ? session.loginAt : new Date().toISOString(),
    deviceId: remoteSession?.deviceId || (sameUser && session.deviceId) || getDeviceId(),
    accountSessionToken: remoteSession?.sessionToken || (sameUser && session.accountSessionToken) || '',
    accountSessionHeartbeatAt: remoteSession?.heartbeatAt || (sameUser && session.accountSessionHeartbeatAt) || '',
    accountSessionExpiresAt: remoteSession?.expiresAt || (sameUser && session.accountSessionExpiresAt) || ''
  };
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
    const t = typeById(r.typeId) || { id: r.typeId, name: '已删除类型', unit: '', price: null, color: '#98A2B3' };
    if (!map.has(t.id)) map.set(t.id, { type: t, value: 0, count: 0, totalPrice: 0, unpricedCount: 0 });
    const item = map.get(t.id);
    const p = typePrice(t);
    item.value += Number(r.value || 0);
    item.count += 1;
    if (p === null) item.unpricedCount += 1;
    else item.totalPrice += Number(r.value || 0) * p;
  });
  return Array.from(map.values()).sort((a, b) => b.totalPrice - a.totalPrice || b.value - a.value || b.count - a.count);
}
function memberSummary(records) {
  const map = new Map();
  records.forEach(r => {
    const m = memberById(r.memberId) || { id: r.memberId, name: '未分配成员', role: '' };
    if (!map.has(m.id)) map.set(m.id, { member: m, count: 0, typeCount: new Set(), totalPrice: 0, unpricedCount: 0 });
    const item = map.get(m.id);
    item.count += 1;
    item.typeCount.add(r.typeId);
    const price = recordPrice(r);
    if (price === null) item.unpricedCount += 1;
    else item.totalPrice += price;
  });
  return Array.from(map.values()).map(x => ({ ...x, typeCount: x.typeCount.size })).sort((a, b) => b.totalPrice - a.totalPrice || b.count - a.count);
}
function memberTypeSummary(records) {
  const map = new Map();
  records.forEach(r => {
    const t = typeById(r.typeId) || { id: r.typeId, name: '已删除类型', unit: '', price: null, color: '#98A2B3' };
    const m = memberById(r.memberId) || { id: r.memberId, name: '未分配成员', role: '' };
    const key = `${m.id || r.memberId || 'unknown'}::${t.id || r.typeId || 'unknown'}`;
    if (!map.has(key)) map.set(key, { member: m, type: t, value: 0, count: 0, totalPrice: 0, unpricedCount: 0 });
    const item = map.get(key);
    const value = Number(r.value || 0);
    const price = typePrice(t);
    item.value += value;
    item.count += 1;
    if (price === null) item.unpricedCount += 1;
    else item.totalPrice += value * price;
  });
  return Array.from(map.values()).sort((a, b) => {
    const memberOrder = String(a.member.name || '').localeCompare(String(b.member.name || ''), 'zh-CN');
    if (memberOrder) return memberOrder;
    return b.totalPrice - a.totalPrice || b.value - a.value || String(a.type.name || '').localeCompare(String(b.type.name || ''), 'zh-CN');
  });
}
function daysInMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function formatValue(value, unit) {
  return `${num(value)}${unit ? ' ' + safeHtml(unit) : ''}`;
}
function priceLabel(t, user = currentUser()) {
  if (!canViewAnyAmount(user)) return hiddenAmountText();
  const p = typePrice(t);
  return p === null ? '待管理员定价' : `${money(p)} / ${safeHtml(t.unit || '单位')}`;
}
function pricingHint(records) {
  if (!canViewAggregateAmounts(records)) return '<span class="pill">金额信息未公开</span>';
  const count = unpricedRecordCount(records);
  return count ? `<span class="pill warning-pill">${count} 笔待定价</span>` : '<span class="pill success-pill">已全部定价</span>';
}
function memberPricingBreakdown(records, periodText = '合计') {
  const members = memberSummary(records);
  if (!members.length) return '<div class="empty">暂无成员业绩数据</div>';
  return `<div class="pricing-member-list">${members.map(x => {
    const own = records.filter(r => r.memberId === x.member.id);
    const types = typeSummary(own);
    return `<article class="pricing-member-card">
      <div class="pricing-member-head"><div><strong>${safeHtml(x.member.name)}</strong><div class="muted">${safeHtml(x.member.role || '未设置岗位')} · ${x.count} 笔 · ${x.typeCount} 类</div></div><div class="price-total"><span>${periodText}总价</span><b>${money(x.totalPrice)}</b>${x.unpricedCount ? `<small>${x.unpricedCount} 笔待定价</small>` : ''}</div></div>
      <div class="pricing-type-grid">${types.map(t => `<div class="pricing-type-row"><div><span class="dot" style="background:${t.type.color}"></span><strong>${safeHtml(t.type.name)}</strong><div class="item-sub">${formatValue(t.value, t.type.unit)} · 单价 ${priceLabel(t.type)}</div></div><div class="amount">${typePrice(t.type) === null ? '待定价' : money(t.totalPrice)}</div></div>`).join('')}</div>
    </article>`;
  }).join('')}</div>`;
}
function coreSummaryTpl(date = todayStr()) {
  const groups = coreSummaries();
  if (!groups.length) return `<div class="empty">管理员尚未配置业绩核心汇总大类</div>`;
  return `<div class="core-summary-list">${groups.map(group => {
    const ids = new Set(group.typeIds || []);
    const records = (state.records || []).filter(r => r.date === date && ids.has(r.typeId));
    const mergedItems = memberTypeSummary(records);
    const typeItems = typeSummary(records);
    const showAggregateAmount = canViewAggregateAmounts(records);
    return `<article class="core-summary-card">
      <div class="core-summary-head"><div><h3>${safeHtml(group.name)}</h3><div class="muted">包含 ${(group.typeIds || []).length} 个业绩类型 · ${safeHtml(date)} 共 ${records.length} 笔，合并为 ${mergedItems.length} 项</div></div><div class="price-total"><span>${safeHtml(date)} ${showAggregateAmount ? '总价' : '汇总'}</span><b>${showAggregateAmount ? money(totalRecordPrice(records)) : hiddenAmountText()}</b>${showAggregateAmount && unpricedRecordCount(records) ? `<small>${unpricedRecordCount(records)} 笔待定价</small>` : ''}</div></div>
      ${typeItems.length ? `<div class="core-type-chips">${typeItems.map(x => `<span class="pill"><span class="dot" style="background:${x.type.color}"></span>${safeHtml(x.type.name)} ${formatValue(x.value, x.type.unit)}${showAggregateAmount ? ` · ${typePrice(x.type) === null ? '待定价' : money(x.totalPrice)}` : ''}</span>`).join('')}</div>` : '<div class="empty compact-empty">所选日期暂无符合条件的业绩</div>'}
      ${mergedItems.length ? `<div class="core-record-list">${mergedItems.map(x => { const showRowAmount = canViewAmountForMember(x.member.id); return `<div class="core-record-row core-merged-row"><div><span class="dot" style="background:${x.type.color}"></span><strong>${safeHtml(x.type.name)}</strong><span class="pill mini">${safeHtml(x.member.name)}</span><div class="item-sub">${formatValue(x.value, x.type.unit)}</div></div><div class="amount">${showRowAmount ? (typePrice(x.type) === null ? '待定价' : money(x.totalPrice)) : hiddenAmountText()}</div></div>`; }).join('')}</div>` : ''}
    </article>`;
  }).join('')}</div>`;
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
  syncBtn.textContent = syncMeta.status === 'syncing' ? '同步中…' : syncMeta.pending ? '有待同步' : '立即同步';
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
function cloudReady() { return completeCloudConfig(config); }
function cloudStatusTpl() {
  const ready = cloudReady();
  const company = config.companyName || PACKAGE_CLOUD_CONFIG.companyName || '当前单位';
  return `<section class="card cloud-status-card">
    <div class="section-title"><h2>统一云端数据</h2><span class="pill ${ready ? 'success-pill' : 'warning-pill'}">${ready ? '管理员已配置' : '尚未配置'}</span></div>
    <p class="muted">${ready ? `${safeHtml(company)} 已统一使用管理员设置的一个总数据目录。登录后系统会自动按账号读取对应人员数据，无需个人导入或填写存储位置。` : '普通用户无需导入云端配置。请管理员使用初始管理员账号登录后，在“我的”页面一次性设置全公司的总数据目录。'}</p>
  </section>`;
}
function authTpl() {
  const ready = cloudReady();
  return `<section class="card hero auth-hero">
    <div class="auth-logo">业绩助手</div>
    <h2>${ready ? '直接登录使用' : '等待管理员完成统一配置'}</h2>
    <p>${ready ? '软件已使用管理员统一设置的云端数据位置，并启用单账号单设备在线保护；登录后会自动拉取最新数据。' : '登录页已取消云端配置导入。管理员可使用初始账号进入设置；普通用户请联系管理员完成统一配置。'}</p>
  </section>
  ${cloudStatusTpl()}
  <section class="auth-grid ${ready ? '' : 'bootstrap-auth'}">
    <form id="loginForm" class="card">
      <div class="section-title"><h2>账号登录</h2><span class="pill">${ready ? '云端校验' : '管理员初始化'}</span></div>
      <div class="field"><label>账号</label><input name="username" autocomplete="username" placeholder="请输入账号" required></div>
      <div class="field"><label>密码</label><input name="password" type="password" autocomplete="current-password" placeholder="请输入密码" required></div>
      <button class="primary full" type="submit">${ready ? '登录' : '管理员登录并配置'}</button>
      ${ready ? '' : '<div class="field-hint">云端未配置时仅允许初始管理员账号进入设置页面。</div>'}
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

function moduleView(pageName) {
  return String((window.__moduleViews || {})[pageName] || (window.__moduleDefaults || {})[pageName] || '');
}
function moduleHubTpl(pageName, title, modules, subtitle = '从下拉框选择需要的功能板块，内容会直接显示在下方。') {
  const available = Array.isArray(modules) ? modules.filter(m => m && m.id) : [];
  const ids = new Set(available.map(m => String(m.id)));
  let active = moduleView(pageName);
  if (!ids.has(active)) active = String(available[0]?.id || '');
  window.__moduleDefaults = { ...(window.__moduleDefaults || {}), [pageName]: active };
  const stored = String((window.__moduleViews || {})[pageName] || '');
  if (stored !== active) {
    window.__moduleViews = { ...(window.__moduleViews || {}), [pageName]: active };
  }
  const current = available.find(m => String(m.id) === active) || available[0];
  return `<section class="card module-hub">
    <div class="section-title"><h2>${safeHtml(title)}</h2><span class="pill">下拉选择</span></div>
    <p class="muted">${safeHtml(subtitle)}</p>
    <div class="module-select-field">
      <label id="moduleSelectLabel_${safeHtml(pageName)}">选择功能板块</label>
      <div class="module-select-shell" data-module-dropdown data-module-page="${safeHtml(pageName)}">
        <button class="module-select-trigger" type="button" data-module-trigger aria-haspopup="listbox" aria-expanded="false" aria-labelledby="moduleSelectLabel_${safeHtml(pageName)} moduleSelectText_${safeHtml(pageName)}">
          <span class="module-trigger-icon">${safeHtml(current?.icon || '功能')}</span>
          <span class="module-trigger-copy">
            <small>当前功能</small>
            <strong id="moduleSelectText_${safeHtml(pageName)}">${safeHtml(current?.title || '请选择')}</strong>
          </span>
          <span class="module-chevron" aria-hidden="true"><i></i><i></i></span>
        </button>
        <div class="module-select-menu" data-module-menu role="listbox" aria-label="${safeHtml(title)}">
          ${available.map(m => `<button type="button" class="module-select-option ${String(m.id) === active ? 'is-selected' : ''}" data-module-option data-module-value="${safeHtml(m.id)}" role="option" aria-selected="${String(m.id) === active ? 'true' : 'false'}">
            <span class="module-option-icon">${safeHtml(m.icon || '功能')}</span>
            <span class="module-option-copy"><strong>${safeHtml(m.title)}</strong><small>${safeHtml(m.desc || '')}</small></span>
            <span class="module-option-check" aria-hidden="true">✓</span>
          </button>`).join('')}
        </div>
      </div>
    </div>
    ${current ? `<div class="module-current"><span class="module-icon">${safeHtml(current.icon || '功能')}</span><div><strong>${safeHtml(current.title)}</strong><small>${safeHtml(current.desc || '')}</small></div></div>` : ''}
  </section>`;
}
function moduleCardTpl(pageName, moduleId, title, content, badge = '', extraClass = '') {
  if (moduleView(pageName) !== moduleId) return '';
  return `<section class="card module-content ${extraClass}"><div class="section-title"><h2>${safeHtml(title)}</h2>${badge ? `<span class="pill">${safeHtml(badge)}</span>` : ''}</div>${content}</section>`;
}

function homeTpl() {
  const today = todayStr();
  const month = monthStr();
  const memberId = currentMemberFilter();
  const dRecs = dateRecords(today, memberId);
  const mRecs = monthRecords(month, memberId);
  const todayTypes = typeSummary(dRecs);
  const monthTypes = typeSummary(mRecs);
  const showDayAmount = canViewAggregateAmounts(dRecs);
  const showMonthAmount = canViewAggregateAmounts(mRecs);
  const best = (showMonthAmount ? monthTypes : [...monthTypes].sort((a,b) => b.value-a.value))[0];
  const user = currentUser();
  const selectedCoreDate = window.__coreSummaryDate || today;
  const modules = [
    { id: 'overview', icon: '概览', title: '今日与本月概览', desc: '查看关键数字并快速记录业绩' },
    { id: 'core', icon: '核心', title: '业绩核心汇总', desc: '按日期查看管理员定义的汇总大类' },
    { id: 'today', icon: '今日', title: '今日各项业绩', desc: '查看当天各类型数量与金额' },
    { id: 'month', icon: '本月', title: '本月各项业绩', desc: '查看本月类型汇总与最高项目' }
  ];
  const hub = moduleHubTpl('home', '首页功能', modules, '从下拉框选择首页功能，选中后只在下方显示对应板块。');
  const overview = moduleView('home') === 'overview' ? `
    <section class="card hero module-content">
      <div class="row"><div class="muted" style="color:rgba(255,255,255,.78)">${today}</div>${memberFilterTpl('homeMemberFilter')}</div>
      <div class="big">${showDayAmount ? `今日业绩总价 ${money(totalRecordPrice(dRecs))}` : `今日业绩汇总 ${dRecs.length} 笔`}</div>
      <div class="muted" style="color:rgba(255,255,255,.78); margin-top:6px">当前账号：${safeHtml(user.displayName || user.username)}${isAdmin(user) ? '（管理员）' : ''} · 今日上报 ${dRecs.length} 笔</div>
      <div class="grid" style="margin-top:14px">
        <div class="metric"><div class="label">今日涉及项目</div><div class="value">${todayTypes.length} 项</div></div>
        <div class="metric"><div class="label">${showMonthAmount ? '本月业绩总价' : '本月上报记录'}</div><div class="value" style="font-size:18px">${showMonthAmount ? money(totalRecordPrice(mRecs)) : `${mRecs.length} 笔`}</div></div>
      </div>
      ${showDayAmount && unpricedRecordCount(dRecs) ? `<div class="hero-warning">今日有 ${unpricedRecordCount(dRecs)} 笔业绩尚未定价，管理员定价后会自动回算。</div>` : ''}
    </section>
    <section class="grid quick-action-grid">
      <button class="primary" data-page-jump="add">+ 记录业绩</button>
      <button class="ghost" data-page-jump="month" data-module-open="overview">查看月统计</button>
    </section>` : '';
  const core = moduleCardTpl('home', 'core', '业绩核心汇总', `
    <div class="row wrap module-toolbar"><input id="coreSummaryDatePicker" type="date" value="${selectedCoreDate}" style="max-width:150px">${isAdmin(user) ? '<button class="ghost small" data-page-jump="settings" data-module-open="core">管理汇总大类</button>' : ''}<span class="pill">所有成员可见</span></div>
    <p class="muted">由管理员定义汇总大类及包含的业绩类型；可选择日期查看全体成员符合条件的业绩及归属人。${amountVisibilityMode() === 'all' || isAdmin(user) ? '' : '金额按管理员设置隐藏。'}</p>
    ${coreSummaryTpl(selectedCoreDate)}`);
  const todayPanel = moduleCardTpl('home', 'today', `今日各项业绩${showDayAmount ? '与价格' : ''}`, `
    <div class="row wrap module-toolbar"><span class="muted">${dRecs.length} 笔</span>${pricingHint(dRecs)}</div>
    ${summaryList(todayTypes)}`, today);
  const monthPanel = moduleCardTpl('home', 'month', `本月各项业绩${showMonthAmount ? '与价格' : ''}`, `
    ${summaryList(monthTypes, true)}
    <div class="grid module-summary-grid" style="margin-top:12px">
      <div class="metric light"><div class="label">${showMonthAmount ? '总价格最高项目' : '数量最高项目'}</div><div class="value" style="font-size:18px">${best ? safeHtml(best.type.name) : '暂无'}</div></div>
      <div class="metric light"><div class="label">参与成员</div><div class="value">${memberSummary(mRecs).length} 人</div></div>
    </div>`, month);
  return `${hub}${overview}${core}${todayPanel}${monthPanel}`;
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
      <div class="field"><label>业绩类型</label><select id="recordTypeSelect" name="typeId" required>${typeSelectOptions('', isAdmin(user) ? (state.members[0]?.id || '') : user.memberId, true)}</select><div id="recordPriceHint" class="field-hint">请选择业绩类型查看单价</div></div>
      <div class="field"><label>上报数量 / 数值</label><input name="value" type="number" inputmode="decimal" step="0.01" min="0" placeholder="例如 50、3、1" required /></div>
      <div class="field"><label>日期</label><input id="recordDatePicker" name="date" type="date" value="${todayStr()}" required /></div>
      <div class="field"><label>备注</label><textarea name="remark" placeholder="例如：信用卡上报情况。不要填写身份证、银行卡号等敏感信息。"></textarea></div>
      <button class="primary full" type="submit">保存记录</button>
    </form>
  </section>`;
}
function dayTpl() {
  const date = window.__selectedDate || todayStr();
  const memberId = currentMemberFilter();
  const recs = dateRecords(date, memberId).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const showAmount = canViewAggregateAmounts(recs);
  const modules = [
    { id: 'overview', icon: '概览', title: '日报概览', desc: '选择日期和成员并查看关键数字' },
    { id: 'types', icon: '分类', title: '各项业绩汇总', desc: '查看各类型当天数量与总价' },
    ...(isAdmin() ? [{ id: 'members', icon: '成员', title: '成员价格明细', desc: '查看每位成员当天业绩明细' }] : []),
    { id: 'details', icon: '明细', title: '当天记录明细', desc: '查看或删除有权限的原始记录' }
  ];
  const hub = moduleHubTpl('day', '日报功能', modules);
  const overview = moduleCardTpl('day', 'overview', '日报概览', `
    <div class="row wrap module-toolbar"><input id="dayPicker" type="date" value="${date}" style="max-width:150px">${memberFilterTpl('dayMemberFilter')}</div>
    <div class="grid">
      <div class="metric light"><div class="label">${showAmount ? '当天业绩总价' : '当天上报数量'}</div><div class="value" style="font-size:19px">${showAmount ? money(totalRecordPrice(recs)) : `${recs.length} 笔`}</div></div>
      <div class="metric light"><div class="label">上报记录 / 项目</div><div class="value" style="font-size:19px">${recs.length} 笔 / ${typeSummary(recs).length} 项</div></div>
    </div><div style="margin-top:10px">${pricingHint(recs)}</div>`, date);
  const types = moduleCardTpl('day', 'types', `各项业绩${showAmount ? '总价' : '汇总'}`, `<p class="muted">${showAmount ? '数量 × 管理员单价' : amountVisibilityLabel()}</p>${summaryList(typeSummary(recs))}`, date);
  const members = isAdmin() ? moduleCardTpl('day', 'members', '每位成员当日业绩价格明细', memberPricingBreakdown(recs, '当日'), '管理员视图') : '';
  const details = moduleCardTpl('day', 'details', '明细记录', recs.length ? `<div class="list">${recs.map(recordItem).join('')}</div>` : '<div class="empty">当天还没有记录</div>', date);
  return `${hub}${overview}${types}${members}${details}`;
}
function monthTpl() {
  const month = window.__selectedMonth || monthStr();
  const memberId = currentMemberFilter();
  const availableTrendTypes = isAdmin() && memberId === 'all' ? visibleTypes() : typesForMember(memberId);
  const selectedType = availableTrendTypes.some(t => t.id === window.__selectedTypeId) ? window.__selectedTypeId : '';
  const recs = monthRecords(month, memberId);
  const typeItems = typeSummary(recs);
  const showAmount = canViewAggregateAmounts(recs);
  const modules = [
    { id: 'overview', icon: '概览', title: '月度概览', desc: '选择月份和成员并查看总业绩' },
    { id: 'chart', icon: '排行', title: '类型月度对比', desc: '对比不同业绩的月总价或数量' },
    { id: 'distribution', icon: '占比', title: '业绩占比分布', desc: '查看各项业绩价格占当月总价格的比例' },
    { id: 'trend', icon: '趋势', title: '单项每日趋势', desc: '查看某一业绩类型每日变化' },
    { id: 'summary', icon: '汇总', title: '单项业绩汇总', desc: '查看每种业绩数量与总价' },
    ...(isAdmin() ? [{ id: 'members', icon: '成员', title: '成员月度明细', desc: '查看每位成员月度价格明细' }] : [])
  ];
  const hub = moduleHubTpl('month', '月报功能', modules);
  const overview = moduleCardTpl('month', 'overview', '月统计概览', `
    <div class="row wrap module-toolbar"><input id="monthPicker" type="month" value="${month}" style="max-width:135px">${memberFilterTpl('monthMemberFilter')}</div>
    <div class="big">${showAmount ? `本月业绩总价 ${money(totalRecordPrice(recs))}` : `本月共上报 ${recs.length} 笔`}</div>
    <div class="muted" style="margin-top:6px">共 ${recs.length} 笔；${showAmount ? '金额按各业绩类型当前单价实时计算，后补定价会自动回算。' : amountVisibilityLabel() + '。'}</div>
    <div style="margin-top:10px">${pricingHint(recs)}</div>`, month);
  const chart = moduleCardTpl('month', 'chart', `不同业绩月${showAmount ? '总价格' : '总数量'}`, typeBarChart(typeItems), showAmount ? '同时显示数量与总价' : '按业绩数量展示');
  const distribution = moduleCardTpl('month', 'distribution', '业绩占比分布', performanceShareDistribution(typeItems, recs), amountVisibilityMode() === 'hidden' ? '金额已隐藏，仅展示占比' : '按当月业绩价格计算');
  const trend = moduleCardTpl('month', 'trend', '单项业绩每日趋势', `
    <div class="module-toolbar"><select id="trendTypePicker" class="compact-select">${isAdmin() && memberId === 'all' ? typeSelectOptions(selectedType, '', true) : typeSelectOptions(selectedType, memberId, true)}</select></div>
    ${availableTrendTypes.length ? singleTypeDailyTrend(month, selectedType, memberId) : '<div class="empty">请先新增业绩类型</div>'}`, month);
  const summary = moduleCardTpl('month', 'summary', `本月单项业绩数量${showAmount ? '与总价' : ''}`, summaryList(typeItems, true), month);
  const members = isAdmin() ? moduleCardTpl('month', 'members', '每位成员月度业绩价格明细', memberPricingBreakdown(recs, '本月'), '管理员视图') : '';
  return `${hub}${overview}${chart}${distribution}${trend}${summary}${members}`;
}
function settingsTpl() {
  const user = currentUser();
  const admin = isAdmin(user);
  const toolsTitle = admin ? '数据工具（全部数据）' : '数据工具（仅本人数据）';
  const modules = [
    { id: 'account', icon: '账号', title: '账号与密码', desc: '查看当前账号、修改密码或退出' },
    { id: 'sync', icon: '同步', title: '自动同步状态', desc: '查看同步状态并手动拉取或上传' },
    { id: 'amount', icon: '金额', title: '金额显示权限', desc: admin ? '设置普通用户可见的金额范围' : '查看管理员设置的金额权限' },
    ...(admin ? [{ id: 'cloud', icon: '云端', title: '统一云端配置', desc: '修改全公司唯一数据存储位置' }] : []),
    ...(admin ? [{ id: 'registration', icon: '注册', title: '注册校验码', desc: '修改新用户注册校验码' }] : []),
    ...(admin ? [{ id: 'users', icon: '用户', title: '用户账号管理', desc: '重置密码、角色和账号状态' }] : []),
    ...(admin ? [{ id: 'members', icon: '成员', title: '成员管理', desc: '新增或维护成员资料' }] : []),
    { id: 'types', icon: '类别', title: admin ? '业绩类型与定价' : '我的业绩类型', desc: admin ? '定价并将个人类别转为公共类别' : '新增和查看个人可用类别' },
    ...(admin ? [{ id: 'core', icon: '核心', title: '核心汇总管理', desc: '维护首页核心汇总大类' }] : []),
    { id: 'reminder', icon: '提醒', title: '每日录入提醒', desc: '设置每天晚上的任务栏通知时间' },
    { id: 'tools', icon: '工具', title: toolsTitle, desc: '导出数据或清理有权限的记录' },
    { id: 'about', icon: '关于', title: '关于该应用程序', desc: '查看开发者、版本信息和使用说明' }
  ];
  const hub = moduleHubTpl('settings', '我的功能', modules, '从下拉框选择设置或管理功能，选中后只在下方显示对应板块。');
  const account = moduleCardTpl('settings', 'account', '当前账号', `
    <div class="profile-box"><div><strong>${safeHtml(user.displayName || user.username)}</strong><div class="muted">账号：${safeHtml(user.username)} · 数据编号：${safeHtml(user.id)} · 单设备登录保护已开启 · ${admin ? '可管理全部数据' : '只能上传和修改本人数据'}</div></div><button id="logoutBtn" class="ghost small">退出登录</button></div>
    <form id="changePasswordForm" class="mini-form"><div class="grid"><div class="field"><label>原密码</label><input name="oldPassword" type="password" required></div><div class="field"><label>新密码</label><input name="newPassword" type="password" minlength="4" required></div></div><button class="soft full" type="submit">修改密码</button></form>`, admin ? '管理员' : '普通用户');
  const sync = moduleView('settings') === 'sync' ? `${syncStatusPanelTpl()}<section class="card module-content"><div class="section-title"><h2>手动同步操作</h2><span class="pill">统一云端</span></div><p class="muted">${admin ? '管理员可拉取全员数据或执行初始化 / 安全同步。' : '无需配置云端地址；拉取公共配置与全员汇总，上传时只更新本人数据文件。'}</p><div class="row wrap"><button id="pullBtn" class="ghost">${admin ? '拉取全员数据' : '立即拉取'}</button><button id="pushBtn" class="soft">${admin ? '初始化 / 安全同步' : '安全同步本人数据'}</button></div></section>` : '';
  const amount = admin ? moduleCardTpl('settings', 'amount', '普通用户金额显示权限', `
    <p class="muted">管理员始终可以查看单价和金额。该设置控制普通用户页面、核心汇总和导出文件中的金额显示。</p>
    <form id="amountVisibilityForm"><div class="field"><label>普通用户金额查看范围</label><select name="amountVisibility"><option value="all" ${amountVisibilityMode() === 'all' ? 'selected' : ''}>显示全部公开金额（含核心汇总）</option><option value="own" ${amountVisibilityMode() === 'own' ? 'selected' : ''}>只显示本人金额，其他成员金额隐藏</option><option value="hidden" ${amountVisibilityMode() === 'hidden' ? 'selected' : ''}>所有单价、单项金额和总金额均隐藏</option></select></div><button class="primary full" type="submit">保存金额显示权限</button></form>
    <div class="field-hint">纯前端版本属于界面与应用逻辑限制；真正的强制保密需要后端鉴权。</div>`, '管理员控制') : moduleCardTpl('settings', 'amount', '金额显示权限', `<div class="readonly-box">${safeHtml(amountVisibilityLabel())}</div>`, '管理员设置');
  const cloud = admin ? moduleCardTpl('settings', 'cloud', '全公司统一云端数据位置', `
    <p class="muted">这里只设置一个总数据目录，系统会自动维护 public.json、pricing.json 和 users/用户编号.json；无需为每个人分别设置位置。</p>
    <form id="configForm"><div class="field"><label>单位/公司名称</label><input name="companyName" value="${safeHtml(config.companyName || '')}" placeholder="例如：XX支行"></div><div class="grid"><div class="field"><label>yunduan 用户名/组织</label><input name="owner" value="${safeHtml(config.owner)}" required></div><div class="field"><label>仓库名</label><input name="repo" value="${safeHtml(config.repo)}" required></div></div><div class="grid"><div class="field"><label>分支</label><input name="branch" value="${safeHtml(config.branch || 'master')}" required></div><div class="field"><label>全员总数据目录</label><input name="path" value="${safeHtml(config.path || 'data/performance-v14')}" required><div class="field-hint">只填写一个目录，不填写人员姓名，也不要填写 performance.json 文件名。</div></div></div><div class="field"><label>私人令牌 Access Token</label><input name="token" type="password" value="${safeHtml(config.token)}" required></div><button class="primary full" type="submit">保存全公司统一配置</button></form>
    <div class="field-hint">${packageCloudConfigLocked() ? '当前安装包已锁定内置统一配置。' : packageCloudConfigReady() ? '安装包内含默认统一配置；管理员保存后可在本设备覆盖。' : '当前安装包未预置实际仓库信息。'}</div>`, '一次配置') : '';
  const registration = admin ? moduleCardTpl('settings', 'registration', '注册校验码', `<form id="registrationCodeForm" class="mini-form"><div class="field"><label>当前注册校验码</label><input name="registrationCode" value="${safeHtml(state.registrationCode || '')}" required></div><button class="soft full" type="submit">保存注册校验码</button></form>`, '管理员管理') : '';
  const users = admin ? moduleCardTpl('settings', 'users', '用户账号管理', `<p class="muted">可停用账号、强制下线当前设备、仅永久删除登录账号，或连同成员资料和全部业绩数据一起永久删除。永久删除需要二次确认，并会立即同步到统一云端。</p><div class="list">${(state.users || []).map(userItem).join('')}</div>`) : '';
  const members = admin ? moduleCardTpl('settings', 'members', '成员管理', `<div class="row wrap module-toolbar"><span class="muted">维护成员姓名与岗位信息</span><button id="addMemberBtn" class="ghost small">新增成员</button></div><div class="list">${state.members.map(memberItem).join('')}</div>`) : '';
  const types = moduleCardTpl('settings', 'types', admin ? '业绩类型与定价管理' : '我的业绩类型', `
    <div class="row wrap module-toolbar"><p class="muted">${admin ? '可为公共类型和个人类型定价；个人类型可直接转为所有成员可用的公共类型。转换后原有记录不会丢失。' : '新增名称时会先匹配公共类型；同名公共类型存在时直接使用。'}</p><button id="addTypeBtn" class="ghost small">${admin ? '新增公共类型' : '新增个人类型'}</button></div>
    <div class="list">${visibleTypes(user).map(typeItem).join('') || `<div class="empty">${admin ? '暂无业绩类型' : '暂无业绩类型，可点击新增类型'}</div>`}</div>`);
  const core = admin ? moduleCardTpl('settings', 'core', '业绩核心汇总管理', `<p class="muted">添加首页展示的大类并勾选包含的业绩类型。所有成员可按日期查看。</p>${coreSummaryManagementTpl()}`, '仅管理员维护') : '';
  const reminder = moduleCardTpl('settings', 'reminder', '每日业绩录入提醒', `
    <p class="muted">开启后，每天到达设置时间时提醒当前设备用户录入当天业绩。本设置只保存在本机，不上传云端。</p>
    <form id="reminderForm" class="reminder-form">
      <label class="reminder-switch-row"><span><strong>启用每日提醒</strong><small>${reminderSettings.enabled ? `当前已启用，每天 ${safeHtml(reminderSettings.time)} 提醒` : '当前未启用'}</small></span><input name="enabled" type="checkbox" ${reminderSettings.enabled ? 'checked' : ''}></label>
      <div class="field"><label>提醒时间</label><input name="time" type="time" value="${safeHtml(reminderSettings.time)}" required></div>
      <button class="primary full" type="submit">保存提醒设置</button>
    </form>
    ${nativeReminderStatusTpl()}
    <div class="row wrap reminder-actions">
      <button id="testReminderBtn" class="ghost small" type="button">立即发送测试通知</button>
      ${hasNativeReminder() ? '<button id="backgroundTestReminderBtn" class="ghost small" type="button">1 分钟后后台测试</button><button id="notificationSettingsBtn" class="ghost small" type="button">通知设置</button><button id="alarmSettingsBtn" class="ghost small" type="button">精确定时设置</button><button id="batterySettingsBtn" class="ghost small" type="button">后台与电池设置</button>' : ''}
    </div>
    <div class="field-hint">${safeHtml(reminderPlatformHint())}</div>`, '本机设置');
  const tools = moduleCardTpl('settings', 'tools', toolsTitle, `<div class="row wrap"><button id="exportMonthlySummaryBtn" class="primary" style="${admin ? '' : 'display:none'}">导出当月全员汇总 XLSX</button><button id="exportExcelBtn" class="ghost">导出原有明细 Excel</button><button id="exportCsvBtn" class="ghost">导出 CSV</button><button id="exportTxtBtn" class="ghost">${admin ? '导出所有人 TXT' : '导出我的 TXT'}</button><button id="clearBtn" class="danger">${admin ? '清空全部记录' : '清空我的记录'}</button></div>`);
  const about = moduleCardTpl('settings', 'about', '关于该应用程序', `
    <div class="about-app">
      <div class="about-app-row"><span>开发者</span><strong>崔子坤</strong></div>
      <div class="about-app-row"><span>联系方式</span><strong>19836803588</strong></div>
      <div class="about-app-row"><span>当前版本</span><strong>${APP_VERSION}</strong></div>
      <p>该软件仅限内部人员提供便利使用，不作任何商业用途使用，欢迎交流学习。</p>
    </div>`, '内部使用');
  return `${hub}${account}${sync}${amount}${cloud}${registration}${users}${members}${types}${core}${reminder}${tools}${about}`;
}
function coreSummaryManagementTpl() {
  const editingId = window.__editingCoreSummaryId || '';
  const editing = (state.coreSummaries || []).find(x => x.id === editingId);
  const selected = new Set(editing?.typeIds || []);
  const types = visibleTypes(currentUser());
  return `<form id="coreSummaryForm" class="core-summary-form">
    <input type="hidden" name="id" value="${safeHtml(editing?.id || '')}">
    <div class="field"><label>汇总大类名称</label><input name="name" value="${safeHtml(editing?.name || '')}" placeholder="例如：重点零售业务、重点存款业务" required></div>
    <div class="field"><label>包含的业绩类型</label>
      ${types.length ? `<div class="type-checkbox-grid">${types.map(t => `<label class="check-card"><input type="checkbox" name="typeIds" value="${t.id}" ${selected.has(t.id) ? 'checked' : ''}><span><strong>${safeHtml(t.name)}</strong><small>${safeHtml(typeOwnerName(t))} · ${priceLabel(t)}</small></span></label>`).join('')}</div>` : '<div class="empty compact-empty">请先添加业绩类型</div>'}
    </div>
    <div class="row wrap"><button class="primary" type="submit">${editing ? '保存汇总大类' : '添加汇总大类'}</button>${editing ? '<button id="cancelCoreSummaryEdit" class="ghost" type="button">取消编辑</button>' : ''}</div>
  </form>
  <div class="list core-admin-list" style="margin-top:14px">${(state.coreSummaries || []).slice().sort((a,b) => Number(a.sortOrder || 0)-Number(b.sortOrder || 0)).map(coreSummaryAdminItem).join('') || '<div class="empty">暂无汇总大类</div>'}</div>`;
}
function coreSummaryAdminItem(group) {
  const types = (group.typeIds || []).map(typeById).filter(Boolean);
  return `<div class="item"><div style="flex:1"><div class="item-title">${safeHtml(group.name)} ${group.active === false ? '<span class="pill mini danger-pill">已停用</span>' : ''}</div><div class="item-sub">${types.length ? types.map(t => safeHtml(t.name)).join('、') : '尚未选择业绩类型'}</div></div><div class="row wrap"><button class="ghost small" data-edit-core-summary="${group.id}">编辑</button><button class="soft small" data-toggle-core-summary="${group.id}">${group.active === false ? '启用' : '停用'}</button><button class="danger small" data-delete-core-summary="${group.id}">删除</button></div></div>`;
}
function percentLabel(value) {
  const fixed = (Math.round(Number(value || 0) * 100) / 100).toFixed(2);
  return `${fixed.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}%`;
}
function performanceShareRows(items) {
  const rows = (items || []).map((item, index) => {
    const priced = typePrice(item.type) !== null;
    const amount = priced ? Math.max(0, Number(item.totalPrice || 0)) : 0;
    return { ...item, priced, amount, shareBasisPoints: 0, sourceIndex: index };
  });
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  if (total <= 0) return { rows, total, calculable: false };
  let assigned = 0;
  const remainders = [];
  rows.forEach((row, index) => {
    const exact = row.amount / total * 10000;
    const floorValue = Math.floor(exact);
    row.shareBasisPoints = floorValue;
    assigned += floorValue;
    remainders.push({ index, remainder: exact - floorValue, amount: row.amount });
  });
  remainders.sort((a, b) => b.remainder - a.remainder || b.amount - a.amount || a.index - b.index);
  for (let i = 0; i < 10000 - assigned; i += 1) rows[remainders[i % remainders.length].index].shareBasisPoints += 1;
  return { rows, total, calculable: true };
}
function performanceShareDistribution(items, records) {
  if (!items.length) return '<div class="empty">本月暂无业绩，暂不能生成占比分布</div>';
  const result = performanceShareRows(items);
  const showMoney = amountVisibilityMode() !== 'hidden' && canViewAggregateAmounts(records);
  const unpricedItems = result.rows.filter(row => !row.priced).length;
  const zeroAmountItems = result.rows.filter(row => row.priced && row.amount <= 0).length;
  const totalHeadline = showMoney
    ? `<span>当月业绩总价格</span><strong>${money(result.total)}</strong>`
    : `<span>当月总占比</span><strong>${result.calculable ? '100%' : '暂未形成'}</strong>`;
  const notice = !result.calculable
    ? '<div class="share-notice warning-pill">当前没有大于 0 元的已定价业绩，暂无法按价格分配占比。</div>'
    : `${unpricedItems ? `<div class="share-notice warning-pill">${unpricedItems} 项业绩尚未定价，暂不计入占比；管理员定价后将自动回算。</div>` : ''}${zeroAmountItems ? `<div class="share-notice">${zeroAmountItems} 项已定价业绩当月价格为 0 元，占比记为 0%。</div>` : ''}`;
  const stacked = result.calculable ? `<div class="share-stack" aria-label="业绩占比总览">${result.rows.filter(row => row.shareBasisPoints > 0).map(row => `<span title="${safeHtml(row.type.name)} ${percentLabel(row.shareBasisPoints / 100)}" style="width:${row.shareBasisPoints / 100}%;background:${row.type.color}"></span>`).join('')}</div>` : '';
  const sortedRows = result.rows.slice().sort((a, b) => b.shareBasisPoints - a.shareBasisPoints || b.amount - a.amount || a.sourceIndex - b.sourceIndex);
  return `<div class="performance-share">
    <div class="share-total-card"><div>${totalHeadline}</div><small>${result.calculable ? '各项占比经尾差校正，合计精确为 100%' : '占比以当月业绩价格为计算基础'}</small></div>
    ${stacked}${notice}
    <div class="share-list">${sortedRows.map(row => {
      const percent = result.calculable ? percentLabel(row.shareBasisPoints / 100) : '—';
      const amountText = !row.priced ? '待定价' : money(row.amount);
      return `<div class="share-row ${row.priced ? '' : 'is-unpriced'}">
        <div class="share-row-head"><div class="share-name"><span class="dot" style="background:${row.type.color}"></span><strong>${safeHtml(row.type.name)}</strong></div><div class="share-values"><b>${percent}</b>${showMoney ? `<span>${amountText}</span>` : ''}</div></div>
        <div class="share-track"><span style="width:${row.shareBasisPoints / 100}%;background:${row.type.color}"></span></div>
        ${showMoney ? `<div class="share-meta">${row.count} 笔 · ${formatValue(row.value, row.type.unit)}${row.priced ? ` · 单价 ${priceLabel(row.type)}` : ' · 未计入占比'}</div>` : ''}
      </div>`;
    }).join('')}</div>
  </div>`;
}
function summaryList(items, withProgress = false) {
  if (!items.length) return `<div class="empty">暂无数据</div>`;
  const showAmount = canViewAnyAmount();
  const max = Math.max(...items.map(x => showAmount ? (x.totalPrice || x.value) : x.value), 1);
  return `<div class="list">${items.map(x => {
    const priced = typePrice(x.type) !== null;
    const progressValue = showAmount && priced ? x.totalPrice : x.value;
    return `<div class="item summary-price-item">
      <div style="flex:1">
        <div class="item-title"><span class="dot" style="background:${x.type.color}"></span>${safeHtml(x.type.name)}</div>
        <div class="item-sub">${x.count} 笔 · ${formatValue(x.value, x.type.unit)}${showAmount ? ` · 单价 ${priceLabel(x.type)}` : ''}</div>
        ${withProgress ? `<div class="progress dark" style="margin-top:8px"><span style="width:${Math.max(4, progressValue / max * 100)}%; background:${x.type.color}"></span></div>` : ''}
      </div>
      <div class="price-stack"><span>${showAmount ? '总价格' : '汇总数量'}</span><b>${showAmount ? (priced ? money(x.totalPrice) : '待定价') : formatValue(x.value, x.type.unit)}</b>${showAmount && x.unpricedCount ? `<small>${x.unpricedCount} 笔未计价</small>` : ''}</div>
    </div>`;
  }).join('')}</div>`;
}
function memberSummaryList(items) {
  if (!items.length) return `<div class="empty">暂无成员上报数据</div>`;
  return `<div class="list">${items.map(x => `
    <div class="item">
      <div>
        <div class="item-title">${safeHtml(x.member.name)}</div>
        <div class="item-sub">${safeHtml(x.member.role || '未设置岗位')} · 涉及 ${x.typeCount} 项业绩 · ${x.count} 笔</div>
      </div>
      <div class="price-stack"><span>总价格</span><b>${money(x.totalPrice)}</b>${x.unpricedCount ? `<small>${x.unpricedCount} 笔待定价</small>` : ''}</div>
    </div>`).join('')}</div>`;
}
function recordItem(r) {
  const t = typeById(r.typeId) || { name:'已删除类型', unit:'', price:null, color:'#98A2B3' };
  const m = memberById(r.memberId) || { name:'未分配成员' };
  const canDelete = canAccessRecord(r);
  const totalPrice = recordPrice(r);
  const showAmount = canViewAmountForMember(r.memberId);
  return `<div class="item">
    <div style="flex:1">
      <div class="item-title"><span class="dot" style="background:${t.color}"></span>${safeHtml(t.name)} <span class="pill mini">${safeHtml(m.name)}</span></div>
      <div class="item-sub">${safeHtml(r.remark || '无备注')} · ${formatDateTime(r.createdAt)}${showAmount ? ` · 单价 ${priceLabel(t)}` : ''}</div>
    </div>
    <div class="row"><div class="record-value-price"><strong>${formatValue(r.value, t.unit)}</strong><span>${showAmount ? (totalPrice === null ? '待定价' : money(totalPrice)) : hiddenAmountText()}</span></div>${canDelete ? `<button class="danger small" data-delete-record="${r.id}">删除</button>` : ''}</div>
  </div>`;
}
function typeItem(t) {
  const mine = typeOwnerId(t) === currentUser()?.memberId;
  const global = isGlobalType(t);
  const canDelete = isAdmin() || mine;
  const showAmount = canViewAnyAmount();
  return `<div class="item">
    <div style="flex:1"><div class="item-title"><span class="dot" style="background:${t.color}"></span>${safeHtml(t.name)} ${isAdmin() ? `<span class="pill mini">${safeHtml(typeOwnerName(t))}</span>` : global ? '<span class="pill mini">公共类型</span>' : '<span class="pill mini">个人类型</span>'}</div><div class="item-sub">单位：${safeHtml(t.unit)}${showAmount ? ` · 单价：${priceLabel(t)}` : ' · 金额信息由管理员隐藏'}${mine && !isAdmin() && showAmount ? ' · 由管理员定价' : ''}</div></div>
    <div class="row wrap">${isAdmin() && !global ? `<button class="primary small" data-promote-type="${t.id}">转为公共</button>` : ''}${isAdmin() ? `<button class="soft small" data-price-type="${t.id}">${typePrice(t) === null ? '设置单价' : '修改单价'}</button>` : ''}${canDelete ? `<button class="danger small" data-delete-type="${t.id}">删除</button>` : ''}</div>
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
      <div class="item-sub">账号：${safeHtml(u.username)} · 数据编号：${safeHtml(u.id)} · 成员：${safeHtml(linkedMember?.name || '未关联')}</div>
    </div>
    <div class="row wrap user-actions">
      <button class="ghost small" data-reset-password="${u.id}">重置密码</button>
      ${isSelf ? '' : `<button class="soft small" data-toggle-role="${u.id}">${u.role === 'admin' ? '设为普通' : '设为管理员'}</button>`}
      ${isSelf ? '' : `<button class="soft small" data-toggle-user="${u.id}">${u.active === false ? '启用' : '停用'}</button>`}
      ${isSelf ? '' : `<button class="ghost small" data-force-logout-user="${u.id}">强制下线</button>`}
      ${isSelf ? '' : `<button class="ghost small" data-delete-account-only="${u.id}">仅删除账号</button>`}
      ${isSelf ? '' : `<button class="danger small" data-delete-account-data="${u.id}">删除账号及数据</button>`}
    </div>
  </div>`;
}
function typeBarChart(items) {
  if (!items.length) return `<div class="empty">本月暂无业绩数据</div>`;
  const showAmount = canViewAnyAmount();
  const max = Math.max(...items.map(x => showAmount ? (typePrice(x.type) === null ? 0 : x.totalPrice) : x.value), 1);
  return `<div class="type-chart">${items.map(x => {
    const priced = typePrice(x.type) !== null;
    const chartValue = showAmount && priced ? x.totalPrice : x.value;
    return `<div class="type-bar-row price-chart-row">
      <div class="type-bar-label" title="${safeHtml(x.type.name)}"><span class="dot" style="background:${x.type.color}"></span><span class="type-bar-name">${safeHtml(x.type.name)}</span></div>
      <div class="type-bar-track" aria-label="${safeHtml(x.type.name)}占比"><span style="width:${Math.max(3, chartValue / max * 100)}%; background:${x.type.color}"></span></div>
      <div class="type-bar-value">${showAmount ? (priced ? money(x.totalPrice) : '待定价') : formatValue(x.value, x.type.unit)}<small>${showAmount ? formatValue(x.value, x.type.unit) : `${x.count} 笔`}</small></div>
    </div>`;
  }).join('')}</div>`;
}
function singleTypeDailyTrend(month, typeId, memberId = currentMemberFilter()) {
  if (!typeId) return `<div class="empty">请选择业绩类型后查看每日趋势</div>`;
  const t = typeById(typeId);
  if (!t) return `<div class="empty">请选择有效的业绩类型</div>`;
  const days = daysInMonth(month);
  const monthRecs = monthRecords(month, memberId);
  const values = Array.from({ length: days }, (_, i) => {
    const day = `${month}-${String(i + 1).padStart(2, '0')}`;
    return monthRecs.filter(r => r.date === day && r.typeId === typeId).reduce((sum, r) => sum + Number(r.value || 0), 0);
  });
  const total = values.reduce((a, b) => a + b, 0);
  const max = Math.max(...values, 1);
  const showAmount = canViewAggregateAmounts(monthRecs.filter(r => r.typeId === typeId));
  return `<div class="trend-head"><div><strong>${safeHtml(t.name)}</strong><div class="muted">本月合计：${formatValue(total, t.unit)}${showAmount ? ` · 总价格：${typePrice(t) === null ? '待定价' : money(total * typePrice(t))}` : ''}</div></div></div>
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
      path: json.path || json.filePath || json['同步目录'] || json['数据路径'] || json['路径'],
      token: json.token || json.access_token || json['私人令牌'] || json['令牌']
    };
  } catch {}
  const aliases = {
    owner: ['owner','username','user','用户名','用户名/组织','用户','组织'],
    repo: ['repo','repository','仓库名','仓库'],
    branch: ['branch','分支'],
    path: ['path','filepath','file_path','同步目录','数据路径','路径'],
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
  return normalizeCloudConfig({
    companyName: String(fd.get('companyName') || '').trim(),
    owner: String(fd.get('owner') || '').trim(),
    repo: String(fd.get('repo') || '').trim(),
    branch: String(fd.get('branch') || 'master').trim(),
    path: String(fd.get('path') || 'data/performance-v14').trim(),
    token: String(fd.get('token') || '').trim()
  });
}
async function pullRemoteForAuth() {
  if (!cloudReady()) { showToast('请先填写并保存云端连接信息'); return false; }
  try {
    showToast('正在校验云端账号数据…');
    const remote = await getRemoteJson(publicFilePath());
    if (!remote) {
      showToast('云端尚未初始化；请使用管理员账号登录后执行初始化');
      return true;
    }
    state = composeStateFromDocuments(remote.data, null, []);
    saveLocal(false);
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
    const fd = new FormData(loginForm);
    const username = normalizeUsername(fd.get('username'));
    const passwordHash = await hashPassword(fd.get('password'));
    if (!cloudReady()) {
      const bootstrapAdmin = (state.users || []).find(u => u.role === 'admin' && normalizeUsername(u.username) === username && u.active !== false);
      if (!bootstrapAdmin || bootstrapAdmin.passwordHash !== passwordHash) { showToast('统一云端尚未配置，请使用初始管理员账号进入设置'); return; }
      ensureUserMember(bootstrapAdmin);
      saveSession(bootstrapAdmin);
      page = 'settings';
      render();
      showToast('请一次性设置全公司的云端总数据目录');
      return;
    }
    const ok = await pullRemoteForAuth();
    if (!ok) return;
    const user = (state.users || []).find(u => normalizeUsername(u.username) === username && u.active !== false);
    if (!user || user.passwordHash !== passwordHash) { showToast('账号或密码错误'); return; }
    ensureUserMember(user);
    let remoteAccountSession;
    try {
      await flushPendingSessionReleases();
      remoteAccountSession = await claimRemoteAccountSession(user);
    } catch (err) {
      console.error(err);
      showToast(err?.code === 'ACCOUNT_SESSION_CONFLICT' ? err.message : '登录状态写入云端失败，请检查网络后重试');
      return;
    }
    saveLocal(false);
    saveSession(user, remoteAccountSession);
    page = 'home';
    render();
    await pullFromYunduan(false);
    showToast('登录成功，已自动拉取云端最新数据');
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
      createdAt: now,
      updatedAt: now
    };
    const member = { id: memberId, name: displayName, role: '成员', active: true, createdAt: now, updatedAt: now };
    try {
      await registerUserOnRemote(user, member);
    } catch (err) {
      console.error(err);
      showToast(String(err?.message || '').includes('已存在') ? '该账号已存在' : '注册写入云端失败，请稍后重试');
      return;
    }
    let remoteAccountSession;
    try {
      remoteAccountSession = await claimRemoteAccountSession(user);
    } catch (err) {
      console.error(err);
      showToast(err?.code === 'ACCOUNT_SESSION_CONFLICT' ? err.message : '账号已注册，但登录状态写入失败，请返回登录页重试');
      return;
    }
    state.users.push(user);
    state.members.push(member);
    saveLocal(false);
    saveSession(user, remoteAccountSession);
    page = 'home';
    await pullFromYunduan(false);
    render();
    showToast('注册成功，已建立个人独立数据文件');
  };
}

/* v22 记录、日报与月报统一圆角灵动控件 */
function closeSmartSelects(except = null) {
  document.querySelectorAll('.smart-select.is-open').forEach(wrapper => {
    if (wrapper === except) return;
    wrapper.classList.remove('is-open', 'opens-up', 'is-selecting');
    wrapper.querySelector('.smart-select-trigger')?.setAttribute('aria-expanded', 'false');
  });
}
function smartSelectCurrentOption(select) {
  return [...(select?.options || [])].find(option => option.value === select.value) || select?.options?.[select?.selectedIndex] || null;
}
function enhanceSelectControl(select, { icon = '选', compact = false, wideMenu = false, menuLabel = '请选择' } = {}) {
  if (!select || select.dataset.smartEnhanced === 'true') return;
  select.dataset.smartEnhanced = 'true';
  const wrapper = document.createElement('div');
  wrapper.className = `smart-select${compact || select.classList.contains('compact-select') ? ' smart-select-compact' : ''}${wideMenu ? ' smart-select-wide-menu' : ''}`;
  select.parentNode.insertBefore(wrapper, select);
  wrapper.appendChild(select);
  select.classList.add('smart-select-native');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'smart-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = `<span class="smart-select-leading" aria-hidden="true"></span><span class="smart-select-value"></span><span class="smart-select-arrow" aria-hidden="true"><i></i><i></i></span>`;
  trigger.querySelector('.smart-select-leading').textContent = icon;

  const menu = document.createElement('div');
  menu.className = 'smart-select-menu';
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', menuLabel);
  wrapper.append(trigger, menu);

  const sync = () => {
    const selected = smartSelectCurrentOption(select);
    const valueNode = trigger.querySelector('.smart-select-value');
    valueNode.textContent = selected?.textContent?.trim() || menuLabel;
    valueNode.classList.toggle('is-placeholder', !select.value || !!selected?.disabled);
    [...menu.querySelectorAll('.smart-select-option')].forEach(option => {
      const active = option.dataset.value === select.value;
      option.classList.toggle('is-selected', active);
      option.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  };
  const rebuild = () => {
    menu.innerHTML = '';
    [...select.options].forEach((nativeOption, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'smart-select-option';
      option.dataset.value = nativeOption.value;
      option.setAttribute('role', 'option');
      option.disabled = nativeOption.disabled;
      option.innerHTML = `<span class="smart-option-index"></span><span class="smart-option-copy"></span><span class="smart-option-check" aria-hidden="true">✓</span>`;
      option.querySelector('.smart-option-index').textContent = nativeOption.disabled ? '·' : String(index + 1).padStart(2, '0');
      const optionCopy = option.querySelector('.smart-option-copy');
      optionCopy.textContent = nativeOption.textContent.trim();
      optionCopy.title = nativeOption.textContent.trim();
      option.onclick = event => {
        event.stopPropagation();
        if (nativeOption.disabled) return;
        if (select.value === nativeOption.value) {
          closeSmartSelects();
          trigger.focus({ preventScroll: true });
          return;
        }
        option.classList.add('is-choosing');
        wrapper.classList.add('is-selecting');
        select.value = nativeOption.value;
        sync();
        window.setTimeout(() => {
          closeSmartSelects();
          select.dispatchEvent(new Event('change', { bubbles: true }));
          trigger.focus({ preventScroll: true });
        }, 110);
      };
      option.onkeydown = event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const options = [...menu.querySelectorAll('.smart-select-option:not(:disabled)')];
          const position = options.indexOf(option);
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          options[(position + delta + options.length) % options.length]?.focus();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          closeSmartSelects();
          trigger.focus({ preventScroll: true });
        }
      };
      menu.appendChild(option);
    });
    sync();
  };
  trigger.onclick = event => {
    event.stopPropagation();
    const willOpen = !wrapper.classList.contains('is-open');
    closeSmartSelects(wrapper);
    document.querySelectorAll('[data-module-dropdown].is-open').forEach(dropdown => {
      dropdown.classList.remove('is-open');
      dropdown.closest('.module-hub')?.classList.remove('dropdown-open');
      dropdown.querySelector('[data-module-trigger]')?.setAttribute('aria-expanded', 'false');
    });
    if (!willOpen) {
      wrapper.classList.remove('is-open', 'opens-up');
      trigger.setAttribute('aria-expanded', 'false');
      return;
    }
    wrapper.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    const rect = trigger.getBoundingClientRect();
    const estimated = Math.min(menu.scrollHeight || 260, 330);
    wrapper.classList.toggle('opens-up', window.innerHeight - rect.bottom < estimated + 18 && rect.top > estimated);
    window.setTimeout(() => menu.querySelector('.smart-select-option.is-selected:not(:disabled)')?.focus({ preventScroll: true }), 35);
  };
  menu.onclick = event => event.stopPropagation();
  select.addEventListener('change', sync);
  select.__refreshSmartSelect = rebuild;
  rebuild();
}
function refreshEnhancedSelect(select) { select?.__refreshSmartSelect?.(); }

function parseTemporalValue(value, mode = 'date') {
  const fallback = new Date();
  const parts = String(value || '').split('-').map(Number);
  const year = parts[0] || fallback.getFullYear();
  const month = Math.min(12, Math.max(1, parts[1] || fallback.getMonth() + 1));
  const day = mode === 'month' ? 1 : Math.min(31, Math.max(1, parts[2] || fallback.getDate()));
  return { year, month, day };
}
function temporalDisplay(value, mode = 'date') {
  if (!value) return mode === 'month' ? '请选择月份' : '请选择日期';
  const { year, month, day } = parseTemporalValue(value, mode);
  return mode === 'month' ? `${year}年${month}月` : `${year}年${month}月${day}日`;
}
function temporalValue(year, month, day = 1, mode = 'date') {
  const y = String(year).padStart(4, '0');
  const m = String(month).padStart(2, '0');
  return mode === 'month' ? `${y}-${m}` : `${y}-${m}-${String(day).padStart(2, '0')}`;
}
function closeTemporalPicker(immediate = false) {
  const overlay = document.querySelector('.temporal-picker-overlay');
  if (!overlay) return;
  overlay.classList.add('is-closing');
  document.body.classList.remove('temporal-picker-open');
  const remove = () => { overlay.remove(); if (window.__activeTemporalPicker === overlay) window.__activeTemporalPicker = null; };
  if (immediate) remove(); else window.setTimeout(remove, 180);
}
function openTemporalPicker(input, mode = 'date', title = '') {
  if (!input) return;
  closeSmartSelects();
  closeTemporalPicker(true);
  const selected = parseTemporalValue(input.value, mode);
  const today = parseTemporalValue(mode === 'month' ? monthStr() : todayStr(), mode);
  let viewYear = selected.year;
  let viewMonth = selected.month;
  const overlay = document.createElement('div');
  overlay.className = `temporal-picker-overlay temporal-${mode}`;
  overlay.innerHTML = `<div class="temporal-picker-backdrop"></div><section class="temporal-picker-sheet" role="dialog" aria-modal="true"><div class="temporal-picker-handle" aria-hidden="true"></div><div class="temporal-picker-title"><div><small>${mode === 'month' ? '月份选择' : '日期选择'}</small><strong></strong></div><button type="button" class="temporal-picker-close" aria-label="关闭">×</button></div><div class="temporal-picker-navigation"><button type="button" data-picker-prev aria-label="上一个">‹</button><strong data-picker-heading></strong><button type="button" data-picker-next aria-label="下一个">›</button></div><div class="temporal-picker-content"></div><div class="temporal-picker-footer"><button type="button" class="ghost small" data-picker-cancel>取消</button><button type="button" class="soft small" data-picker-today>${mode === 'month' ? '本月' : '今天'}</button></div></section>`;
  overlay.querySelector('.temporal-picker-title strong').textContent = title || (mode === 'month' ? '选择统计月份' : '选择日期');
  document.body.appendChild(overlay);
  document.body.classList.add('temporal-picker-open');
  window.__activeTemporalPicker = overlay;
  requestAnimationFrame(() => overlay.classList.add('is-visible'));

  const commit = value => {
    input.value = value;
    input.__refreshTemporal?.();
    const sheet = overlay.querySelector('.temporal-picker-sheet');
    sheet?.classList.add('is-confirming');
    window.setTimeout(() => {
      closeTemporalPicker();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, 105);
  };
  const renderPicker = () => {
    const heading = overlay.querySelector('[data-picker-heading]');
    const content = overlay.querySelector('.temporal-picker-content');
    if (mode === 'month') {
      heading.textContent = `${viewYear}年`;
      content.innerHTML = `<div class="month-picker-grid">${Array.from({ length: 12 }, (_, index) => {
        const month = index + 1;
        const value = temporalValue(viewYear, month, 1, 'month');
        const selectedClass = value === input.value ? ' is-selected' : '';
        const todayClass = viewYear === today.year && month === today.month ? ' is-today' : '';
        return `<button type="button" class="month-picker-cell${selectedClass}${todayClass}" data-picker-value="${value}"><span>${month}月</span><small>${['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][index]}</small></button>`;
      }).join('')}</div>`;
    } else {
      heading.textContent = `${viewYear}年${viewMonth}月`;
      const firstWeekday = new Date(viewYear, viewMonth - 1, 1).getDay();
      const days = new Date(viewYear, viewMonth, 0).getDate();
      const cells = [];
      for (let i = 0; i < firstWeekday; i++) cells.push('<span class="date-picker-cell is-empty"></span>');
      for (let day = 1; day <= days; day++) {
        const value = temporalValue(viewYear, viewMonth, day, 'date');
        const selectedClass = value === input.value ? ' is-selected' : '';
        const todayClass = viewYear === today.year && viewMonth === today.month && day === today.day ? ' is-today' : '';
        cells.push(`<button type="button" class="date-picker-cell${selectedClass}${todayClass}" data-picker-value="${value}"><span>${day}</span></button>`);
      }
      content.innerHTML = `<div class="date-picker-weekdays">${['日','一','二','三','四','五','六'].map(day => `<span>${day}</span>`).join('')}</div><div class="date-picker-grid">${cells.join('')}</div>`;
    }
    content.querySelectorAll('[data-picker-value]').forEach(button => button.onclick = () => commit(button.dataset.pickerValue));
  };
  overlay.querySelector('[data-picker-prev]').onclick = () => {
    if (mode === 'month') viewYear -= 1;
    else { viewMonth -= 1; if (viewMonth < 1) { viewMonth = 12; viewYear -= 1; } }
    renderPicker();
  };
  overlay.querySelector('[data-picker-next]').onclick = () => {
    if (mode === 'month') viewYear += 1;
    else { viewMonth += 1; if (viewMonth > 12) { viewMonth = 1; viewYear += 1; } }
    renderPicker();
  };
  overlay.querySelector('[data-picker-today]').onclick = () => commit(mode === 'month' ? monthStr() : todayStr());
  overlay.querySelector('[data-picker-cancel]').onclick = () => closeTemporalPicker();
  overlay.querySelector('.temporal-picker-close').onclick = () => closeTemporalPicker();
  overlay.querySelector('.temporal-picker-backdrop').onclick = () => closeTemporalPicker();
  overlay.querySelector('.temporal-picker-sheet').onclick = event => event.stopPropagation();
  renderPicker();
}
function enhanceTemporalControl(input, { mode = input?.type === 'month' ? 'month' : 'date', title = '', compact = false } = {}) {
  if (!input || input.dataset.temporalEnhanced === 'true') return;
  input.dataset.temporalEnhanced = 'true';
  const wrapper = document.createElement('div');
  wrapper.className = `smart-temporal${compact ? ' smart-temporal-compact' : ''}`;
  input.parentNode.insertBefore(wrapper, input);
  wrapper.appendChild(input);
  input.classList.add('smart-temporal-native');
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'smart-temporal-trigger';
  trigger.innerHTML = `<span class="smart-temporal-icon" aria-hidden="true">${mode === 'month' ? '月' : '日'}</span><span class="smart-temporal-copy"><small>${mode === 'month' ? '统计月份' : '选择日期'}</small><strong></strong></span><span class="smart-temporal-arrow" aria-hidden="true">›</span>`;
  wrapper.appendChild(trigger);
  const sync = () => { trigger.querySelector('strong').textContent = temporalDisplay(input.value, mode); };
  trigger.onclick = event => { event.stopPropagation(); openTemporalPicker(input, mode, title); };
  input.addEventListener('change', sync);
  input.__refreshTemporal = sync;
  sync();
}
function refreshTemporalControl(input) { input?.__refreshTemporal?.(); }
function enhanceReportControls() {
  enhanceSelectControl(document.getElementById('recordMemberSelect'), { icon: '人', menuLabel: '选择记录成员' });
  enhanceSelectControl(document.getElementById('recordTypeSelect'), { icon: '类', menuLabel: '选择业绩类型' });
  enhanceSelectControl(document.getElementById('dayMemberFilter'), { icon: '人', compact: true, wideMenu: true, menuLabel: '选择日报成员' });
  enhanceSelectControl(document.getElementById('monthMemberFilter'), { icon: '人', compact: true, wideMenu: true, menuLabel: '选择月报成员' });
  enhanceTemporalControl(document.getElementById('recordDatePicker'), { mode: 'date', title: '选择业绩记录日期' });
  enhanceTemporalControl(document.getElementById('dayPicker'), { mode: 'date', title: '选择日报日期', compact: true });
  enhanceTemporalControl(document.getElementById('monthPicker'), { mode: 'month', title: '选择月报月份', compact: true });
}

function bindPage() {
  document.querySelectorAll('[data-page-jump]').forEach(b => b.onclick = () => {
    page = b.dataset.pageJump;
    if (b.dataset.moduleOpen) { window.__moduleViews = { ...(window.__moduleViews || {}), [page]: b.dataset.moduleOpen }; }
    render();
  });
  const closeModuleDropdowns = except => {
    document.querySelectorAll('[data-module-dropdown].is-open').forEach(dropdown => {
      if (dropdown === except) return;
      dropdown.classList.remove('is-open');
      dropdown.closest('.module-hub')?.classList.remove('dropdown-open');
      dropdown.querySelector('[data-module-trigger]')?.setAttribute('aria-expanded', 'false');
    });
  };
  document.querySelectorAll('[data-module-dropdown]').forEach(dropdown => {
    const trigger = dropdown.querySelector('[data-module-trigger]');
    const menu = dropdown.querySelector('[data-module-menu]');
    if (!trigger || !menu) return;
    trigger.onclick = event => {
      event.stopPropagation();
      closeSmartSelects();
      const willOpen = !dropdown.classList.contains('is-open');
      closeModuleDropdowns(dropdown);
      dropdown.classList.toggle('is-open', willOpen);
      dropdown.closest('.module-hub')?.classList.toggle('dropdown-open', willOpen);
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      if (willOpen) {
        const selectedOption = dropdown.querySelector('[data-module-option].is-selected');
        selectedOption?.focus({ preventScroll: true });
      }
    };
    menu.onclick = event => event.stopPropagation();
    dropdown.querySelectorAll('[data-module-option]').forEach(option => {
      option.onclick = event => {
        event.stopPropagation();
        const modulePage = dropdown.dataset.modulePage || page;
        const nextValue = option.dataset.moduleValue || '';
        const currentValue = String((window.__moduleViews || {})[modulePage] || '');
        if (!nextValue || nextValue === currentValue) {
          dropdown.classList.remove('is-open');
          dropdown.closest('.module-hub')?.classList.remove('dropdown-open');
          trigger.setAttribute('aria-expanded', 'false');
          trigger.focus({ preventScroll: true });
          return;
        }
        option.classList.add('is-choosing');
        dropdown.classList.add('is-selecting');
        window.__moduleViews = { ...(window.__moduleViews || {}), [modulePage]: nextValue };
        window.setTimeout(() => {
          render();
          try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch { window.scrollTo(0, 0); }
        }, 105);
      };
      option.onkeydown = event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const options = [...dropdown.querySelectorAll('[data-module-option]')];
          const index = options.indexOf(option);
          const delta = event.key === 'ArrowDown' ? 1 : -1;
          options[(index + delta + options.length) % options.length]?.focus();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          dropdown.classList.remove('is-open');
          dropdown.closest('.module-hub')?.classList.remove('dropdown-open');
          trigger.setAttribute('aria-expanded', 'false');
          trigger.focus({ preventScroll: true });
        }
      };
    });
  });
  document.onclick = event => {
    if (!event.target.closest('[data-module-dropdown]')) closeModuleDropdowns();
    if (!event.target.closest('.smart-select')) closeSmartSelects();
  };
  document.onkeydown = event => {
    if (event.key === 'Escape') {
      closeModuleDropdowns();
      closeSmartSelects();
      closeTemporalPicker();
    }
  };
  ['homeMemberFilter', 'dayMemberFilter', 'monthMemberFilter'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.onchange = e => { window.__memberFilter = e.target.value; render(); };
  });
  const coreSummaryDatePicker = document.getElementById('coreSummaryDatePicker');
  if (coreSummaryDatePicker) coreSummaryDatePicker.onchange = e => { window.__coreSummaryDate = e.target.value || todayStr(); render(); };
  const recordMemberSelect = document.getElementById('recordMemberSelect');
  const recordTypeSelect = document.getElementById('recordTypeSelect');
  const updateRecordPriceHint = () => {
    const hint = document.getElementById('recordPriceHint');
    const t = typeById(recordTypeSelect?.value || '');
    if (hint) hint.textContent = !canViewAnyAmount() ? '管理员已隐藏金额信息；业绩数量仍可正常上报' : (t ? `当前单价：${typePrice(t) === null ? '待管理员定价，保存后暂不计入金额' : priceLabel(t)}` : '请选择业绩类型查看单价');
  };
  if (recordMemberSelect && recordTypeSelect) recordMemberSelect.onchange = e => {
    recordTypeSelect.innerHTML = typeSelectOptions('', e.target.value, true);
    refreshEnhancedSelect(recordTypeSelect);
    updateRecordPriceHint();
  };
  if (recordTypeSelect) { recordTypeSelect.onchange = updateRecordPriceHint; updateRecordPriceHint(); }
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
    const now = new Date().toISOString();
    state.records.push({
      id: uid(),
      memberId,
      typeId,
      value: Number(fd.get('value')),
      date: fd.get('date') || todayStr(),
      remark: fd.get('remark'),
      createdAt: now,
      updatedAt: now,
      createdBy: user.id
    });
    saveLocal();
    showToast('已保存，正在自动安全同步');
    recordForm.reset();
    if (recordForm.memberId) recordForm.memberId.value = isAdmin(user) ? (state.members[0]?.id || '') : user.memberId;
    if (recordTypeSelect) recordTypeSelect.innerHTML = typeSelectOptions('', isAdmin(user) ? (state.members[0]?.id || '') : user.memberId, true);
    refreshEnhancedSelect(recordMemberSelect);
    refreshEnhancedSelect(recordTypeSelect);
    updateRecordPriceHint();
    recordForm.date.value = todayStr();
    refreshTemporalControl(recordForm.date);
  };
  const dayPicker = document.getElementById('dayPicker');
  if (dayPicker) dayPicker.onchange = e => { window.__selectedDate = e.target.value; render(); };
  const monthPicker = document.getElementById('monthPicker');
  if (monthPicker) monthPicker.onchange = e => { window.__selectedMonth = e.target.value; render(); };
  const trendTypePicker = document.getElementById('trendTypePicker');
  if (trendTypePicker) trendTypePicker.onchange = e => { window.__selectedTypeId = e.target.value; render(); };
  enhanceReportControls();
  document.querySelectorAll('[data-delete-record]').forEach(b => b.onclick = () => {
    const rec = state.records.find(r => r.id === b.dataset.deleteRecord);
    if (!rec || !canAccessRecord(rec)) { showToast('无权限删除该记录'); return; }
    if (!confirm('确定删除这条记录？')) return;
    const deletedAt = new Date().toISOString();
    state.records = state.records.filter(r => r.id !== b.dataset.deleteRecord);
    state.deletedRecords = mergeLatestById(state.deletedRecords || [], [{ id: rec.id, memberId: rec.memberId, deletedAt, deletedBy: currentUser()?.id || '' }]);
    saveLocal(); render();
  });
  document.querySelectorAll('[data-promote-type]').forEach(b => b.onclick = () => {
    if (!isAdmin()) { showToast('只有管理员可以转换公共业绩类型'); return; }
    const t = typeById(b.dataset.promoteType);
    if (!t || isGlobalType(t)) return;
    const oldOwnerId = typeOwnerId(t);
    const oldOwner = typeOwnerName(t);
    const existing = findGlobalTypeByName(t.name);
    const mergeText = existing && existing.id !== t.id ? `系统已存在同名公共类型“${existing.name}”，转换时将合并记录并保留公共类型定价。` : '转换后该类别将对所有成员开放，原有记录和定价保持不变。';
    if (!confirm(`确定将“${t.name}”（原归属：${oldOwner}）转为公共业绩类型？\n\n${mergeText}`)) return;
    const now = new Date().toISOString();
    if (existing && existing.id !== t.id) {
      if (typePrice(existing) === null && typePrice(t) !== null) {
        existing.price = typePrice(t);
        existing.pricingUpdatedAt = now;
        existing.pricingUpdatedBy = currentUser()?.id || '';
      }
      state.records = (state.records || []).map(r => r.typeId === t.id ? { ...r, typeId: existing.id, updatedAt: now } : r);
      state.coreSummaries = (state.coreSummaries || []).map(g => ({ ...g, typeIds: Array.from(new Set((g.typeIds || []).map(id => id === t.id ? existing.id : id))), updatedAt: now, updatedBy: currentUser()?.id || '' }));
      t.active = false;
      t.mergedIntoTypeId = existing.id;
      t.promotedFromMemberId = oldOwnerId;
      t.promotedAt = now;
      t.updatedAt = now;
      saveLocal(); render(); showToast(`已合并到公共类型“${existing.name}”`);
      return;
    }
    const publicCount = typesForOwnerCount(state.types, 'global');
    t.ownerMemberId = 'global';
    t.scope = 'global';
    t.sortOrder = publicCount + 1;
    t.promotedFromMemberId = oldOwnerId;
    t.promotedAt = now;
    t.promotedBy = currentUser()?.id || '';
    t.updatedAt = now;
    reconcileStateGlobalTypes();
    saveLocal(); render(); showToast(`“${t.name}”已转为公共业绩类型`);
  });
  document.querySelectorAll('[data-delete-type]').forEach(b => b.onclick = () => {
    const t = typeById(b.dataset.deleteType);
    if (!t) return;
    if (!isAdmin() && typeOwnerId(t) !== currentUser()?.memberId) { showToast('只能删除自己的业绩类型'); return; }
    if (!isAdmin() && (typePrice(t) !== null || (state.coreSummaries || []).some(g => (g.typeIds || []).includes(t.id)))) { showToast('该类型已由管理员定价或纳入核心汇总，不能由用户删除'); return; }
    if (state.records.some(r => r.typeId === b.dataset.deleteType)) { showToast('该类型已有记录，不能直接删除'); return; }
    if (!confirm('确定删除该业绩类型？')) return;
    const deletedAt = new Date().toISOString();
    t.active = false;
    t.deletedAt = deletedAt;
    t.updatedAt = deletedAt;
    state.coreSummaries = (state.coreSummaries || []).map(g => ({ ...g, typeIds: (g.typeIds || []).filter(id => id !== b.dataset.deleteType), updatedAt: deletedAt, updatedBy: currentUser()?.id || '' }));
    saveLocal(); render();
  });
  document.querySelectorAll('[data-price-type]').forEach(b => b.onclick = () => {
    if (!isAdmin()) { showToast('只有管理员可以设置业绩单价'); return; }
    const t = typeById(b.dataset.priceType);
    if (!t) return;
    const current = typePrice(t);
    const input = prompt(`请设置“${t.name}”每 ${t.unit || '单位'} 的单价（元）`, current === null ? '' : String(current));
    if (input === null) return;
    const value = Number(String(input).trim());
    if (!Number.isFinite(value) || value < 0) { showToast('请输入大于或等于 0 的有效单价'); return; }
    t.price = value;
    t.pricingUpdatedAt = new Date().toISOString();
    t.pricingUpdatedBy = currentUser()?.id || '';
    t.updatedAt = t.pricingUpdatedAt;
    saveLocal(); render(); showToast(`已将 ${t.name} 单价设置为 ${money(value)}`);
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
    const nameInput = prompt(isAdmin(user) ? '请输入公共业绩类型名称，例如：养老金账户' : '请输入业绩类型名称，系统会先核对管理员公共类型');
    const name = String(nameInput || '').trim();
    if (!name) return;
    const globalMatch = findGlobalTypeByName(name);
    if (!isAdmin(user) && globalMatch) {
      showToast(`已匹配管理员类型“${globalMatch.name}”，将直接使用公共类型及其定价`);
      return;
    }
    if (isAdmin(user) && globalMatch) { showToast('已存在同名公共业绩类型'); return; }
    const ownerMemberId = isAdmin(user) ? 'global' : user.memberId;
    const ownMatch = (state.types || []).find(t => typeOwnerId(t) === ownerMemberId && canonicalTypeName(t.name) === canonicalTypeName(name));
    if (ownMatch) { showToast('已存在同名业绩类型'); return; }
    const unit = String(prompt('请输入单位：万元 / 元 / 笔 / 户 / 张 / 次 / 件 / 份', '笔') || '笔').trim() || '笔';
    let price = null;
    if (isAdmin(user)) {
      const priceInput = prompt(`请输入“${name}”每 ${unit} 的单价（元），也可留空稍后设置`, '');
      if (priceInput !== null && String(priceInput).trim() !== '') {
        const parsed = Number(priceInput);
        if (!Number.isFinite(parsed) || parsed < 0) { showToast('单价格式无效，已取消新增'); return; }
        price = parsed;
      }
    }
    const sameOwnerTypes = typesForOwnerCount(state.types, ownerMemberId);
    const createdAt = new Date().toISOString();
    state.types.push({ id: uid(), name, unit, price, color: COLORS[state.types.length % COLORS.length], active: true, sortOrder: sameOwnerTypes + 1, ownerMemberId, scope: isAdmin(user) ? 'global' : 'private', createdBy: user.id, createdAt, updatedAt: createdAt, pricingUpdatedAt: price === null ? '' : createdAt, pricingUpdatedBy: price === null ? '' : user.id });
    if (isAdmin(user)) reconcileStateGlobalTypes();
    saveLocal(); render();
    showToast(isAdmin(user) ? '公共业绩类型已新增' : '个人业绩类型已新增，等待管理员定价');
  };
  const addMemberBtn = document.getElementById('addMemberBtn');
  if (addMemberBtn) addMemberBtn.onclick = () => {
    if (!isAdmin()) { showToast('只有管理员可以新增成员'); return; }
    const name = prompt('请输入成员姓名，例如：崔子坤'); if (!name) return;
    const role = prompt('请输入岗位/备注，例如：客户经理', '客户经理') || '';
    const createdAt = new Date().toISOString();
    state.members.push({ id: uid(), name, role, active: true, createdAt, updatedAt: createdAt });
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
    u.updatedAt = new Date().toISOString();
    saveLocal(); render(); showToast('密码已重置');
  });
  document.querySelectorAll('[data-toggle-user]').forEach(b => b.onclick = async () => {
    if (!isAdmin()) return;
    const u = state.users.find(x => x.id === b.dataset.toggleUser);
    if (!u || u.id === currentUser()?.id) return;
    u.active = u.active === false;
    u.updatedAt = new Date().toISOString();
    saveLocal();
    if (u.active === false) {
      try { await forceReleaseAccountSessionForUser(u.id); }
      catch (err) { console.error(err); }
    }
    render(); showToast(u.active ? '账号已启用' : '账号已停用并强制下线');
  });
  document.querySelectorAll('[data-force-logout-user]').forEach(b => b.onclick = async () => {
    if (!isAdmin()) return;
    const u = state.users.find(x => x.id === b.dataset.forceLogoutUser);
    if (!u || u.id === currentUser()?.id) return;
    if (!confirm(`确定强制下线“${u.displayName || u.username}”吗？`)) return;
    try {
      await forceReleaseAccountSessionForUser(u.id);
      showToast('该账号已强制下线，可在其他设备重新登录');
    } catch (err) {
      console.error(err);
      showToast(`强制下线失败：${String(err?.message || '请检查网络').slice(0, 70)}`);
    }
  });
  document.querySelectorAll('[data-toggle-role]').forEach(b => b.onclick = () => {
    if (!isAdmin()) return;
    const u = state.users.find(x => x.id === b.dataset.toggleRole);
    if (!u || u.id === currentUser()?.id) return;
    u.role = u.role === 'admin' ? 'user' : 'admin';
    u.updatedAt = new Date().toISOString();
    saveLocal(); render(); showToast('账号角色已更新');
  });
  document.querySelectorAll('[data-delete-account-only]').forEach(b => b.onclick = async () => {
    await requestPermanentUserDeletion(b.dataset.deleteAccountOnly, 'account_only');
  });
  document.querySelectorAll('[data-delete-account-data]').forEach(b => b.onclick = async () => {
    await requestPermanentUserDeletion(b.dataset.deleteAccountData, 'account_and_data');
  });
  const coreSummaryForm = document.getElementById('coreSummaryForm');
  if (coreSummaryForm) coreSummaryForm.onsubmit = e => {
    e.preventDefault();
    if (!isAdmin()) { showToast('只有管理员可以维护核心汇总'); return; }
    const fd = new FormData(coreSummaryForm);
    const id = String(fd.get('id') || '');
    const name = String(fd.get('name') || '').trim();
    const typeIds = fd.getAll('typeIds').map(String).filter(typeId => !!typeById(typeId));
    if (!name) { showToast('请填写汇总大类名称'); return; }
    if (!typeIds.length) { showToast('请至少选择一个业绩类型'); return; }
    const existing = (state.coreSummaries || []).find(x => x.id === id);
    if (existing) {
      existing.name = name;
      existing.typeIds = Array.from(new Set(typeIds));
      existing.updatedAt = new Date().toISOString();
      existing.updatedBy = currentUser()?.id || '';
    } else {
      state.coreSummaries = state.coreSummaries || [];
      { const createdAt = new Date().toISOString(); state.coreSummaries.push({ id: uid(), name, typeIds: Array.from(new Set(typeIds)), active: true, sortOrder: state.coreSummaries.length + 1, createdAt, updatedAt: createdAt, createdBy: currentUser()?.id || '' }); }
    }
    window.__editingCoreSummaryId = '';
    saveLocal(); render(); showToast(existing ? '核心汇总大类已更新' : '核心汇总大类已添加');
  };
  const cancelCoreSummaryEdit = document.getElementById('cancelCoreSummaryEdit');
  if (cancelCoreSummaryEdit) cancelCoreSummaryEdit.onclick = () => { window.__editingCoreSummaryId = ''; render(); };
  document.querySelectorAll('[data-edit-core-summary]').forEach(b => b.onclick = () => { if (!isAdmin()) return; window.__editingCoreSummaryId = b.dataset.editCoreSummary; render(); document.getElementById('coreSummaryManagement')?.scrollIntoView({ behavior:'smooth' }); });
  document.querySelectorAll('[data-toggle-core-summary]').forEach(b => b.onclick = () => {
    if (!isAdmin()) return;
    const group = (state.coreSummaries || []).find(x => x.id === b.dataset.toggleCoreSummary);
    if (!group) return;
    group.active = group.active === false;
    group.updatedAt = new Date().toISOString();
    group.updatedBy = currentUser()?.id || '';
    saveLocal(); render();
  });
  document.querySelectorAll('[data-delete-core-summary]').forEach(b => b.onclick = () => {
    if (!isAdmin()) return;
    if (!confirm('确定删除该核心汇总大类？')) return;
    const group = (state.coreSummaries || []).find(x => x.id === b.dataset.deleteCoreSummary);
    if (group) { group.active = false; group.deletedAt = new Date().toISOString(); group.updatedAt = group.deletedAt; group.updatedBy = currentUser()?.id || ''; }
    if (window.__editingCoreSummaryId === b.dataset.deleteCoreSummary) window.__editingCoreSummaryId = '';
    saveLocal(); render();
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
    user.updatedAt = new Date().toISOString();
    saveLocal(); changePasswordForm.reset(); showToast('密码已修改');
  };
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = async () => { logoutBtn.disabled = true; await logoutCurrentAccount(); };
  const configForm = document.getElementById('configForm');
  if (configForm) configForm.onsubmit = async e => {
    e.preventDefault();
    config = readConfigFromForm(configForm);
    saveConfig();
    const ok = await pullRemoteForAuth();
    render();
    showToast(ok ? '全公司统一云端配置已保存' : '配置已保存，但连接测试失败');
  };
  const reminderForm = document.getElementById('reminderForm');
  if (reminderForm) reminderForm.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(reminderForm);
    const enabled = fd.get('enabled') === 'on';
    const time = String(fd.get('time') || '20:00');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) { showToast('请选择有效的提醒时间'); return; }
    saveReminderSettings({ enabled, time });
    const applied = applyNativeReminder(reminderSettings);
    if (enabled && hasNativeReminder()) {
      try { nativeBridge()?.requestReminderPermissions?.(); } catch (err) { console.error(err); }
      readNativeReminderStatus();
    }
    if (!hasNativeReminder()) {
      if (enabled && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
      scheduleBrowserReminderLoop();
    }
    render();
    showToast(enabled ? (applied ? `已设置每天 ${time} 发送任务栏提醒` : `已保存每天 ${time} 的提醒设置`) : '每日提醒已关闭');
  };
  const testReminderBtn = document.getElementById('testReminderBtn');
  if (testReminderBtn) testReminderBtn.onclick = async () => {
    const bridge = nativeBridge();
    if (bridge && typeof bridge.showTestReminder === 'function') {
      try {
        const result = String(bridge.showTestReminder() || '');
        if (result === 'sent') showToast('测试通知已发送，请查看系统通知栏');
        else if (result === 'permission_required') showToast('请先完成通知和精确定时权限设置');
        else showToast('测试通知发送失败，请检查系统通知设置');
        setTimeout(() => { readNativeReminderStatus(); if (page === 'settings') render(); }, 500);
      } catch (err) { console.error(err); showToast('测试通知发送失败'); }
      return;
    }
    const ok = await showBrowserReminder();
    showToast(ok ? '测试通知已发送' : '通知权限未开启或当前浏览器不支持');
  };
  const backgroundTestReminderBtn = document.getElementById('backgroundTestReminderBtn');
  if (backgroundTestReminderBtn) backgroundTestReminderBtn.onclick = () => {
    const bridge = nativeBridge();
    try {
      const result = String(bridge?.scheduleBackgroundTest?.(60) || '');
      if (result.startsWith('scheduled:')) {
        const exact = result.endsWith(':exact');
        showToast(exact ? '已安排 1 分钟后提醒，请立即退出软件进行测试' : '已安排后台测试，但未开精确定时权限，系统可能延迟');
      } else if (result === 'permission_required') {
        showToast('请先允许通知权限，再进行后台测试');
      } else showToast('后台测试安排失败');
      setTimeout(() => { readNativeReminderStatus(); if (page === 'settings') render(); }, 500);
    } catch (err) { console.error(err); showToast('后台测试安排失败'); }
  };
  const notificationSettingsBtn = document.getElementById('notificationSettingsBtn');
  if (notificationSettingsBtn) notificationSettingsBtn.onclick = () => {
    const bridge = nativeBridge();
    try { bridge?.openNotificationSettings?.(); } catch (err) { console.error(err); }
  };
  const alarmSettingsBtn = document.getElementById('alarmSettingsBtn');
  if (alarmSettingsBtn) alarmSettingsBtn.onclick = () => {
    try { nativeBridge()?.openAlarmSettings?.(); } catch (err) { console.error(err); }
  };
  const batterySettingsBtn = document.getElementById('batterySettingsBtn');
  if (batterySettingsBtn) batterySettingsBtn.onclick = () => {
    try { nativeBridge()?.openBatterySettings?.(); } catch (err) { console.error(err); }
  };
  const amountVisibilityForm = document.getElementById('amountVisibilityForm');
  if (amountVisibilityForm) amountVisibilityForm.onsubmit = async e => {
    e.preventDefault();
    if (!isAdmin()) return;
    const fd = new FormData(amountVisibilityForm);
    state.settings = state.settings || {};
    state.settings.amountVisibility = ['all','own','hidden'].includes(String(fd.get('amountVisibility'))) ? String(fd.get('amountVisibility')) : 'all';
    saveLocal();
    await pushToYunduan(false);
    render();
    showToast('金额显示权限已保存并同步');
  };
  const pullBtnStatus = document.getElementById('pullBtnStatus');
  if (pullBtnStatus) pullBtnStatus.onclick = () => pullFromYunduan(true);
  const pushBtnStatus = document.getElementById('pushBtnStatus');
  if (pushBtnStatus) pushBtnStatus.onclick = () => pushToYunduan(true);
  const registrationCodeForm = document.getElementById('registrationCodeForm');
  if (registrationCodeForm) registrationCodeForm.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(registrationCodeForm);
    const nextCode = String(fd.get('registrationCode') || '').trim();
    if (!nextCode) { showToast('注册校验码不能为空'); return; }
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
  const exportMonthlySummaryBtn = document.getElementById('exportMonthlySummaryBtn');
  if (exportMonthlySummaryBtn) exportMonthlySummaryBtn.onclick = exportMonthlyAllSummaryExcel;
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
    const deletedAt = new Date().toISOString();
    const targets = isAdmin(user) ? [...state.records] : state.records.filter(r => r.memberId === user.memberId);
    state.deletedRecords = mergeLatestById(state.deletedRecords || [], targets.map(r => ({ id: r.id, memberId: r.memberId, deletedAt, deletedBy: user.id })));
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
function syncBasePath() {
  let path = String(config.path || 'data/performance-v14').trim().replace(/^\/+|\/+$/g, '');
  if (/\.json$/i.test(path)) path = path.replace(/\.json$/i, '') + '-split';
  return path || 'data/performance-v14';
}
function publicFilePath() { return `${syncBasePath()}/public.json`; }
function pricingFilePath() { return `${syncBasePath()}/pricing.json`; }
function userFilePath(userOrId) {
  const id = typeof userOrId === 'string' ? userOrId : userOrId?.id;
  return `${syncBasePath()}/users/${String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
}
function accountSessionsFilePath() { return `${syncBasePath()}/account-sessions.json`; }
function remoteContentUrl(path) {
  return `${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${String(path).split('/').map(encodeURIComponent).join('/')}?access_token=${encodeURIComponent(config.token)}&ref=${encodeURIComponent(config.branch)}`;
}
async function getRemoteJson(path) {
  const res = await fetch(remoteContentUrl(path), { method: 'GET', cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) {
    const error = new Error(await res.text() || `读取失败 ${res.status}`);
    error.status = res.status;
    throw error;
  }
  const json = await res.json();
  let data = {};
  try { data = JSON.parse(decodeBase64(json.content || 'e30=')); }
  catch { throw new Error(`${path} 不是有效 JSON 文件`); }
  return { data, sha: json.sha || '' };
}
async function putRemoteJson(path, data, sha = '', message = '') {
  const body = {
    access_token: config.token,
    content: encodeBase64(JSON.stringify(data, null, 2)),
    message: message || `safe sync ${path} ${nowLocalText()}`,
    branch: config.branch
  };
  if (sha) body.sha = sha;
  const baseUrl = `${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${String(path).split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(baseUrl, { method: sha ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const error = new Error(await res.text() || `写入失败 ${res.status}`);
    error.status = res.status;
    throw error;
  }
  return res.json();
}
async function updateRemoteJsonWithRetry(path, updater, message, maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const remote = await getRemoteJson(path);
      const next = await updater(remote?.data || null, remote?.sha || '');
      if (next === null || next === undefined) return remote?.data || null;
      await putRemoteJson(path, next, remote?.sha || '', message);
      return next;
    } catch (err) {
      lastError = err;
      if (![409, 422].includes(Number(err.status)) || attempt === maxRetries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError;
}
async function deleteRemoteJson(path, message = '', maxRetries = 3) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const remote = await getRemoteJson(path);
      if (!remote) return false;
      const body = { access_token: config.token, message: message || `delete ${path} ${nowLocalText()}`, branch: config.branch, sha: remote.sha };
      const baseUrl = `${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${String(path).split('/').map(encodeURIComponent).join('/')}`;
      const res = await fetch(baseUrl, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) {
        const error = new Error(await res.text() || `删除云端文件失败 ${res.status}`);
        error.status = res.status;
        throw error;
      }
      return true;
    } catch (err) {
      lastError = err;
      if (![409, 422].includes(Number(err.status)) || attempt === maxRetries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
  throw lastError;
}

function normalizeAccountSessionsDocument(doc = {}) {
  const raw = doc?.sessions && typeof doc.sessions === 'object' && !Array.isArray(doc.sessions) ? doc.sessions : {};
  const revokedRaw = doc?.revokedSessions && typeof doc.revokedSessions === 'object' && !Array.isArray(doc.revokedSessions) ? doc.revokedSessions : {};
  const sessions = {};
  const revokedSessions = {};
  Object.entries(raw).forEach(([userId, entry]) => {
    if (!userId || !entry || typeof entry !== 'object') return;
    sessions[userId] = { ...entry, userId: entry.userId || userId };
  });
  Object.entries(revokedRaw).forEach(([userId, entry]) => {
    if (!userId || !entry || typeof entry !== 'object' || !entry.sessionToken) return;
    revokedSessions[userId] = { ...entry, userId: entry.userId || userId };
  });
  return { version: 1, sessions, revokedSessions, updatedAt: doc?.updatedAt || new Date().toISOString() };
}
function isRemoteAccountSessionActive(entry, now = Date.now()) {
  return !!entry?.sessionToken && dateMs(entry.expiresAt) > now;
}
function makeAccountSessionError(message = '该账号已在其他设备登录，请先在原设备退出登录') {
  const error = new Error(message);
  error.code = 'ACCOUNT_SESSION_CONFLICT';
  return error;
}
function accountSessionConflictMessage(entry = null) {
  const label = String(entry?.deviceLabel || '').trim();
  return label ? `该账号已在其他设备登录（${label}），请先在原设备退出登录` : '该账号已在其他设备登录，请先在原设备退出登录';
}
function buildAccountSessionEntry(user, previous = null, sessionToken = '') {
  const now = new Date();
  return {
    userId: user.id,
    username: user.username || '',
    displayName: user.displayName || user.username || '',
    deviceId: getDeviceId(),
    deviceLabel: deviceLabel(),
    sessionToken: sessionToken || previous?.sessionToken || randomToken(),
    loginAt: previous?.loginAt || now.toISOString(),
    heartbeatAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + REMOTE_SESSION_TTL_MS).toISOString(),
    appVersion: APP_VERSION
  };
}
async function claimRemoteAccountSession(user) {
  if (!user) throw new Error('未找到登录账号');
  if (!cloudReady()) return null;
  if (navigator.onLine === false) throw new Error('首次登录需要联网校验单设备状态');
  let claimed = null;
  const proposedToken = randomToken();
  await updateRemoteJsonWithRetry(accountSessionsFilePath(), remote => {
    const doc = normalizeAccountSessionsDocument(remote || {});
    const now = Date.now();
    const sessions = { ...doc.sessions };
    Object.entries(sessions).forEach(([id, entry]) => {
      if (!isRemoteAccountSessionActive(entry, now)) delete sessions[id];
    });
    const existing = sessions[user.id];
    if (existing && existing.deviceId !== getDeviceId()) throw makeAccountSessionError(accountSessionConflictMessage(existing));
    claimed = buildAccountSessionEntry(user, existing || null, existing?.sessionToken || proposedToken);
    sessions[user.id] = claimed;
    const revokedSessions = { ...doc.revokedSessions };
    delete revokedSessions[user.id];
    return { version: 1, sessions, revokedSessions, updatedAt: new Date().toISOString() };
  }, `claim account session ${user.id}`, 5);
  return claimed;
}
async function renewRemoteAccountSession(user, expectedEntry) {
  let renewed = null;
  await updateRemoteJsonWithRetry(accountSessionsFilePath(), remote => {
    const doc = normalizeAccountSessionsDocument(remote || {});
    const existing = doc.sessions[user.id];
    if (!existing || !isRemoteAccountSessionActive(existing) || existing.deviceId !== expectedEntry.deviceId || existing.sessionToken !== expectedEntry.sessionToken) {
      throw makeAccountSessionError(accountSessionConflictMessage(existing));
    }
    renewed = buildAccountSessionEntry(user, existing, existing.sessionToken);
    return { ...doc, sessions: { ...doc.sessions, [user.id]: renewed }, updatedAt: new Date().toISOString() };
  }, `heartbeat account session ${user.id}`, 4);
  return renewed;
}
function forceLocalLogoutForSession(message) {
  clearSession();
  page = 'auth';
  render();
  showToast(message || '当前账号已在其他设备登录，本设备已退出');
}
async function ensureCurrentAccountSession({ touch = true, showMessage = false } = {}) {
  const user = currentUser();
  if (!user || !cloudReady() || navigator.onLine === false) return true;
  if (accountSessionOperation) return accountSessionOperation;
  accountSessionOperation = (async () => {
    try {
      const remote = await getRemoteJson(accountSessionsFilePath());
      const doc = normalizeAccountSessionsDocument(remote?.data || {});
      const existing = doc.sessions[user.id];
      const revoked = doc.revokedSessions[user.id];
      const now = Date.now();
      if (session.accountSessionToken && revoked?.sessionToken === session.accountSessionToken) {
        throw makeAccountSessionError('该账号已被管理员强制下线，请重新登录');
      }
      if (isRemoteAccountSessionActive(existing, now)) {
        const sameDevice = existing.deviceId === (session.deviceId || getDeviceId());
        const sameToken = !!session.accountSessionToken && existing.sessionToken === session.accountSessionToken;
        if (!sameDevice || (session.accountSessionToken && !sameToken)) throw makeAccountSessionError(accountSessionConflictMessage(existing));
        if (!session.accountSessionToken) saveSession(user, existing);
        const heartbeatAge = now - dateMs(existing.heartbeatAt);
        if (touch && heartbeatAge >= REMOTE_SESSION_TOUCH_INTERVAL_MS) {
          const renewed = await renewRemoteAccountSession(user, existing);
          saveSession(user, renewed);
        }
        return true;
      }
      const claimed = await claimRemoteAccountSession(user);
      saveSession(user, claimed);
      return true;
    } catch (err) {
      if (err?.code === 'ACCOUNT_SESSION_CONFLICT') {
        forceLocalLogoutForSession(err.message);
        return false;
      }
      console.error(err);
      if (showMessage) showToast('单设备登录状态校验失败，请检查网络后重试');
      return false;
    }
  })();
  try { return await accountSessionOperation; }
  finally { accountSessionOperation = null; }
}
function pendingSessionReleases() {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_SESSION_RELEASE_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function queuePendingSessionRelease(snapshot) {
  if (!snapshot?.userId || !snapshot?.accountSessionToken) return;
  const list = pendingSessionReleases().filter(x => !(x.userId === snapshot.userId && x.accountSessionToken === snapshot.accountSessionToken));
  list.push({ userId: snapshot.userId, deviceId: snapshot.deviceId || getDeviceId(), accountSessionToken: snapshot.accountSessionToken, queuedAt: new Date().toISOString() });
  localStorage.setItem(PENDING_SESSION_RELEASE_KEY, JSON.stringify(list.slice(-10)));
}
async function releaseRemoteAccountSession(snapshot = session, forceUserId = '') {
  const userId = forceUserId || snapshot?.userId || '';
  if (!userId || !cloudReady()) return true;
  if (navigator.onLine === false) {
    if (!forceUserId) queuePendingSessionRelease(snapshot);
    return false;
  }
  await updateRemoteJsonWithRetry(accountSessionsFilePath(), remote => {
    if (!remote) return null;
    const doc = normalizeAccountSessionsDocument(remote);
    const existing = doc.sessions[userId];
    if (!existing) return null;
    if (!forceUserId) {
      const matches = existing.sessionToken === snapshot.accountSessionToken && existing.deviceId === (snapshot.deviceId || getDeviceId());
      if (!matches) return null;
    }
    const sessions = { ...doc.sessions };
    const revokedSessions = { ...doc.revokedSessions };
    delete sessions[userId];
    if (forceUserId && existing.sessionToken) {
      revokedSessions[userId] = { userId, sessionToken: existing.sessionToken, deviceId: existing.deviceId || '', revokedAt: new Date().toISOString() };
    }
    return { ...doc, sessions, revokedSessions, updatedAt: new Date().toISOString() };
  }, `release account session ${userId}`, 5);
  return true;
}
async function flushPendingSessionReleases() {
  if (!cloudReady() || navigator.onLine === false) return;
  const pending = pendingSessionReleases();
  if (!pending.length) return;
  const remaining = [];
  for (const item of pending) {
    try { await releaseRemoteAccountSession(item); }
    catch { remaining.push(item); }
  }
  if (remaining.length) localStorage.setItem(PENDING_SESSION_RELEASE_KEY, JSON.stringify(remaining));
  else localStorage.removeItem(PENDING_SESSION_RELEASE_KEY);
}
async function logoutCurrentAccount() {
  const snapshot = { ...session };
  let released = true;
  try { released = await releaseRemoteAccountSession(snapshot); }
  catch (err) { console.error(err); queuePendingSessionRelease(snapshot); released = false; }
  clearSession();
  page = 'auth';
  render();
  showToast(released ? '已退出登录，账号可在其他设备登录' : '已退出本机；联网后将自动释放账号登录状态');
}
async function forceReleaseAccountSessionForUser(userId) {
  if (!isAdmin()) throw new Error('只有管理员可以强制下线账号');
  if (!userId) throw new Error('未找到账号');
  if (navigator.onLine === false) throw new Error('强制下线需要联网');
  await releaseRemoteAccountSession({}, userId);
  return true;
}

async function permanentlyDeleteUser(userId, mode) {
  const admin = currentUser();
  const target = (state.users || []).find(u => u.id === userId);
  validatePermanentDeletionTarget(target);
  if (!['account_only', 'account_and_data'].includes(mode)) throw new Error('删除方式无效');
  const member = memberById(target.memberId);
  const synced = await pushToYunduan(false);
  if (!synced) throw new Error('删除前同步失败，请检查网络和云端权限后重试');
  const freshTarget = (state.users || []).find(u => u.id === userId);
  validatePermanentDeletionTarget(freshTarget);
  const freshMember = memberById(freshTarget.memberId) || member;
  await forceReleaseAccountSessionForUser(freshTarget.id);
  const snapshot = JSON.parse(JSON.stringify(state));
  const oldUserPath = userFilePath(freshTarget);
  const oldRemote = await getRemoteJson(oldUserPath);
  const deletedAt = new Date().toISOString();
  try {
    if (mode === 'account_only' && freshMember) {
      const syntheticOwner = syntheticOwnerForMember(freshMember);
      const localDoc = buildUserDocument(freshTarget, state);
      const preserved = mergeUserDocuments(oldRemote?.data || null, localDoc, state.types);
      const migrated = { ...preserved, userId: syntheticOwner.id, memberId: freshMember.id, updatedAt: deletedAt };
      await updateRemoteJsonWithRetry(userFilePath(syntheticOwner), remote => mergeUserDocuments(remote, migrated, state.types), `preserve member data after deleting account ${freshTarget.id}`);
    }
    applyLocalPermanentUserDeletion(freshTarget.id, mode, deletedAt, admin.id);
    await updateRemoteJsonWithRetry(publicFilePath(), remote => mergeAdminPublicDocument(remote, buildPublicDocument(state)), `permanently delete account ${freshTarget.id}`);
    if (mode === 'account_and_data') {
      await updateRemoteJsonWithRetry(pricingFilePath(), () => buildPricingDocument(state), `remove pricing for deleted member ${freshTarget.memberId}`);
      if (freshMember) await deleteRemoteJson(userFilePath(syntheticOwnerForMember(freshMember)), `delete preserved member data ${freshMember.id}`);
    }
    await deleteRemoteJson(oldUserPath, `delete user data file ${freshTarget.id}`);
    const bundle = await fetchRemoteBundle(admin);
    if (bundle) state = bundle.state;
    saveLocal(false);
    saveSyncMeta({ pending: false, status: 'synced', lastSyncedAt: new Date().toISOString(), lastError: '' });
    render();
    return true;
  } catch (err) {
    state = normalizeData(snapshot);
    saveLocal(false);
    render();
    throw err;
  }
}

function itemStamp(item = {}) { return String(item.updatedAt || item.deletedAt || item.createdAt || ''); }
function mergeLatestById(remoteItems = [], localItems = [], localWinsOnTie = true) {
  const map = new Map();
  (remoteItems || []).forEach(item => { if (item?.id) map.set(item.id, { ...item }); });
  (localItems || []).forEach(item => {
    if (!item?.id) return;
    const old = map.get(item.id);
    if (!old || itemStamp(item) > itemStamp(old) || (localWinsOnTie && itemStamp(item) === itemStamp(old))) map.set(item.id, { ...old, ...item });
  });
  return Array.from(map.values());
}
function tombstoneMap(items = []) {
  return new Map((items || []).filter(x => x?.id).map(x => [x.id, x]));
}
function survivesTombstone(item, map) {
  const tombstone = map.get(item?.id);
  return !tombstone || itemStamp(item) > itemStamp(tombstone);
}
function mergeDeletionTombstones(remoteItems = [], localItems = []) {
  return mergeLatestById(remoteItems || [], localItems || []);
}
function syntheticOwnerForMember(member = {}) {
  return { id: `memberfile_${member.id}`, memberId: member.id, displayName: member.name || '成员', synthetic: true };
}
function activeAdminCount() {
  return (state.users || []).filter(u => u.role === 'admin' && u.active !== false).length;
}
function validatePermanentDeletionTarget(user) {
  if (!isAdmin()) throw new Error('只有管理员可以永久删除用户');
  if (!user) throw new Error('未找到需要删除的用户');
  if (user.id === currentUser()?.id) throw new Error('不能删除当前正在登录的管理员账号');
  if (user.role === 'admin' && activeAdminCount() <= 1) throw new Error('不能删除最后一个可用管理员账号');
}
function applyLocalPermanentUserDeletion(userId, mode, deletedAt, deletedBy) {
  const user = (state.users || []).find(u => u.id === userId);
  validatePermanentDeletionTarget(user);
  const member = memberById(user.memberId);
  const memberId = user.memberId || '';
  const tombstone = { id: user.id, memberId, username: user.username || '', mode, deletedAt, updatedAt: deletedAt, deletedBy };
  state.deletedUsers = mergeDeletionTombstones(state.deletedUsers || [], [tombstone]);
  state.users = (state.users || []).filter(u => u.id !== user.id);
  let removedTypeIds = [];
  if (mode === 'account_and_data') {
    if (memberId) {
      state.deletedMembers = mergeDeletionTombstones(state.deletedMembers || [], [{ id: memberId, userId: user.id, deletedAt, updatedAt: deletedAt, deletedBy }]);
      state.members = (state.members || []).filter(m => m.id !== memberId);
      removedTypeIds = (state.types || []).filter(t => !isGlobalType(t) && typeOwnerId(t) === memberId).map(t => t.id);
      const removedTypeSet = new Set(removedTypeIds);
      state.types = (state.types || []).filter(t => !removedTypeSet.has(t.id));
      state.records = (state.records || []).filter(r => r.memberId !== memberId);
      state.deletedRecords = (state.deletedRecords || []).filter(r => r.memberId !== memberId);
      state.coreSummaries = (state.coreSummaries || []).map(g => ({ ...g, typeIds: (g.typeIds || []).filter(id => !removedTypeSet.has(id)), updatedAt: deletedAt, updatedBy: deletedBy }));
    }
  }
  if (window.__memberFilter === memberId) window.__memberFilter = 'all';
  return { user, member, memberId, removedTypeIds };
}
async function requestPermanentUserDeletion(userId, mode) {
  if (!isAdmin()) { showToast('只有管理员可以永久删除用户'); return; }
  const user = (state.users || []).find(u => u.id === userId);
  try { validatePermanentDeletionTarget(user); }
  catch (err) { showToast(err.message); return; }
  const member = memberById(user.memberId);
  const accountName = user.displayName || user.username;
  const fullDelete = mode === 'account_and_data';
  const firstMessage = fullDelete
    ? `确定永久删除“${accountName}”的账号、成员资料、个人业绩类别和全部历史业绩吗？此操作不可恢复。`
    : `确定永久删除“${accountName}”的登录账号吗？成员资料、个人类别和历史业绩会保留，但该账号将无法登录。`;
  if (!confirm(firstMessage)) return;
  const typed = prompt(`二次确认：请输入需要删除的账号名“${user.username}”`);
  if (normalizeUsername(typed) !== normalizeUsername(user.username)) { showToast('二次确认账号名不一致，已取消删除'); return; }
  if (!cloudReady() || !checkConfig()) return;
  if (navigator.onLine === false) { showToast('永久删除需要联网同步云端，请联网后重试'); return; }
  const originalText = fullDelete ? '删除账号及数据' : '仅删除账号';
  showToast(`正在执行${originalText}…`);
  try {
    await permanentlyDeleteUser(user.id, mode);
    showToast(fullDelete ? '账号、成员及全部人员数据已永久删除' : '账号已永久删除，成员及历史业绩已保留');
  } catch (err) {
    console.error(err);
    showToast(`删除失败：${String(err?.message || '请检查网络和云端权限').slice(0, 90)}`);
  }
}

function typeWithoutPrice(t) {
  const { price, pricingUpdatedAt, pricingUpdatedBy, ...rest } = t || {};
  return { ...rest };
}
function buildPublicDocument(source = state) {
  return {
    version: 10,
    syncMode: 'split-user-files-v1',
    registrationCode: source.registrationCode || '123456',
    settings: { amountVisibility: ['all','own','hidden'].includes(source.settings?.amountVisibility) ? source.settings.amountVisibility : 'all' },
    users: (source.users || []).map(u => ({ ...u })),
    members: (source.members || []).map(m => ({ ...m })),
    deletedUsers: (source.deletedUsers || []).map(x => ({ ...x })),
    deletedMembers: (source.deletedMembers || []).map(x => ({ ...x })),
    globalTypes: (source.types || []).filter(isGlobalType).map(typeWithoutPrice),
    coreSummaries: (source.coreSummaries || []).map(g => ({ ...g, typeIds: [...(g.typeIds || [])] })),
    updatedAt: new Date().toISOString()
  };
}
function buildPricingDocument(source = state) {
  const prices = {};
  (source.types || []).forEach(t => {
    prices[t.id] = {
      price: typePrice(t),
      pricingUpdatedAt: t.pricingUpdatedAt || '',
      pricingUpdatedBy: t.pricingUpdatedBy || ''
    };
  });
  return { version: 10, prices, updatedAt: new Date().toISOString(), updatedBy: currentUser()?.id || '' };
}
function emptyUserDocument(user) {
  return { version: 10, userId: user?.id || '', memberId: user?.memberId || '', personalTypes: [], records: [], deletedRecords: [], updatedAt: new Date().toISOString() };
}
function dataOwnersFromPublic(publicDoc = {}) {
  const deletedUsers = tombstoneMap(publicDoc.deletedUsers || []);
  const deletedMembers = tombstoneMap(publicDoc.deletedMembers || []);
  const users = (publicDoc.users || []).filter(u => survivesTombstone(u, deletedUsers) && !deletedMembers.has(u.memberId)).map(u => ({ ...u }));
  const linked = new Set(users.map(u => u.memberId).filter(Boolean));
  const synthetic = (publicDoc.members || []).filter(m => survivesTombstone(m, deletedMembers) && !linked.has(m.id)).map(m => syntheticOwnerForMember(m));
  return [...users, ...synthetic];
}
function buildUserDocument(user, source = state) {
  const memberId = user?.memberId || '';
  return {
    version: 10,
    userId: user?.id || '',
    memberId,
    personalTypes: (source.types || []).filter(t => !isGlobalType(t) && typeOwnerId(t) === memberId).map(typeWithoutPrice),
    records: (source.records || []).filter(r => r.memberId === memberId).map(r => ({ ...r })),
    deletedRecords: (source.deletedRecords || []).filter(x => x.memberId === memberId).map(x => ({ ...x })),
    updatedAt: new Date().toISOString()
  };
}
function mergeUserDocuments(remoteDoc, localDoc, globalTypes = []) {
  const remote = remoteDoc || emptyUserDocument({ id: localDoc?.userId, memberId: localDoc?.memberId });
  const local = localDoc || emptyUserDocument({ id: remote?.userId, memberId: remote?.memberId });
  const deletedRecords = mergeLatestById(remote.deletedRecords || [], local.deletedRecords || []);
  const tombstones = new Map(deletedRecords.map(x => [x.id, itemStamp(x)]));
  const records = mergeLatestById(remote.records || [], local.records || []).filter(r => !tombstones.has(r.id) || tombstones.get(r.id) < itemStamp(r));
  const publicTypes = (globalTypes || []).filter(isGlobalType);
  const publicIds = new Set(publicTypes.map(t => t.id));
  const publicNames = new Set(publicTypes.map(t => canonicalTypeName(t.name)).filter(Boolean));
  const personalTypes = mergeLatestById(remote.personalTypes || [], local.personalTypes || []).filter(t => !publicIds.has(t.id) && !publicNames.has(canonicalTypeName(t.name)));
  return {
    version: 10,
    userId: local.userId || remote.userId || '',
    memberId: local.memberId || remote.memberId || '',
    personalTypes,
    records,
    deletedRecords,
    updatedAt: new Date().toISOString()
  };
}
function mergeAdminPublicDocument(remoteDoc, localDoc) {
  if (!remoteDoc) return localDoc;
  const deletedUsers = mergeDeletionTombstones(remoteDoc.deletedUsers || [], localDoc.deletedUsers || []);
  const deletedMembers = mergeDeletionTombstones(remoteDoc.deletedMembers || [], localDoc.deletedMembers || []);
  const deletedUserMap = tombstoneMap(deletedUsers);
  const deletedMemberMap = tombstoneMap(deletedMembers);
  const users = mergeLatestById(remoteDoc.users || [], localDoc.users || []).filter(u => survivesTombstone(u, deletedUserMap) && !deletedMemberMap.has(u.memberId));
  const members = mergeLatestById(remoteDoc.members || [], localDoc.members || []).filter(m => survivesTombstone(m, deletedMemberMap));
  const globalTypes = mergeLatestById(remoteDoc.globalTypes || remoteDoc.types || [], localDoc.globalTypes || []);
  const coreSummaries = mergeLatestById(remoteDoc.coreSummaries || [], localDoc.coreSummaries || []);
  return { ...remoteDoc, ...localDoc, users, members, deletedUsers, deletedMembers, globalTypes, coreSummaries, updatedAt: new Date().toISOString() };
}
function mergeUserPublicDocument(remoteDoc, localState, user) {
  if (!remoteDoc) return null;
  const localUser = (localState.users || []).find(u => u.id === user.id);
  const users = (remoteDoc.users || []).map(u => u.id === user.id && localUser ? { ...u, passwordHash: localUser.passwordHash, updatedAt: localUser.updatedAt || new Date().toISOString() } : u);
  return { ...remoteDoc, users, updatedAt: new Date().toISOString() };
}
function pricingMapFromDocument(doc) {
  if (!doc) return {};
  if (Array.isArray(doc.prices)) return Object.fromEntries(doc.prices.filter(x => x?.typeId).map(x => [x.typeId, x]));
  return doc.prices && typeof doc.prices === 'object' ? doc.prices : {};
}
function composeStateFromDocuments(publicDoc, pricingDoc, userDocs = []) {
  const pub = publicDoc || {};
  const prices = pricingMapFromDocument(pricingDoc);
  const globalTypes = (pub.globalTypes || pub.types || []).map(t => ({ ...t, ownerMemberId: 'global', scope: 'global' }));
  const globalIds = new Set(globalTypes.map(t => t.id));
  const globalNames = new Set(globalTypes.map(t => canonicalTypeName(t.name)).filter(Boolean));
  const personalTypes = userDocs.flatMap(doc => (doc?.personalTypes || []).map(t => ({ ...t, ownerMemberId: t.ownerMemberId || doc.memberId, scope: 'private' }))).filter(t => !globalIds.has(t.id) && !globalNames.has(canonicalTypeName(t.name)));
  const types = [...globalTypes, ...personalTypes].map(t => {
    const pricing = prices[t.id] || {};
    return { ...t, price: pricing.price === null || pricing.price === '' || !Number.isFinite(Number(pricing.price)) ? null : Number(pricing.price), pricingUpdatedAt: pricing.pricingUpdatedAt || '', pricingUpdatedBy: pricing.pricingUpdatedBy || '' };
  });
  const deletedRecords = userDocs.flatMap(doc => doc?.deletedRecords || []);
  const tombstones = new Map(deletedRecords.map(x => [x.id, itemStamp(x)]));
  const records = userDocs.flatMap(doc => doc?.records || []).filter(r => !tombstones.has(r.id) || tombstones.get(r.id) < itemStamp(r));
  return normalizeData({
    version: 10,
    registrationCode: pub.registrationCode || '123456',
    settings: pub.settings || { amountVisibility: 'all' },
    users: pub.users || [],
    members: pub.members || [],
    deletedUsers: pub.deletedUsers || [],
    deletedMembers: pub.deletedMembers || [],
    types,
    records,
    deletedRecords,
    coreSummaries: pub.coreSummaries || [],
    updatedAt: pub.updatedAt || new Date().toISOString()
  });
}
async function fetchRemoteBundle(user = currentUser()) {
  const publicRemote = await getRemoteJson(publicFilePath());
  if (!publicRemote) return null;
  const pub = publicRemote.data || {};
  const mode = ['all','own','hidden'].includes(pub.settings?.amountVisibility) ? pub.settings.amountVisibility : 'all';
  const shouldLoadPricing = !!user && (isAdmin(user) || mode !== 'hidden');
  const pricingRemote = shouldLoadPricing ? await getRemoteJson(pricingFilePath()) : null;
  const users = dataOwnersFromPublic(pub);
  const userRemotes = await Promise.all(users.map(async u => {
    const remote = await getRemoteJson(userFilePath(u));
    return remote?.data || emptyUserDocument(u);
  }));
  return { publicRemote, pricingRemote, userDocs: userRemotes, state: composeStateFromDocuments(pub, pricingRemote?.data || null, userRemotes) };
}
async function initializeSplitCloud() {
  const user = currentUser();
  if (!isAdmin(user)) throw new Error('云端尚未初始化，请由管理员先执行初始化');
  const publicDoc = buildPublicDocument(state);
  await updateRemoteJsonWithRetry(publicFilePath(), () => publicDoc, 'initialize split public data');
  await updateRemoteJsonWithRetry(pricingFilePath(), () => buildPricingDocument(state), 'initialize pricing data');
  for (const u of dataOwnersFromPublic(publicDoc)) {
    await updateRemoteJsonWithRetry(userFilePath(u), remote => mergeUserDocuments(remote, buildUserDocument(u, state), state.types), `initialize user data ${u.id}`);
  }
}
async function pullFromYunduan(showMessages = true) {
  if (!requireAuth('请先登录后再拉取数据')) return false;
  if (!checkConfig()) return false;
  if (syncInFlight) return false;
  if (!(await ensureCurrentAccountSession({ touch: true, showMessage: showMessages }))) return false;
  syncInFlight = true;
  saveSyncMeta({ status: 'syncing', lastError: '' });
  try {
    if (showMessages) showToast('正在拉取分文件云端数据…');
    const userBefore = currentUser();
    const bundle = await fetchRemoteBundle(userBefore);
    if (!bundle) {
      saveSyncMeta({ status: 'idle' });
      if (showMessages) showToast(isAdmin(userBefore) ? '云端尚未初始化，可点击“初始化 / 安全同步”' : '云端尚未初始化，请联系管理员');
      return false;
    }
    state = bundle.state;
    saveLocal(false);
    const stillUser = (state.users || []).find(u => u.id === userBefore?.id && u.active !== false);
    if (!stillUser) { clearSession(); page = 'auth'; }
    saveSyncMeta({ pending: false, status: 'synced', lastSyncedAt: new Date().toISOString(), lastError: '' });
    render();
    if (showMessages) showToast('已拉取云端最新数据');
    return true;
  } catch (err) {
    console.error(err);
    saveSyncMeta({ status: navigator.onLine === false ? 'offline' : 'error', lastError: '请检查网络、Token 和仓库权限' });
    if (showMessages) showToast('拉取失败：请检查网络、Token、仓库或分支');
    return false;
  } finally {
    syncInFlight = false;
  }
}
async function pushToYunduan(showMessages = true) {
  if (!requireAuth('请先登录后再同步数据')) return false;
  if (!checkConfig()) return false;
  if (syncInFlight) return false;
  if (navigator.onLine === false) {
    saveSyncMeta({ pending: true, status: 'offline' });
    if (showMessages) showToast('当前离线，数据已保存在本机，联网后会自动同步');
    return false;
  }
  if (!(await ensureCurrentAccountSession({ touch: true, showMessage: showMessages }))) return false;
  syncInFlight = true;
  saveSyncMeta({ status: 'syncing', lastError: '' });
  try {
    if (showMessages) showToast('正在执行安全同步…');
    const user = currentUser();
    let publicRemote = await getRemoteJson(publicFilePath());
    if (!publicRemote) {
      await initializeSplitCloud();
    } else if (isAdmin(user)) {
      await updateRemoteJsonWithRetry(publicFilePath(), remote => mergeAdminPublicDocument(remote, buildPublicDocument(state)), 'update public configuration');
      await updateRemoteJsonWithRetry(pricingFilePath(), () => buildPricingDocument(state), 'update administrator pricing');
      const latestPublic = await getRemoteJson(publicFilePath());
      const allUsers = dataOwnersFromPublic(latestPublic?.data || buildPublicDocument(state));
      for (const u of allUsers) {
        const localDoc = buildUserDocument(u, state);
        await updateRemoteJsonWithRetry(userFilePath(u), remote => mergeUserDocuments(remote, localDoc, state.types), `merge user data ${u.id}`);
      }
    } else {
      const mergedPublic = mergeUserPublicDocument(publicRemote.data, state, user);
      const remoteUser = (publicRemote.data.users || []).find(u => u.id === user.id && u.active !== false);
      if (!remoteUser) throw new Error('账号已停用或不存在');
      if (JSON.stringify(mergedPublic.users) !== JSON.stringify(publicRemote.data.users)) {
        await updateRemoteJsonWithRetry(publicFilePath(), remote => mergeUserPublicDocument(remote, state, user), `update own password ${user.id}`);
      }
      const localDoc = buildUserDocument(user, state);
      await updateRemoteJsonWithRetry(userFilePath(user), remote => mergeUserDocuments(remote, localDoc, state.types), `merge own data ${user.id}`);
    }
    const bundle = await fetchRemoteBundle(user);
    if (bundle) {
      state = bundle.state;
      saveLocal(false);
    }
    saveSyncMeta({ pending: false, status: 'synced', lastSyncedAt: new Date().toISOString(), lastError: '' });
    render();
    if (showMessages) showToast(isAdmin(user) ? '全部数据已安全同步' : '本人数据已安全同步');
    return true;
  } catch (err) {
    console.error(err);
    const message = String(err?.message || '同步失败').slice(0, 80);
    saveSyncMeta({ pending: true, status: navigator.onLine === false ? 'offline' : 'error', lastError: message.includes('账号') ? message : '等待重试' });
    if (showMessages) showToast(`同步失败：${message.includes('账号') ? message : '已保留本机数据，稍后可重试'}`);
    return false;
  } finally {
    syncInFlight = false;
  }
}
async function registerUserOnRemote(user, member) {
  let createdPublic;
  await updateRemoteJsonWithRetry(publicFilePath(), remote => {
    if (!remote) throw new Error('云端尚未初始化，请联系管理员');
    if ((remote.users || []).some(u => normalizeUsername(u.username) === normalizeUsername(user.username))) throw new Error('该账号已存在');
    createdPublic = { ...remote, users: [...(remote.users || []), user], members: [...(remote.members || []), member], updatedAt: new Date().toISOString() };
    return createdPublic;
  }, `register user ${user.id}`);
  await updateRemoteJsonWithRetry(userFilePath(user), remote => remote || emptyUserDocument(user), `create user file ${user.id}`);
  return createdPublic;
}
function normalizeData(d = {}) {
  const base = defaultData();
  const now = new Date().toISOString();
  const settings = {
    amountVisibility: ['all','own','hidden'].includes(d.settings?.amountVisibility || d.amountVisibility) ? (d.settings?.amountVisibility || d.amountVisibility) : 'all'
  };
  const deletedUsers = Array.isArray(d.deletedUsers) ? d.deletedUsers.map(x => ({ id: x.id || '', memberId: x.memberId || '', username: x.username || '', mode: x.mode || 'account_only', deletedAt: x.deletedAt || x.updatedAt || now, updatedAt: x.updatedAt || x.deletedAt || now, deletedBy: x.deletedBy || '' })).filter(x => x.id) : [];
  const deletedMembers = Array.isArray(d.deletedMembers) ? d.deletedMembers.map(x => ({ id: x.id || '', userId: x.userId || '', deletedAt: x.deletedAt || x.updatedAt || now, updatedAt: x.updatedAt || x.deletedAt || now, deletedBy: x.deletedBy || '' })).filter(x => x.id) : [];
  const deletedUserMap = tombstoneMap(deletedUsers);
  const deletedMemberMap = tombstoneMap(deletedMembers);
  let members = Array.isArray(d.members) && d.members.length ? d.members.map((m, idx) => ({
    id: m.id || uid(),
    name: m.name || `成员${idx + 1}`,
    role: m.role || '',
    active: m.active !== false,
    createdAt: m.createdAt || now,
    updatedAt: m.updatedAt || m.createdAt || now,
    deletedAt: m.deletedAt || ''
  })) : base.members.map(m => ({ ...m, updatedAt: m.createdAt || now, deletedAt: '' }));
  members = members.filter(m => survivesTombstone(m, deletedMemberMap));
  let types = Array.isArray(d.types) && d.types.length ? d.types.map((t, idx) => {
    const rawOwner = t.ownerMemberId || t.memberId || members[0]?.id || base.members[0].id;
    const global = t.scope === 'global' || rawOwner === 'global' || rawOwner === 'member_admin';
    return {
      id: t.id || uid(),
      name: t.name || `业绩类型${idx + 1}`,
      unit: t.unit || '笔',
      price: t.price === null || t.price === '' || !Number.isFinite(Number(t.price)) ? null : Math.max(0, Number(t.price)),
      color: t.color || COLORS[idx % COLORS.length],
      active: t.active !== false,
      sortOrder: Number(t.sortOrder || idx + 1),
      ownerMemberId: global ? 'global' : rawOwner,
      scope: global ? 'global' : (t.scope || 'private'),
      createdBy: t.createdBy || '',
      createdAt: t.createdAt || now,
      updatedAt: t.updatedAt || t.createdAt || now,
      deletedAt: t.deletedAt || '',
      mergedIntoTypeId: t.mergedIntoTypeId || '',
      pricingUpdatedAt: t.pricingUpdatedAt || '',
      pricingUpdatedBy: t.pricingUpdatedBy || ''
    };
  }) : base.types.map(t => ({ ...t, ownerMemberId: 'global', scope: 'global', createdAt: now, updatedAt: now, deletedAt: '' }));
  let users = Array.isArray(d.users) && d.users.length ? d.users.map((u, idx) => ({
    id: u.id || uid(),
    username: normalizeUsername(u.username || `user${idx + 1}`),
    displayName: u.displayName || u.name || u.username || `用户${idx + 1}`,
    role: u.role === 'admin' ? 'admin' : 'user',
    memberId: u.memberId || '',
    passwordHash: u.passwordHash || DEFAULT_ADMIN_PASSWORD_HASH,
    active: u.active !== false,
    createdAt: u.createdAt || now,
    updatedAt: u.updatedAt || u.createdAt || now
  })) : base.users.map(u => ({ ...u, updatedAt: u.createdAt || now }));
  users = users.filter(u => survivesTombstone(u, deletedUserMap) && !deletedMemberMap.has(u.memberId));
  if (!users.some(u => u.role === 'admin')) users.unshift({ ...base.users[0], updatedAt: base.users[0].createdAt || now });
  users = users.map(u => {
    const memberId = u.memberId || (u.id === 'user_admin' ? 'member_admin' : `member_${u.id}`);
    return { ...u, memberId };
  });
  users.forEach(u => {
    if (!members.some(m => m.id === u.memberId)) {
      members.push({ id: u.memberId, name: u.displayName || u.username, role: u.role === 'admin' ? '管理员' : '成员', active: true, createdAt: u.createdAt || now, updatedAt: u.updatedAt || u.createdAt || now, deletedAt: '' });
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
    createdAt: r.createdAt || now,
    updatedAt: r.updatedAt || r.createdAt || now,
    createdBy: r.createdBy || ''
  })).filter(r => r.typeId && typeIds.has(r.typeId)) : [];
  let deletedRecords = Array.isArray(d.deletedRecords) ? d.deletedRecords.map(x => ({
    id: x.id || '',
    memberId: x.memberId || '',
    deletedAt: x.deletedAt || x.updatedAt || now,
    deletedBy: x.deletedBy || ''
  })).filter(x => x.id) : [];
  const tombstones = new Map(deletedRecords.map(x => [x.id, itemStamp(x)]));
  records = records.filter(r => !tombstones.has(r.id) || tombstones.get(r.id) < itemStamp(r));
  // 旧版中误挂到其他成员的个人类型会自动复制到正确成员，避免历史记录丢失。
  const typeMap = new Map(types.map(t => [t.id, t]));
  const clonedMap = new Map();
  records = records.map(r => {
    const t = typeMap.get(r.typeId);
    if (!t || isGlobalType(t) || typeOwnerId(t) === r.memberId) return r;
    const cloneKey = `${t.id}__${r.memberId}`;
    if (!clonedMap.has(cloneKey)) {
      const clone = { ...t, id: cloneKey, ownerMemberId: r.memberId, scope: 'private', sortOrder: typesForOwnerCount(types, r.memberId) + clonedMap.size + 1, createdAt: t.createdAt || now, updatedAt: t.updatedAt || now };
      clonedMap.set(cloneKey, clone);
      typeMap.set(cloneKey, clone);
    }
    return { ...r, typeId: cloneKey, updatedAt: r.updatedAt || now };
  });
  if (clonedMap.size) types = [...types, ...Array.from(clonedMap.values())];
  let groups = Array.isArray(d.coreSummaries || d.coreGroups) ? (d.coreSummaries || d.coreGroups).map((g, idx) => ({
    id: g.id || uid(),
    name: g.name || `核心汇总${idx + 1}`,
    typeIds: Array.from(new Set(Array.isArray(g.typeIds) ? g.typeIds.filter(Boolean) : [])),
    active: g.active !== false,
    sortOrder: Number(g.sortOrder || idx + 1),
    createdAt: g.createdAt || now,
    createdBy: g.createdBy || '',
    updatedAt: g.updatedAt || g.createdAt || now,
    updatedBy: g.updatedBy || '',
    deletedAt: g.deletedAt || ''
  })) : [];
  const reconciled = reconcileTypeCollections(types, records, groups);
  types = reconciled.types;
  records = reconciled.records;
  const finalTypeIds = new Set(types.map(t => t.id));
  groups = reconciled.groups.map(g => ({ ...g, typeIds: (g.typeIds || []).filter(id => finalTypeIds.has(id)) }));
  return { version: 10, registrationCode: d.registrationCode || base.registrationCode || '123456', settings, users, members, types, records, deletedRecords, deletedUsers, deletedMembers, coreSummaries: groups, updatedAt: d.updatedAt || now };
}
function downloadBlob(filename, blob) {
  const bridge = window.AndroidBridge || window.Android;
  if (bridge && typeof bridge.saveBase64 === 'function') {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const base64 = String(reader.result || '').split(',')[1] || '';
        bridge.saveBase64(filename, blob.type || 'application/octet-stream', base64);
      } catch (err) {
        console.error(err);
        showToast('文件保存失败，请检查存储权限');
      }
    };
    reader.readAsDataURL(blob);
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadFile(filename, content, type) {
  downloadBlob(filename, new Blob([content], { type }));
}
function excelCell(v) {
  return safeHtml(v ?? '');
}
function txtUnitSuffix(unit) {
  const u = String(unit || '').trim();
  const map = {
    '万': 'w', '万元': 'w', 'w': 'w', 'W': 'w',
    '克': 'g', 'g': 'g', 'G': 'g',
    '张': '', '个': '', '户': '', '笔': '', '人': '', '次': '', '条': '', '份': ''
  };
  return Object.prototype.hasOwnProperty.call(map, u) ? map[u] : u;
}
function formatTxtNumber(value) {
  const n = Number(value || 0);
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}
function orderedTxtSummary(records) {
  const map = new Map();
  records.forEach(r => {
    const t = typeById(r.typeId) || { id: r.typeId, name: '已删除类型', unit: '', color: '#98A2B3', sortOrder: 999999 };
    if (!map.has(t.id)) map.set(t.id, { type: t, value: 0, count: 0 });
    const item = map.get(t.id);
    item.value += Number(r.value || 0);
    item.count += 1;
  });
  const typeOrder = new Map((state.types || []).map((t, idx) => [t.id, idx]));
  return Array.from(map.values())
    .filter(x => Number(x.value || 0) !== 0)
    .sort((a, b) => {
      const ag = isGlobalType(a.type) ? 0 : 1;
      const bg = isGlobalType(b.type) ? 0 : 1;
      return ag - bg
        || Number(a.type.sortOrder || 0) - Number(b.type.sortOrder || 0)
        || (typeOrder.get(a.type.id) ?? 999999) - (typeOrder.get(b.type.id) ?? 999999)
        || String(a.type.name || '').localeCompare(String(b.type.name || ''), 'zh-CN');
    });
}
function memberMonthlyTxt(member, month, records) {
  const summary = orderedTxtSummary(records);
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
function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  return `${(n / 1024 / 1024).toFixed(2).replace(/\.00$/, '')} MB`;
}
async function syncLatestBeforeExport() {
  if (!checkConfig()) return false;
  showToast('正在同步最新云端数据…');
  const ok = syncMeta.pending ? await pushToYunduan(false) : await pullFromYunduan(false);
  if (!ok && navigator.onLine !== false) showToast('同步失败：请检查云端配置、Token 或网络后再导出');
  return ok || navigator.onLine === false;
}
function crc32(bytes) {
  let crc = -1;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}
function writeU16(view, offset, value) { view.setUint16(offset, value, true); return offset + 2; }
function writeU32(view, offset, value) { view.setUint32(offset, value >>> 0, true); return offset + 4; }
function concatUint8Arrays(parts, totalLength = parts.reduce((sum, part) => sum + part.length, 0)) {
  const out = new Uint8Array(totalLength);
  let offset = 0;
  parts.forEach(part => { out.set(part, offset); offset += part.length; });
  return out;
}
function zipStoredBlob(files, mimeType = 'application/zip') {
  const encoder = new TextEncoder();
  const { dosTime, dosDate } = dosDateTime();
  const locals = [];
  const centrals = [];
  let offset = 0;
  files.forEach(file => {
    const nameBytes = encoder.encode(file.name);
    const dataBytes = encoder.encode(file.content);
    const crc = crc32(dataBytes);
    const local = new Uint8Array(30 + nameBytes.length);
    let p = 0;
    const lv = new DataView(local.buffer);
    p = writeU32(lv, p, 0x04034b50);
    p = writeU16(lv, p, 20);
    p = writeU16(lv, p, 0x0800);
    p = writeU16(lv, p, 0);
    p = writeU16(lv, p, dosTime);
    p = writeU16(lv, p, dosDate);
    p = writeU32(lv, p, crc);
    p = writeU32(lv, p, dataBytes.length);
    p = writeU32(lv, p, dataBytes.length);
    p = writeU16(lv, p, nameBytes.length);
    p = writeU16(lv, p, 0);
    local.set(nameBytes, p);
    locals.push(local, dataBytes);

    const central = new Uint8Array(46 + nameBytes.length);
    p = 0;
    const cv = new DataView(central.buffer);
    p = writeU32(cv, p, 0x02014b50);
    p = writeU16(cv, p, 20);
    p = writeU16(cv, p, 20);
    p = writeU16(cv, p, 0x0800);
    p = writeU16(cv, p, 0);
    p = writeU16(cv, p, dosTime);
    p = writeU16(cv, p, dosDate);
    p = writeU32(cv, p, crc);
    p = writeU32(cv, p, dataBytes.length);
    p = writeU32(cv, p, dataBytes.length);
    p = writeU16(cv, p, nameBytes.length);
    p = writeU16(cv, p, 0);
    p = writeU16(cv, p, 0);
    p = writeU16(cv, p, 0);
    p = writeU16(cv, p, 0);
    p = writeU32(cv, p, 0);
    p = writeU32(cv, p, offset);
    central.set(nameBytes, p);
    centrals.push(central);
    offset += local.length + dataBytes.length;
  });
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  let p = 0;
  const ev = new DataView(end.buffer);
  p = writeU32(ev, p, 0x06054b50);
  p = writeU16(ev, p, 0);
  p = writeU16(ev, p, 0);
  p = writeU16(ev, p, files.length);
  p = writeU16(ev, p, files.length);
  p = writeU32(ev, p, centralSize);
  p = writeU32(ev, p, offset);
  p = writeU16(ev, p, 0);
  return new Blob([concatUint8Arrays([...locals, ...centrals, end])], { type: mimeType });
}
async function exportTxt() {
  if (!requireAuth('请先登录后再导出数据')) return;
  if (!(await syncLatestBeforeExport())) return;
  const user = currentUser();
  if (!user) { page = 'auth'; render(); showToast('云端账号数据已更新，请重新登录后导出'); return; }
  const month = window.__selectedMonth || monthStr();
  if (isAdmin(user)) {
    const activeMembers = (state.members || []).filter(m => m.active !== false);
    const files = activeMembers.map(m => {
      const records = monthRecords(month, m.id);
      return records.length ? { name: `${safeFilename(m.name)}_${month}.txt`, content: '\ufeff' + memberMonthlyTxt(m, month, records) } : null;
    }).filter(Boolean);
    if (!files.length) { showToast(`${month} 暂无可导出的业绩`); return; }
    const zipBlob = zipStoredBlob(files);
    downloadBlob(`${month}全员业绩TXT.zip`, zipBlob);
    showToast(`导出完成：导出人数 ${files.length}，TXT 文件数 ${files.length}，ZIP 文件大小 ${formatBytes(zipBlob.size)}`);
  } else {
    const m = memberById(user.memberId) || { name: user.displayName || user.username };
    const records = monthRecords(month, user.memberId);
    downloadFile(`${safeFilename(m.name)}_${month}.txt`, '\ufeff' + memberMonthlyTxt(m, month, records), 'text/plain;charset=utf-8');
    showToast(`导出完成：${safeFilename(m.name)}_${month}.txt`);
  }
}
function xlsxXmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
function xlsxColumnName(index) {
  let n = Number(index || 0);
  let out = '';
  while (n > 0) {
    n -= 1;
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26);
  }
  return out || 'A';
}
function xlsxInlineCell(ref, value, style = 0) {
  return `<c r="${ref}" t="inlineStr" s="${style}"><is><t xml:space="preserve">${xlsxXmlEscape(value)}</t></is></c>`;
}
function xlsxNumberCell(ref, value, style = 0) {
  const n = Number(value || 0);
  return `<c r="${ref}" s="${style}"><v>${Number.isFinite(n) ? n : 0}</v></c>`;
}
function xlsxFormulaCell(ref, formula, cachedValue, style = 0) {
  const n = Number(cachedValue || 0);
  return `<c r="${ref}" s="${style}"><f>${xlsxXmlEscape(formula)}</f><v>${Number.isFinite(n) ? n : 0}</v></c>`;
}
function buildMonthlySummaryXlsx(month, members, types, totals) {
  const lastColumnIndex = types.length + 2;
  const lastTypeColumnIndex = types.length + 1;
  const lastColumn = xlsxColumnName(lastColumnIndex);
  const lastRow = Math.max(2, members.length + 2);
  const now = new Date().toISOString();
  const titleRowCells = [xlsxInlineCell('A1', '人员姓名/业绩类型', 1)];
  types.forEach((t, index) => titleRowCells.push(xlsxInlineCell(`${xlsxColumnName(index + 2)}1`, t.name || '', 1)));
  titleRowCells.push(xlsxInlineCell(`${lastColumn}1`, '总业绩金额（元）', 5));

  const priceRowCells = [xlsxInlineCell('A2', '业绩定价（元）', 2)];
  types.forEach((t, index) => {
    const price = typePrice(t);
    priceRowCells.push(xlsxNumberCell(`${xlsxColumnName(index + 2)}2`, price === null ? 0 : price, price === null ? 7 : 8));
  });
  priceRowCells.push(xlsxInlineCell(`${lastColumn}2`, '未定价按0元', 2));

  const dataRows = members.map((m, memberIndex) => {
    const rowNumber = memberIndex + 3;
    const cells = [xlsxInlineCell(`A${rowNumber}`, m.name || '', 3)];
    let cachedTotal = 0;
    types.forEach((t, typeIndex) => {
      const value = Number(totals.get(`${m.id}@@${t.id}`) || 0);
      const price = typePrice(t) ?? 0;
      cachedTotal += value * price;
      cells.push(xlsxNumberCell(`${xlsxColumnName(typeIndex + 2)}${rowNumber}`, value, 4));
    });
    const formula = types.length
      ? `SUMPRODUCT(B${rowNumber}:${xlsxColumnName(lastTypeColumnIndex)}${rowNumber},$B$2:$${xlsxColumnName(lastTypeColumnIndex)}$2)`
      : '0';
    cells.push(xlsxFormulaCell(`${lastColumn}${rowNumber}`, formula, cachedTotal, 6));
    return `<row r="${rowNumber}" ht="26" customHeight="1">${cells.join('')}</row>`;
  }).join('');

  const typeColumns = types.map((t, index) => {
    const width = Math.min(24, Math.max(12, Array.from(String(t.name || '')).length * 2 + 4));
    const colIndex = index + 2;
    return `<col min="${colIndex}" max="${colIndex}" width="${width}" customWidth="1"/>`;
  }).join('');
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${lastRow}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane xSplit="1" ySplit="2" topLeftCell="B3" activePane="bottomRight" state="frozen"/><selection pane="topRight" activeCell="B1" sqref="B1"/><selection pane="bottomLeft" activeCell="A3" sqref="A3"/><selection pane="bottomRight" activeCell="B3" sqref="B3"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols><col min="1" max="1" width="18" customWidth="1"/>${typeColumns}<col min="${lastColumnIndex}" max="${lastColumnIndex}" width="20" customWidth="1"/></cols>
  <sheetData>
    <row r="1" ht="32" customHeight="1">${titleRowCells.join('')}</row>
    <row r="2" ht="28" customHeight="1">${priceRowCells.join('')}</row>
    ${dataRows}
  </sheetData>
  <sheetProtection sheet="0" objects="0" scenarios="0"/>
  <pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
  <pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3"><numFmt numFmtId="164" formatCode="¥#,##0.00;[Red]-¥#,##0.00"/><numFmt numFmtId="165" formatCode="0.00"/><numFmt numFmtId="166" formatCode="0.##"/></numFmts>
  <fonts count="4">
    <font><sz val="11"/><name val="Microsoft YaHei"/><family val="2"/><charset val="134"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/><family val="2"/><charset val="134"/></font>
    <font><b/><color rgb="FF155EEF"/><sz val="11"/><name val="Microsoft YaHei"/><family val="2"/><charset val="134"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="12"/><name val="Microsoft YaHei"/><family val="2"/><charset val="134"/></font>
  </fonts>
  <fills count="7"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF155EEF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF1FF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF8FAFC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF079455"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF1E8"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD0D5DD"/></left><right style="thin"><color rgb="FFD0D5DD"/></right><top style="thin"><color rgb="FFD0D5DD"/></top><bottom style="thin"><color rgb="FFD0D5DD"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="9">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="2" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
    <xf numFmtId="164" fontId="2" fillId="6" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="2" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
  const files = [
    { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>业绩助手</dc:creator><cp:lastModifiedBy>业绩助手</cp:lastModifiedBy><dc:title>${xlsxXmlEscape(month)} 全员当月业绩汇总</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>业绩助手</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>工作表</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>当月全员汇总</vt:lpstr></vt:vector></TitlesOfParts><Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion></Properties>` },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="15000"/></bookViews><sheets><sheet name="当月全员汇总" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="191029" calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', content: stylesXml },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml }
  ];
  return zipStoredBlob(files, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
async function exportMonthlyAllSummaryExcel() {
  if (!requireAuth('请先登录后再导出数据')) return;
  const user = currentUser();
  if (!isAdmin(user)) { showToast('只有管理员可以导出全员当月汇总'); return; }
  if (!(await syncLatestBeforeExport())) return;
  const month = window.__selectedMonth || monthStr();
  const members = (state.members || []).filter(m => m.active !== false).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'));
  const types = (state.types || []).filter(t => t.active !== false).slice().sort((a, b) => {
    const aGlobal = isGlobalType(a) ? 0 : 1;
    const bGlobal = isGlobalType(b) ? 0 : 1;
    return aGlobal - bGlobal || Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
  });
  const records = (state.records || []).filter(r => r.date && r.date.startsWith(month));
  const totals = new Map();
  records.forEach(r => {
    const key = `${r.memberId}@@${r.typeId}`;
    totals.set(key, (totals.get(key) || 0) + Number(r.value || 0));
  });
  const xlsxBlob = buildMonthlySummaryXlsx(month, members, types, totals);
  downloadBlob(`${month}_全员当月业绩汇总.xlsx`, xlsxBlob);
  const unpricedTypes = types.filter(t => typePrice(t) === null).length;
  showToast(`已导出 XLSX：${members.length} 人，${types.length} 个业绩类型${unpricedTypes ? `，${unpricedTypes} 个未定价类型按0元计算` : ''}`);
}

function exportExcel() {
  if (!requireAuth('请先登录后再导出数据')) return;
  const user = currentUser();
  const includeAmounts = canViewAnyAmount(user);
  const records = accessibleRecords(state.records, user).slice().sort((a, b) => (a.memberId || '').localeCompare(b.memberId || '') || (a.typeId || '').localeCompare(b.typeId || '') || (a.date || '').localeCompare(b.date || '') || (a.createdAt || '').localeCompare(b.createdAt || ''));
  const summary = typeSummary(records);
  const members = memberSummary(records);
  const scope = isAdmin(user) ? '全部成员数据' : `${memberById(user.memberId)?.name || user.displayName || user.username} 的个人数据`;
  const summaryRows = summary.map(x => `<tr><td>${excelCell(x.type.name)}</td><td>${excelCell(x.type.unit)}</td>${includeAmounts ? `<td class="num">${typePrice(x.type) === null ? '待定价' : typePrice(x.type)}</td>` : ''}<td class="num">${x.value}</td>${includeAmounts ? `<td class="num">${typePrice(x.type) === null ? '待定价' : x.totalPrice}</td>` : ''}<td class="num">${x.count}</td></tr>`).join('') || `<tr><td colspan="${includeAmounts ? 6 : 4}">暂无数据</td></tr>`;
  const memberRows = members.map(x => `<tr><td>${excelCell(x.member.name)}</td><td>${excelCell(x.member.role || '')}</td><td class="num">${x.count}</td><td class="num">${x.typeCount}</td>${includeAmounts ? `<td class="num">${x.totalPrice}</td><td class="num">${x.unpricedCount}</td>` : ''}</tr>`).join('') || `<tr><td colspan="${includeAmounts ? 6 : 4}">暂无数据</td></tr>`;
  const detailRows = records.map((r, i) => {
    const t = typeById(r.typeId) || { name:'已删除类型', unit:'', price:null };
    const m = memberById(r.memberId) || { name:'未分配成员', role:'' };
    const rp = recordPrice(r);
    return `<tr><td>${i + 1}</td><td>${excelCell(r.date)}</td><td>${excelCell(m.name)}</td><td>${excelCell(m.role || '')}</td><td>${excelCell(t.name)}</td><td class="num">${Number(r.value || 0)}</td><td>${excelCell(t.unit)}</td>${includeAmounts ? `<td class="num">${typePrice(t) === null ? '待定价' : typePrice(t)}</td><td class="num">${rp === null ? '待定价' : rp}</td>` : ''}<td>${excelCell(r.remark || '')}</td><td>${excelCell(formatDateTime(r.createdAt))}</td></tr>`;
  }).join('') || `<tr><td colspan="${includeAmounts ? 11 : 9}">暂无明细记录</td></tr>`;
  const grouped = summary.map(x => {
    const rows = records.filter(r => r.typeId === x.type.id).map((r, idx) => {
      const m = memberById(r.memberId) || { name:'未分配成员', role:'' };
      const rp = recordPrice(r);
      return `<tr><td>${idx + 1}</td><td>${excelCell(r.date)}</td><td>${excelCell(m.name)}</td><td class="num">${Number(r.value || 0)}</td><td>${excelCell(x.type.unit)}</td>${includeAmounts ? `<td class="num">${typePrice(x.type) === null ? '待定价' : typePrice(x.type)}</td><td class="num">${rp === null ? '待定价' : rp}</td>` : ''}<td>${excelCell(r.remark || '')}</td></tr>`;
    }).join('');
    return `<h2>${excelCell(x.type.name)} - 每次上传记录</h2><table><thead><tr><th>序号</th><th>日期</th><th>成员</th><th>本次上传数值</th><th>单位</th>${includeAmounts ? '<th>单价（元）</th><th>本次总价（元）</th>' : ''}<th>备注</th></tr></thead><tbody>${rows}<tr class="total"><td colspan="3">${excelCell(x.type.name)} 汇总</td><td class="num">${x.value}</td><td>${excelCell(x.type.unit)}</td>${includeAmounts ? `<td class="num">${typePrice(x.type) === null ? '待定价' : typePrice(x.type)}</td><td class="num">${typePrice(x.type) === null ? '待定价' : x.totalPrice}</td>` : ''}<td>共 ${x.count} 笔</td></tr></tbody></table>`;
  }).join('');
  const html = `<!doctype html><html><head><meta charset="UTF-8"><style>
    body{font-family:Arial,'Microsoft YaHei',sans-serif;color:#111827;} h1{font-size:22px;margin:0 0 8px;} h2{font-size:17px;margin:24px 0 8px;color:#155eef;} p{color:#475467;margin:4px 0 14px;} table{border-collapse:collapse;width:100%;margin-bottom:12px;} th{background:#eaf1ff;color:#155eef;font-weight:700;} th,td{border:1px solid #d0d5dd;padding:8px;mso-number-format:'\@';} td.num{mso-number-format:'0.00';text-align:right;} tr.total td{background:#f8fafc;font-weight:700;}
  </style></head><body>
    <h1>${includeAmounts ? '业绩数据与价格导出' : '业绩数据导出'}</h1><p>导出范围：${excelCell(scope)}；导出时间：${excelCell(nowLocalText())}；${includeAmounts ? '金额按导出时管理员设置的当前单价计算。' : '管理员已关闭普通用户金额显示，本文件不包含单价和金额字段。'}</p>
    <h2>业绩类型汇总</h2><table><thead><tr><th>业绩类型</th><th>单位</th>${includeAmounts ? '<th>单价（元）</th>' : ''}<th>总数量</th>${includeAmounts ? '<th>总价格（元）</th>' : ''}<th>上传笔数</th></tr></thead><tbody>${summaryRows}</tbody></table>
    <h2>成员汇总</h2><table><thead><tr><th>成员</th><th>岗位</th><th>上传笔数</th><th>类型数</th>${includeAmounts ? '<th>总价格（元）</th><th>待定价笔数</th>' : ''}</tr></thead><tbody>${memberRows}</tbody></table>
    <h2>全部明细记录</h2><table><thead><tr><th>序号</th><th>日期</th><th>成员</th><th>岗位</th><th>业绩类型</th><th>本次数值</th><th>单位</th>${includeAmounts ? '<th>单价（元）</th><th>本次总价（元）</th>' : ''}<th>备注</th><th>上传时间</th></tr></thead><tbody>${detailRows}</tbody></table>
    ${grouped || '<h2>按业绩类型分组</h2><p>暂无数据</p>'}
  </body></html>`;
  downloadFile(`${includeAmounts ? '业绩价格导出' : '业绩数据导出'}_${todayStr()}.xls`, '\ufeff' + html, 'application/vnd.ms-excel;charset=utf-8');
}
function exportCsv() {
  if (!requireAuth('请先登录后再导出数据')) return;
  const user = currentUser();
  const includeAmounts = canViewAnyAmount(user);
  const records = accessibleRecords(state.records, user);
  const header = ['日期', '成员', '岗位', '类型', '数值', '单位', ...(includeAmounts ? ['单价（元）', '总价格（元）'] : []), '备注', '上传时间'];
  const rows = records.map(r => {
    const t = typeById(r.typeId) || { name:'已删除类型', unit:'', price:null };
    const m = memberById(r.memberId) || { name:'未分配成员', role:'' };
    const rp = recordPrice(r);
    return [r.date, m.name, m.role || '', t.name, r.value, t.unit, ...(includeAmounts ? [typePrice(t) === null ? '待定价' : typePrice(t), rp === null ? '待定价' : rp] : []), r.remark || '', formatDateTime(r.createdAt)];
  });
  const csv = [header, ...rows].map(row => row.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadFile(includeAmounts ? 'performance-records-with-price.csv' : 'performance-records.csv', '\ufeff' + csv, 'text/csv;charset=utf-8');
}

window.openPerformanceEntryFromNotification = () => {
  if (!currentUser()) return;
  page = 'add';
  render();
  setTimeout(() => document.querySelector('#recordForm input, #recordForm select')?.focus?.(), 120);
};

document.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => {
  if (!requireAuth('请先登录后再使用')) return;
  page = b.dataset.page; render();
});
document.getElementById('syncBtn').onclick = () => pushToYunduan(true);
window.addEventListener('online', async () => {
  saveSyncMeta({ status: syncMeta.pending ? 'pending' : 'idle' });
  await flushPendingSessionReleases();
  if (currentUser() && cloudReady()) setTimeout(() => syncMeta.pending ? pushToYunduan(false) : pullFromYunduan(false), 300);
});
window.addEventListener('offline', () => saveSyncMeta({ status: 'offline' }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentUser() && cloudReady()) {
    setTimeout(() => syncMeta.pending ? pushToYunduan(false) : pullFromYunduan(false), 350);
  }
});
setInterval(() => {
  if (!currentUser() || !cloudReady() || syncInFlight) return;
  syncMeta.pending ? pushToYunduan(false) : pullFromYunduan(false);
}, 90000);
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
if (hasNativeReminder()) { applyNativeReminder(reminderSettings); readNativeReminderStatus(); } else scheduleBrowserReminderLoop();
render();
setTimeout(async () => {
  await flushPendingSessionReleases();
  if (currentUser() && cloudReady()) syncMeta.pending ? pushToYunduan(false) : pullFromYunduan(false);
}, 900);
