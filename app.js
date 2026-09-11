/* ==========================================================================
   FIREBASE — À CONFIGURER AVANT DÉPLOIEMENT
   --------------------------------------------------------------------------
   1. Projet Firebase > Firestore activé > Authentication activé (fournisseur
      "Email/Password") > crée les comptes de ton équipe côté console
      (Authentication > Users > Add user) — pas d'inscription depuis l'app.
   2. Colle ta config web dans l'objet firebaseConfig juste en dessous.
   3. Règles Firestore (accès réservé aux comptes authentifiés) :

      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /social_posts/{postId}      { allow read, write: if request.auth != null; }
          match /edo_ambassadors/{ambId}     { allow read, write: if request.auth != null; }
          match /edo_tasks/{taskId}          { allow read, write: if request.auth != null; }
          match /edo_editorial/{editoId}     { allow read, write: if request.auth != null; }
          match /edo_swipes/{swipeId}        { allow read, write: if request.auth != null; }
          match /app_settings/{settingId}    { allow read, write: if request.auth != null; }
        }
      }

   4. Collections utilisées : "social_posts", "edo_ambassadors", "edo_tasks",
      "edo_editorial", "edo_swipes", "app_settings" (créées automatiquement
      au premier enregistrement).
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, setDoc, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* ⚠️ Complète cet objet avec tes clés Firebase (Console > Paramètres du projet > SDK) */
const firebaseConfig = {
  apiKey: "AIzaSyAnc2-tFoPV0WjziXyHjJJIlF-OUKEYCh0",
  authDomain: "dashboardedo.firebaseapp.com",
  projectId: "dashboardedo",
  storageBucket: "dashboardedo.firebasestorage.app",
  messagingSenderId: "328324561956",
  appId: "1:328324561956:web:5c47027f0e481bdf5e2cb1"
};

const isConfigured = !!firebaseConfig.apiKey;
let db = null;
let auth = null;
let unsubscribers = [];

if (isConfigured) {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
  } catch (e) {
    console.error("Erreur d'initialisation Firebase :", e);
  }
} else {
  document.getElementById('config-banner').classList.remove('hidden');
  document.getElementById('login-config-banner').classList.remove('hidden');
  document.getElementById('connection-text').textContent = 'Firebase non configuré';
}

const postsCol = () => collection(db, 'social_posts');
const ambassadorsCol = () => collection(db, 'edo_ambassadors');
const tasksCol = () => collection(db, 'edo_tasks');
const editorialCol = () => collection(db, 'edo_editorial');
const swipeCol = () => collection(db, 'edo_swipes');
const settingsDoc = () => doc(db, 'app_settings', 'counters');

/* ============ CONFIG PLATEFORMES ============ */
const PLATFORM_CONFIG = {
  instagram: { label: 'Instagram', viewsLabel: 'Vues', metricALabel: 'Enregistrements', metricBLabel: 'Partages', color: '#FFA200' },
  linkedin:  { label: 'LinkedIn',  viewsLabel: 'Impressions', metricALabel: 'Reposts', metricBLabel: 'Clics', color: '#FFFFFF' }
};
function platformConfig(p) { return PLATFORM_CONFIG[p] || PLATFORM_CONFIG.instagram; }

const BREADCRUMB = {
  dashboard: { title: 'Dashboard RS', sub: "Le pouls de la communication EDO" },
  calendrier: { title: 'Calendrier suivi', sub: "La fréquence de publication, sans filtre" },
  edito: { title: 'Calendrier édito', sub: "Anticipe avant que ça ne parte en prod" },
  idees: { title: "Banque d'idées", sub: "La veille créative de la guilde" },
  ambassadeurs: { title: 'Ambassadeurs', sub: "Le classement de la team" },
  taches: { title: 'Quêtes', sub: "Le kanban de l'équipe" },
  brand: { title: 'Brand Center', sub: "Rester on-brand en toutes circonstances" }
};

const TASK_STATUSES = ['idees', 'afaire', 'encours', 'valide'];
const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const METRIC_TITLES = { views: 'Évolution des vues', likes: 'Évolution des likes', comments: 'Évolution des commentaires', engagement: "Évolution de l'engagement" };

/* ============ STATE ============ */
let state = {
  posts: [], ambassadors: [], tasks: [], editorial: [], swipes: [],
  activeTab: 'dashboard',
  formPlatform: 'instagram',
  editingId: null,
  range: { type: '7d', start: null, end: null },
  subview: 'global',
  chartMetric: 'views',
  followers: { linkedin: 0, instagram: 0 },
  draggedTaskId: null,
  calMonth: todayDate(),
  selectedCalDate: null,
  editoPlatform: 'instagram',
  editingEditoId: null
};

let lineChart = null;
let appIsShown = false;

/* ============ TOASTS ============ */
function toast(message, emoji) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast bg-black text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-lg flex items-center gap-2';
  el.innerHTML = `<span>${emoji || '✨'}</span><span>${message}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast-out');
    setTimeout(() => el.remove(), 300);
  }, 2200);
}

/* ============ AUTHENTIFICATION ============ */
document.getElementById('login-form') && document.getElementById('login-form').addEventListener('submit', handleLogin);

async function handleLogin(evt) {
  evt.preventDefault();
  const errorEl = document.getElementById('login-error');
  const submitBtn = document.getElementById('login-submit');
  errorEl.classList.add('hidden');

  if (!isConfigured || !auth) {
    errorEl.textContent = "Firebase n'est pas configuré — contacte un administrateur.";
    errorEl.classList.remove('hidden');
    return;
  }

  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  submitBtn.disabled = true;
  submitBtn.textContent = 'Connexion…';

  try {
    await signInWithEmailAndPassword(auth, email, password);
  } catch (err) {
    errorEl.textContent = mapAuthError(err);
    errorEl.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'SE CONNECTER';
  }
}

function mapAuthError(err) {
  const code = err && err.code ? err.code : '';
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(code)) {
    return 'Identifiants incorrects. Vérifie ton email et ton mot de passe.';
  }
  if (code === 'auth/too-many-requests') return 'Trop de tentatives — réessaie dans quelques minutes.';
  if (code === 'auth/network-request-failed') return 'Problème de connexion réseau. Réessaie.';
  return "Une erreur est survenue. Réessaie.";
}

window.handleLogout = async function () {
  if (!auth) return;
  try { await signOut(auth); } catch (e) { console.error('Erreur déconnexion :', e); }
};

function showLogin() {
  document.getElementById('auth-splash').classList.add('hidden');
  const login = document.getElementById('login-screen');
  const loading = document.getElementById('loading-screen');
  const shell = document.getElementById('app-shell');

  loading.classList.add('opacity-0');
  setTimeout(() => loading.classList.add('hidden'), 300);
  shell.classList.add('opacity-0');
  setTimeout(() => { shell.classList.add('hidden'); shell.classList.remove('flex'); }, 300);

  login.classList.remove('hidden');
  requestAnimationFrame(() => login.classList.remove('opacity-0'));
  document.getElementById('login-form').reset();
  document.getElementById('login-error').classList.add('hidden');
}

function showApp() {
  const loading = document.getElementById('loading-screen');
  const shell = document.getElementById('app-shell');
  loading.classList.add('opacity-0');
  setTimeout(() => loading.classList.add('hidden'), 400);
  shell.classList.remove('hidden');
  shell.classList.add('md:flex');
  requestAnimationFrame(() => shell.classList.remove('opacity-0'));
}

const LOADING_PHRASES = [
  "Connexion à la matrice EDO…",
  "Nourrissage de l'algorithme…",
  "Calcul du taux de viralité…",
  "Torréfaction du café de l'équipe…",
  "Prêt à buzzer !"
];

function runLoadingSequence(onDone) {
  document.getElementById('auth-splash').classList.add('hidden');
  const login = document.getElementById('login-screen');
  login.classList.add('opacity-0');
  setTimeout(() => login.classList.add('hidden'), 300);

  const loading = document.getElementById('loading-screen');
  const fill = document.getElementById('loading-fill');
  const pct = document.getElementById('loading-pct');
  const phraseEl = document.getElementById('loading-phrase');

  fill.style.width = '0%';
  pct.textContent = '0%';
  loading.classList.remove('hidden');
  requestAnimationFrame(() => loading.classList.remove('opacity-0'));

  const totalDuration = 2400;
  const stepEvery = Math.round(totalDuration / LOADING_PHRASES.length);
  let phraseIndex = 0;
  let progress = 0;

  const setPhrase = (i) => {
    phraseEl.classList.remove('phrase-anim');
    void phraseEl.offsetWidth;
    phraseEl.classList.add('phrase-anim');
    phraseEl.textContent = LOADING_PHRASES[i % LOADING_PHRASES.length];
  };
  setPhrase(0);
  requestAnimationFrame(() => { fill.style.width = '100%'; });

  const progressTimer = setInterval(() => {
    progress = Math.min(100, progress + 5);
    pct.textContent = progress + '%';
    if (progress >= 100) clearInterval(progressTimer);
  }, totalDuration / 20);

  const phraseTimer = setInterval(() => {
    phraseIndex += 1;
    if (phraseIndex < LOADING_PHRASES.length) setPhrase(phraseIndex);
  }, stepEvery);

  setTimeout(() => {
    clearInterval(progressTimer);
    clearInterval(phraseTimer);
    pct.textContent = '100%';
    setPhrase(LOADING_PHRASES.length - 1);
    setTimeout(() => { if (typeof onDone === 'function') onDone(); }, 250);
  }, totalDuration);
}

if (isConfigured && auth) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      if (!appIsShown) {
        runLoadingSequence(() => { showApp(); initListeners(); appIsShown = true; });
      }
    } else {
      appIsShown = false;
      cleanupListeners();
      showLogin();
    }
  });
} else {
  showLogin();
}

/* ============ FIRESTORE LISTENERS ============ */
function cleanupListeners() {
  unsubscribers.forEach(u => { try { u(); } catch (e) {} });
  unsubscribers = [];
}

function initListeners() {
  if (!isConfigured || !db) return;
  cleanupListeners();

  try {
    const postsQuery = query(postsCol(), orderBy('date', 'desc'));
    unsubscribers.push(onSnapshot(postsQuery, (snap) => {
      state.posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setConnectionStatus(true);
      renderDashboardTable(getCurrentFilteredPosts());
      renderXpAndStreak();
      if (state.activeTab === 'dashboard') renderDashboard();
      if (state.activeTab === 'calendrier') renderCalendarSuivi();
    }, (err) => { console.error('Erreur social_posts :', err); setConnectionStatus(false); }));

    const ambQuery = query(ambassadorsCol(), orderBy('points', 'desc'));
    unsubscribers.push(onSnapshot(ambQuery, (snap) => {
      state.ambassadors = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderAmbassadors();
    }, (err) => console.error('Erreur edo_ambassadors :', err)));

    const tasksQuery = query(tasksCol(), orderBy('createdAt', 'desc'));
    unsubscribers.push(onSnapshot(tasksQuery, (snap) => {
      state.tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderKanban();
    }, (err) => console.error('Erreur edo_tasks :', err)));

    const editoQuery = query(editorialCol(), orderBy('date', 'asc'));
    unsubscribers.push(onSnapshot(editoQuery, (snap) => {
      state.editorial = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderEditoList();
    }, (err) => console.error('Erreur edo_editorial :', err)));

    const swipeQuery = query(swipeCol(), orderBy('createdAt', 'desc'));
    unsubscribers.push(onSnapshot(swipeQuery, (snap) => {
      state.swipes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderSwipeGrid();
    }, (err) => console.error('Erreur edo_swipes :', err)));

    unsubscribers.push(onSnapshot(settingsDoc(), (snap) => {
      if (snap.exists()) {
        const data = snap.data() || {};
        state.followers.linkedin = data.linkedin || 0;
        state.followers.instagram = data.instagram || 0;
        renderFollowers();
      }
    }, (err) => console.error('Erreur app_settings :', err)));
  } catch (e) {
    console.error("Erreur d'initialisation des écouteurs :", e);
    setConnectionStatus(false);
  }
}

function setConnectionStatus(ok) {
  const dot = document.getElementById('connection-dot');
  const text = document.getElementById('connection-text');
  if (!dot || !text) return;
  if (ok) { dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400 glow-pulse'; text.textContent = 'CONNECTÉ'; }
  else { dot.className = 'w-1.5 h-1.5 rounded-full bg-red-400'; text.textContent = 'ERREUR DE CONNEXION'; }
}

/* ============ XP / NIVEAU / STREAK (cosmétique, basé sur les posts) ============ */
function renderXpAndStreak() {
  const total = state.posts.length;
  const level = Math.floor(total / 5) + 1;
  const xpInLevel = total % 5;
  const xpPct = (xpInLevel / 5) * 100;

  const levelLabel = document.getElementById('level-label');
  const xpFill = document.getElementById('xp-fill');
  if (levelLabel) levelLabel.textContent = 'NIVEAU ' + level;
  if (xpFill) xpFill.style.width = xpPct + '%';

  const dates = new Set(state.posts.map(p => p.date).filter(Boolean));
  let streak = 0;
  let cursor = todayDate();
  while (dates.has(toISO(cursor))) { streak += 1; cursor = addDays(cursor, -1); }
  const streakLabel = document.getElementById('streak-label');
  if (streakLabel) streakLabel.textContent = '🔥 ' + streak + 'J';
}

/* ============ ANIMATION HELPER ============ */
function replay(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.classList.add('fade-out');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('fade-out')));
}

/* ============ TABS ============ */
window.switchTab = function (tab) {
  state.activeTab = tab;
  const tabs = ['dashboard', 'calendrier', 'edito', 'idees', 'ambassadeurs', 'taches', 'brand'];
  tabs.forEach(t => {
    const s = document.getElementById('view-' + t);
    if (s) s.dataset.visible = (t === tab);
  });
  document.querySelectorAll('.nav-btn, .bottom-nav-btn').forEach(btn => {
    if (btn.dataset.tab) btn.dataset.active = (btn.dataset.tab === tab);
  });
  const active = document.getElementById('view-' + tab);
  if (active) active.classList.add('anim-fade-up');

  const crumb = BREADCRUMB[tab];
  if (crumb) {
    document.getElementById('breadcrumb-current').textContent = crumb.title;
    document.getElementById('breadcrumb-sub').textContent = crumb.sub;
  }

  if (tab === 'dashboard') renderDashboard();
  if (tab === 'calendrier') renderCalendarSuivi();
  if (tab === 'edito') renderEditoList();
  if (tab === 'idees') renderSwipeGrid();
  if (tab === 'taches') renderKanban();
  if (tab === 'ambassadeurs') renderAmbassadors();
};

/* ============ FOLLOWERS ============ */
window.toggleFollowersPanel = function () {
  document.getElementById('followers-panel').classList.toggle('hidden');
  document.getElementById('f-followers-linkedin').value = state.followers.linkedin;
  document.getElementById('f-followers-instagram').value = state.followers.instagram;
};

window.saveFollowers = async function () {
  const linkedin = Number(document.getElementById('f-followers-linkedin').value) || 0;
  const instagram = Number(document.getElementById('f-followers-instagram').value) || 0;
  if (!isConfigured || !db) { alert("Configure Firebase avant d'enregistrer les compteurs."); return; }
  try {
    await setDoc(settingsDoc(), { linkedin, instagram }, { merge: true });
    document.getElementById('followers-panel').classList.add('hidden');
    toast('Compteurs mis à jour — la hype est officielle', '📈');
  } catch (e) { console.error(e); alert("Impossible d'enregistrer les compteurs pour le moment."); }
};

function renderFollowers() {
  const l = document.getElementById('followers-linkedin');
  const i = document.getElementById('followers-instagram');
  if (l) l.textContent = new Intl.NumberFormat('fr-FR').format(state.followers.linkedin || 0);
  if (i) i.textContent = new Intl.NumberFormat('fr-FR').format(state.followers.instagram || 0);
}

/* ============ FORM (Saisie) ============ */
window.toggleForm = function () {
  const form = document.getElementById('post-form');
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden')) window.scrollTo({ top: form.offsetTop - 90, behavior: 'smooth' });
};

window.setPlatform = function (platform) {
  state.formPlatform = platform;
  document.getElementById('btn-instagram').dataset.active = (platform === 'instagram');
  document.getElementById('btn-linkedin').dataset.active = (platform === 'linkedin');
  renderMetricsGrid();
};

function renderMetricsGrid(values) {
  const cfg = platformConfig(state.formPlatform);
  const v = values || {};
  const grid = document.getElementById('metrics-grid');
  grid.innerHTML = `
    <div><label class="hud-label">${cfg.viewsLabel}</label>
      <input required type="number" min="0" id="f-views" value="${v.views ?? ''}" class="hud-input w-full" /></div>
    <div><label class="hud-label">Likes</label>
      <input required type="number" min="0" id="f-likes" value="${v.likes ?? ''}" class="hud-input w-full" /></div>
    <div><label class="hud-label">Commentaires</label>
      <input required type="number" min="0" id="f-comments" value="${v.comments ?? ''}" class="hud-input w-full" /></div>
    <div><label class="hud-label">${cfg.metricALabel}</label>
      <input required type="number" min="0" id="f-metricA" value="${v.metricA ?? ''}" class="hud-input w-full" /></div>
    <div><label class="hud-label">${cfg.metricBLabel}</label>
      <input required type="number" min="0" id="f-metricB" value="${v.metricB ?? ''}" class="hud-input w-full" /></div>
  `;
}

document.getElementById('post-form') && document.getElementById('post-form').addEventListener('submit', handleSubmit);

async function handleSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert("Configure Firebase avant d'ajouter des données."); return; }

  const payload = {
    date: document.getElementById('f-date').value,
    platform: state.formPlatform,
    title: (document.getElementById('f-title').value || '').trim(),
    views: Number(document.getElementById('f-views').value) || 0,
    likes: Number(document.getElementById('f-likes').value) || 0,
    comments: Number(document.getElementById('f-comments').value) || 0,
    metricA: Number(document.getElementById('f-metricA').value) || 0,
    metricB: Number(document.getElementById('f-metricB').value) || 0
  };

  const submitBtn = document.getElementById('submit-btn');
  submitBtn.disabled = true;

  try {
    if (state.editingId) {
      await updateDoc(doc(db, 'social_posts', state.editingId), payload);
      toast('Publication mise à jour', '✏️');
      cancelEdit();
    } else {
      await addDoc(postsCol(), { ...payload, createdAt: serverTimestamp() });
      toast('+50 XP — publication ajoutée', '🎮');
      evt.target.reset();
      document.getElementById('f-date').value = '';
      setPlatform(state.formPlatform);
      document.getElementById('post-form').classList.add('hidden');
    }
  } catch (e) {
    console.error(e);
    alert("Impossible d'enregistrer cette publication pour le moment. Réessaie.");
  } finally {
    submitBtn.disabled = false;
  }
}

window.editPost = function (id) {
  const post = state.posts.find(p => p.id === id);
  if (!post) return;
  state.editingId = id;
  document.getElementById('post-form').classList.remove('hidden');
  document.getElementById('form-title').textContent = 'Modifier une publication';
  document.getElementById('submit-btn').textContent = 'ENREGISTRER LES MODIFICATIONS';
  document.getElementById('cancel-edit-btn').classList.remove('hidden');
  document.getElementById('f-date').value = post.date || '';
  document.getElementById('f-title').value = post.title || '';
  setPlatform(post.platform || 'instagram');
  renderMetricsGrid(post);
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.cancelEdit = function () {
  state.editingId = null;
  document.getElementById('form-title').textContent = 'Ajouter une publication';
  document.getElementById('submit-btn').textContent = 'AJOUTER LES PERFORMANCES';
  document.getElementById('cancel-edit-btn').classList.add('hidden');
  document.getElementById('post-form').reset();
  document.getElementById('f-date').value = '';
  setPlatform('instagram');
};

window.deletePost = async function (id) {
  if (!confirm('Supprimer définitivement cette publication ?')) return;
  try { await deleteDoc(doc(db, 'social_posts', id)); toast('Publication supprimée', '🗑️'); }
  catch (e) { console.error(e); alert("Impossible de supprimer cette publication pour le moment."); }
};

/* ============ CSV EXPORT ============ */
window.exportPostsCSV = function () {
  if (state.posts.length === 0) { alert('Aucune donnée à exporter pour le moment.'); return; }
  const headers = ['Date', 'Plateforme', 'Titre', 'Vues', 'Likes', 'Commentaires', 'Metrique_A', 'Metrique_B', 'Interactions', 'Engagement_%'];
  const rows = [...state.posts].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(p => [
    p.date || '', platformConfig(p.platform).label, p.title || '', num(p.views), num(p.likes), num(p.comments),
    num(p.metricA), num(p.metricB), interactions(p), engagementRate(p).toFixed(1)
  ]);
  const csvEscape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(row => row.map(csvEscape).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `edo-social-posts-${toISO(todayDate())}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Export CSV téléchargé', '⬇️');
};

/* ============ METRICS HELPERS ============ */
function num(v) { return typeof v === 'number' && !isNaN(v) ? v : 0; }
function interactions(post) { return num(post.likes) + num(post.comments) + num(post.metricA) + num(post.metricB); }
function likesComments(post) { return num(post.likes) + num(post.comments); }
function engagementRate(post) { return num(post.views) > 0 ? (interactions(post) / num(post.views)) * 100 : 0; }
function formatNumber(n) { return new Intl.NumberFormat('fr-FR').format(Math.round(num(n))); }
function formatPercent(n) { return (n >= 0 ? '+' : '') + n.toFixed(1) + ' %'; }
function escapeHtml(str) { const d = document.createElement('div'); d.textContent = str ?? ''; return d.innerHTML; }
function platformBadge(platform) {
  const isInsta = platform === 'instagram';
  const cls = isInsta
    ? 'bg-edo-orange/15 text-edo-orange border border-edo-orange/25'
    : 'bg-white/10 text-white border border-white/15';
  return `<span class="inline-flex items-center gap-1.5 text-[10px] font-bold font-mono uppercase tracking-wide px-2 py-1 rounded ${cls}">${platformConfig(platform).label}</span>`;
}

/* ============ DATE HELPERS ============ */
function toISO(d) { return d.toISOString().slice(0, 10); }
function addDays(d, days) { const nd = new Date(d); nd.setDate(nd.getDate() + days); return nd; }
function todayDate() { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); }
function formatDateFr(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return d + ' ' + MONTH_NAMES[m - 1] + ' ' + y;
}

function computeRangeDates() {
  const today = todayDate();
  if (state.range.type === '7d') return { start: toISO(addDays(today, -6)), end: toISO(today) };
  if (state.range.type === '30d') return { start: toISO(addDays(today, -29)), end: toISO(today) };
  return { start: state.range.start, end: state.range.end };
}
function computePreviousRangeDates(current) {
  const start = new Date(current.start);
  const end = new Date(current.end);
  const lengthDays = Math.round((end - start) / 86400000) + 1;
  const prevEnd = addDays(start, -1);
  const prevStart = addDays(prevEnd, -(lengthDays - 1));
  return { start: toISO(prevStart), end: toISO(prevEnd) };
}

window.setRange = function (type) {
  state.range.type = type;
  document.querySelectorAll('.range-btn').forEach(btn => { btn.dataset.active = (btn.dataset.range === type); });
  document.getElementById('custom-range-bar').classList.toggle('hidden', type !== 'custom');
  if (type !== 'custom') renderDashboard();
};

window.applyCustomRange = function () {
  const start = document.getElementById('custom-start').value;
  const end = document.getElementById('custom-end').value;
  if (!start || !end || start > end) { alert('Merci de sélectionner une période valide.'); return; }
  state.range.start = start;
  state.range.end = end;
  renderDashboard();
};

window.setSubview = function (subview) {
  state.subview = subview;
  document.querySelectorAll('.subview-btn').forEach(btn => { btn.dataset.active = (btn.dataset.subview === subview); });
  renderDashboard();
};

function postsInDateRange(range) {
  if (!range.start || !range.end) return [];
  return state.posts.filter(p => p.date && p.date >= range.start && p.date <= range.end);
}
function filterByPlatform(posts, subview) { return subview === 'global' ? posts : posts.filter(p => p.platform === subview); }
function getCurrentFilteredPosts() { return filterByPlatform(postsInDateRange(computeRangeDates()), state.subview); }

/* ============ KPIs ============ */
function computeKPIs(posts) {
  const totalViews = posts.reduce((s, p) => s + num(p.views), 0);
  const totalLikes = posts.reduce((s, p) => s + num(p.likes), 0);
  const totalComments = posts.reduce((s, p) => s + num(p.comments), 0);
  const totalInteractions = posts.reduce((s, p) => s + interactions(p), 0);
  const avgEngagement = totalViews > 0 ? (totalInteractions / totalViews) * 100 : 0;
  return { totalViews, totalLikes, totalComments, avgEngagement };
}
function evolutionLabel(current, previous) {
  if (previous === 0) return current === 0 ? { text: 'Stable vs préc.', cls: 'text-white/30' } : { text: 'Nouveau vs préc.', cls: 'text-edo-orange' };
  const pct = ((current - previous) / previous) * 100;
  return { text: formatPercent(pct) + ' vs préc.', cls: pct >= 0 ? 'text-emerald-400' : 'text-red-400' };
}
function setEvo(elId, current, previous) {
  const evo = evolutionLabel(current, previous);
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = evo.text;
  el.className = 'hud-kpi-evo ' + evo.cls;
}

function renderKPIs(range, prevRange) {
  const allCurrent = postsInDateRange(range);
  const allPrevious = postsInDateRange(prevRange);
  const currentPosts = filterByPlatform(allCurrent, state.subview);
  const previousPosts = filterByPlatform(allPrevious, state.subview);
  const cur = computeKPIs(currentPosts);
  const prev = computeKPIs(previousPosts);

  document.getElementById('kpi-views').textContent = formatNumber(cur.totalViews);
  document.getElementById('kpi-likes').textContent = formatNumber(cur.totalLikes);
  document.getElementById('kpi-comments').textContent = formatNumber(cur.totalComments);
  document.getElementById('kpi-engagement').textContent = cur.avgEngagement.toFixed(1) + ' %';
  setEvo('kpi-views-evo', cur.totalViews, prev.totalViews);
  setEvo('kpi-likes-evo', cur.totalLikes, prev.totalLikes);
  setEvo('kpi-comments-evo', cur.totalComments, prev.totalComments);
  setEvo('kpi-engagement-evo', cur.avgEngagement, prev.avgEngagement);
  document.getElementById('kpi-visibility').textContent = formatNumber(computeKPIs(allCurrent).totalViews);

  replay('kpi-grid');
  return currentPosts;
}

/* ============ CHART ============ */
window.setChartMetric = function (metric) {
  state.chartMetric = metric;
  document.querySelectorAll('.metric-btn').forEach(btn => { btn.dataset.active = (btn.dataset.metric === metric); });
  renderDashboard();
};

function metricDailyValue(posts, metric) {
  if (metric === 'engagement') {
    const totalViews = posts.reduce((s, p) => s + num(p.views), 0);
    const totalInter = posts.reduce((s, p) => s + interactions(p), 0);
    return totalViews > 0 ? (totalInter / totalViews) * 100 : 0;
  }
  return posts.reduce((s, p) => s + num(p[metric]), 0);
}

function renderLineChart(currentPosts) {
  const canvas = document.getElementById('chart-line');
  if (!canvas) return;
  const metric = state.chartMetric || 'views';
  const titleEl = document.getElementById('chart-title');
  if (titleEl) titleEl.textContent = METRIC_TITLES[metric] || METRIC_TITLES.views;

  const dates = [...new Set(currentPosts.map(p => p.date).filter(Boolean))].sort();
  const ctx = canvas.getContext('2d');
  if (lineChart) { lineChart.destroy(); lineChart = null; }
  if (dates.length === 0) return;

  let datasets;
  if (state.subview === 'global') {
    datasets = [
      { label: 'Instagram', data: dates.map(d => metricDailyValue(currentPosts.filter(p => p.date === d && p.platform === 'instagram'), metric)), borderColor: '#FFA200', backgroundColor: 'rgba(255,162,0,0.14)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#FFA200' },
      { label: 'LinkedIn', data: dates.map(d => metricDailyValue(currentPosts.filter(p => p.date === d && p.platform === 'linkedin'), metric)), borderColor: '#FFFFFF', backgroundColor: 'rgba(255,255,255,0.08)', fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: '#FFFFFF' }
    ];
  } else {
    const isInsta = state.subview === 'instagram';
    datasets = [{
      label: platformConfig(state.subview).label,
      data: dates.map(d => metricDailyValue(currentPosts.filter(p => p.date === d), metric)),
      borderColor: isInsta ? '#FFA200' : '#FFFFFF',
      backgroundColor: isInsta ? 'rgba(255,162,0,0.14)' : 'rgba(255,255,255,0.08)',
      fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: isInsta ? '#FFA200' : '#FFFFFF'
    }];
  }

  try {
    lineChart = new Chart(ctx, {
      type: 'line', data: { labels: dates, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, color: 'rgba(255,255,255,0.6)', font: { family: 'Inter', size: 11 } } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.35)', font: { size: 10 } } },
          y: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: 'rgba(255,255,255,0.35)', font: { size: 10 } } }
        }
      }
    });
  } catch (e) { console.error('Erreur graphique :', e); }
  replay('chart-wrapper');
}

/* ============ PALMARÈS ============ */
function renderRanking(elId, posts, valueFn, formatFn) {
  const el = document.getElementById(elId);
  if (!el) return;
  const top3 = [...posts].sort((a, b) => valueFn(b) - valueFn(a)).slice(0, 3);
  if (top3.length === 0) { el.innerHTML = '<p class="text-xs text-white/30">Pas assez de données ici — patience, jeune padawan.</p>'; return; }
  el.innerHTML = top3.map((p, i) => `
    <li class="flex items-center gap-3">
      <span class="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${i === 0 ? 'bg-gradient-to-br from-edo-orange to-edo-yellow text-black' : 'bg-white/8 text-white/50'}">${i + 1}</span>
      <div class="min-w-0 flex-1">
        <p class="text-sm text-white/80 truncate">${escapeHtml(p.title || 'Sans titre')}</p>
        <p class="text-[11px] text-white/35">${platformConfig(p.platform).label} · ${escapeHtml(p.date || '—')}</p>
      </div>
      <span class="text-sm font-heading font-bold shrink-0 text-white">${formatFn(valueFn(p))}</span>
    </li>`).join('');
}

/* ============ TABLE (historique) ============ */
function renderDashboardTable(posts) {
  const tbody = document.getElementById('dashboard-table');
  const empty = document.getElementById('dashboard-empty');
  if (!tbody) return;
  const sorted = [...posts].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (sorted.length === 0) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  tbody.innerHTML = sorted.map(p => `
    <tr>
      <td class="whitespace-nowrap font-mono text-xs">${escapeHtml(p.date || '—')}</td>
      <td>${platformBadge(p.platform)}</td>
      <td>${escapeHtml(p.title || 'Sans titre')}</td>
      <td>${formatNumber(p.views)}</td>
      <td>${formatNumber(interactions(p))}</td>
      <td class="font-semibold text-edo-orange">${engagementRate(p).toFixed(1)} %</td>
      <td class="whitespace-nowrap">
        <button onclick="editPost('${p.id}')" class="text-edo-orange hover:underline text-xs font-semibold mr-3">Modifier</button>
        <button onclick="deletePost('${p.id}')" class="text-white/30 hover:text-white/70 text-xs">Supprimer</button>
      </td>
    </tr>`).join('');
  replay('dashboard-table-wrapper');
}

/* ============ DASHBOARD ORCHESTRATION ============ */
function renderDashboard() {
  if (state.range.type === 'custom' && (!state.range.start || !state.range.end)) {
    const today = todayDate();
    document.getElementById('custom-start').value = toISO(addDays(today, -29));
    document.getElementById('custom-end').value = toISO(today);
    return;
  }
  const range = computeRangeDates();
  const prevRange = computePreviousRangeDates(range);
  const currentPosts = renderKPIs(range, prevRange);

  renderLineChart(currentPosts);
  renderRanking('ranking-engagement', currentPosts, engagementRate, v => v.toFixed(1) + ' %');
  renderRanking('ranking-views', currentPosts, p => num(p.views), v => formatNumber(v));
  renderRanking('ranking-interactions', currentPosts, likesComments, v => formatNumber(v));
  renderDashboardTable(currentPosts);
  replay('ranking-grid');
}

/* ============ CALENDRIER SUIVI ============ */
window.shiftMonth = function (delta) {
  const d = state.calMonth;
  state.calMonth = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  state.selectedCalDate = null;
  const panel = document.getElementById('cal-day-panel');
  if (panel) panel.classList.add('hidden');
  renderCalendarSuivi();
};

function platformDotHtml(platform) {
  const isInsta = platform === 'instagram';
  return `<span class="cal-dot ${isInsta ? 'bg-edo-orange' : 'bg-white'} shrink-0"></span>`;
}

function renderCalendarSuivi() {
  const label = document.getElementById('cal-month-label');
  const grid = document.getElementById('cal-grid');
  if (!label || !grid) return;

  const d = state.calMonth;
  const year = d.getFullYear();
  const month = d.getMonth();
  label.textContent = MONTH_NAMES[month] + ' ' + year;

  const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
  const totalDays = daysInMonth(year, month);
  let html = '';

  for (let i = 0; i < firstDow; i++) html += `<div class="cal-cell" style="opacity:.25"></div>`;

  for (let day = 1; day <= totalDays; day++) {
    const dateIso = toISO(new Date(year, month, day));
    const dayPosts = state.posts.filter(p => p.date === dateIso);
    const hasIG = dayPosts.some(p => p.platform === 'instagram');
    const hasLI = dayPosts.some(p => p.platform === 'linkedin');
    const hasPost = dayPosts.length > 0;
    const selected = state.selectedCalDate === dateIso;
    const isToday = dateIso === toISO(todayDate());
    html += `<div class="cal-cell" data-has-post="${hasPost}" data-selected="${selected}" ${hasPost ? `onclick="selectCalDay('${dateIso}')"` : ''}>
      <span class="cal-day-num" style="${isToday ? 'color:#FFA200;font-weight:700;' : ''}">${day}</span>
      <div class="flex items-center gap-1">
        ${hasIG ? platformDotHtml('instagram') : ''}
        ${hasLI ? platformDotHtml('linkedin') : ''}
      </div>
    </div>`;
  }

  grid.innerHTML = html;
  replay('cal-wrapper');
}

window.selectCalDay = function (dateIso) {
  state.selectedCalDate = dateIso;
  renderCalendarSuivi();

  const dayPosts = state.posts.filter(p => p.date === dateIso);
  const panel = document.getElementById('cal-day-panel');
  const title = document.getElementById('cal-day-title');
  const list = document.getElementById('cal-day-posts');
  if (!panel || !title || !list) return;

  title.textContent = formatDateFr(dateIso) + ' — ' + dayPosts.length + ' publication' + (dayPosts.length > 1 ? 's' : '');
  list.innerHTML = dayPosts.map(p => `
    <div class="flex items-center justify-between gap-3 px-3 py-2.5 rounded bg-white/[0.03] border border-white/5">
      <div class="flex items-center gap-2.5 min-w-0">
        ${platformDotHtml(p.platform)}
        <p class="text-sm text-white/80 truncate">${escapeHtml(p.title || 'Sans titre')}</p>
      </div>
      <p class="text-xs text-white/40 font-mono shrink-0">${formatNumber(p.views)} vues</p>
    </div>`).join('');

  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

/* ============ CALENDRIER ÉDITO ============ */
window.toggleEditoForm = function () {
  const form = document.getElementById('edito-form');
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden')) window.scrollTo({ top: form.offsetTop - 90, behavior: 'smooth' });
};

window.setEditoPlatform = function (platform) {
  state.editoPlatform = platform;
  document.getElementById('e-btn-instagram').dataset.active = (platform === 'instagram');
  document.getElementById('e-btn-linkedin').dataset.active = (platform === 'linkedin');
};

document.getElementById('edito-form') && document.getElementById('edito-form').addEventListener('submit', handleEditoSubmit);

async function handleEditoSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert("Configure Firebase avant de planifier un post."); return; }

  const payload = {
    date: document.getElementById('e-date').value,
    platform: state.editoPlatform,
    subject: (document.getElementById('e-subject').value || '').trim(),
    description: (document.getElementById('e-description').value || '').trim()
  };

  const btn = document.getElementById('edito-submit-btn');
  btn.disabled = true;

  try {
    if (state.editingEditoId) {
      await updateDoc(doc(db, 'edo_editorial', state.editingEditoId), payload);
      toast('Ligne édito mise à jour', '📝');
      cancelEditoEdit();
    } else {
      await addDoc(editorialCol(), { ...payload, done: false, createdAt: serverTimestamp() });
      toast("Post planifié — le calendrier n'a plus de secrets", '🗓️');
      evt.target.reset();
      document.getElementById('e-date').value = '';
      setEditoPlatform(state.editoPlatform);
      document.getElementById('edito-form').classList.add('hidden');
    }
  } catch (e) {
    console.error(e);
    alert("Impossible d'enregistrer cette ligne édito pour le moment.");
  } finally {
    btn.disabled = false;
  }
}

window.editEdito = function (id) {
  const item = state.editorial.find(e => e.id === id);
  if (!item) return;
  state.editingEditoId = id;
  document.getElementById('edito-form').classList.remove('hidden');
  document.getElementById('e-date').value = item.date || '';
  document.getElementById('e-subject').value = item.subject || '';
  document.getElementById('e-description').value = item.description || '';
  setEditoPlatform(item.platform || 'instagram');
  document.getElementById('edito-submit-btn').textContent = 'ENREGISTRER LES MODIFICATIONS';
  document.getElementById('edito-cancel-btn').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.cancelEditoEdit = function () {
  state.editingEditoId = null;
  document.getElementById('edito-form').reset();
  document.getElementById('e-date').value = '';
  setEditoPlatform('instagram');
  document.getElementById('edito-submit-btn').textContent = 'PLANIFIER';
  document.getElementById('edito-cancel-btn').classList.add('hidden');
};

window.deleteEdito = async function (id) {
  if (!confirm('Supprimer cette ligne du planning édito ?')) return;
  try { await deleteDoc(doc(db, 'edo_editorial', id)); toast('Ligne édito supprimée', '🗑️'); }
  catch (e) { console.error(e); alert('Impossible de supprimer cette ligne pour le moment.'); }
};

window.toggleEditoDone = async function (id, current) {
  if (!isConfigured || !db) return;
  try {
    await updateDoc(doc(db, 'edo_editorial', id), { done: !current });
    toast(!current ? 'Publié ! Le stagiaire peut souffler 😮\u200d💨' : 'Remis en attente — retour en coulisses', !current ? '✅' : '↩️');
  } catch (e) { console.error(e); alert('Impossible de mettre à jour ce statut pour le moment.'); }
};

function renderEditoList() {
  const listEl = document.getElementById('edito-list');
  const empty = document.getElementById('edito-empty');
  if (!listEl) return;
  const sorted = [...state.editorial].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  if (sorted.length === 0) { listEl.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  listEl.innerHTML = sorted.map(item => `
    <div class="edito-row p-4 md:p-5 flex flex-col sm:flex-row sm:items-center gap-3" data-done="${!!item.done}">
      <div class="sm:w-24 shrink-0"><p class="text-xs font-mono text-white/50">${escapeHtml(item.date || '—')}</p></div>
      <div class="sm:w-28 shrink-0">${platformBadge(item.platform)}</div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-white/85 truncate">${escapeHtml(item.subject || 'Sans sujet')}</p>
        ${item.description ? `<p class="text-xs text-white/35 mt-0.5">${escapeHtml(item.description)}</p>` : ''}
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button class="edito-done-btn" data-done="${!!item.done}" onclick="toggleEditoDone('${item.id}', ${!!item.done})">${item.done ? '✅ FAIT' : '⏳ À FAIRE'}</button>
        <button onclick="editEdito('${item.id}')" class="text-edo-orange hover:underline text-xs font-semibold">Modifier</button>
        <button onclick="deleteEdito('${item.id}')" class="text-white/25 hover:text-white/60 text-xs">✕</button>
      </div>
    </div>`).join('');
}

/* ============ BANQUE D'IDÉES ============ */
document.getElementById('swipe-form') && document.getElementById('swipe-form').addEventListener('submit', handleSwipeSubmit);

async function handleSwipeSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert("Configure Firebase avant d'ajouter une idée."); return; }

  const payload = {
    url: (document.getElementById('f-swipe-url').value || '').trim(),
    note: (document.getElementById('f-swipe-note').value || '').trim()
  };

  try {
    await addDoc(swipeCol(), { ...payload, createdAt: serverTimestamp() });
    evt.target.reset();
    toast("Idée ajoutée à la veille — merci l'algorithme", '💡');
  } catch (e) { console.error(e); alert("Impossible d'ajouter cette idée pour le moment."); }
}

window.deleteSwipe = async function (id) {
  if (!confirm('Retirer cette idée du mood board ?')) return;
  try { await deleteDoc(doc(db, 'edo_swipes', id)); }
  catch (e) { console.error(e); alert('Impossible de supprimer cette idée pour le moment.'); }
};

function domainOf(url) {
  try { return new URL(url).hostname.replace('www.', ''); }
  catch (e) { return url || ''; }
}

function renderSwipeGrid() {
  const grid = document.getElementById('swipe-grid');
  const empty = document.getElementById('swipe-empty');
  if (!grid) return;
  const sorted = [...state.swipes].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

  if (sorted.length === 0) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  grid.innerHTML = sorted.map(s => `
    <div class="hud-panel p-4 md:p-5">
      <div class="flex items-start justify-between gap-2">
        <a href="${escapeHtml(s.url || '#')}" target="_blank" rel="noopener" class="text-xs font-mono text-edo-orange hover:underline truncate">${escapeHtml(domainOf(s.url))} ↗</a>
        <button onclick="deleteSwipe('${s.id}')" class="text-white/25 hover:text-white/60 text-xs shrink-0" title="Supprimer">✕</button>
      </div>
      <p class="text-sm text-white/75 mt-2.5 leading-relaxed">${escapeHtml(s.note || '')}</p>
    </div>`).join('');
}

/* ============ AMBASSADEURS ============ */
document.getElementById('ambassador-form') && document.getElementById('ambassador-form').addEventListener('submit', handleAmbassadorSubmit);

async function handleAmbassadorSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert('Configure Firebase avant de recruter un ambassadeur.'); return; }

  const payload = {
    firstname: (document.getElementById('amb-firstname').value || '').trim(),
    lastname: (document.getElementById('amb-lastname').value || '').trim(),
    email: (document.getElementById('amb-email').value || '').trim(),
    phone: (document.getElementById('amb-phone').value || '').trim(),
    points: 0
  };

  try {
    await addDoc(ambassadorsCol(), { ...payload, createdAt: serverTimestamp() });
    evt.target.reset();
    toast('Nouvel ambassadeur recruté — bienvenue dans la guilde', '🎉');
  } catch (e) { console.error(e); alert("Impossible d'ajouter cet ambassadeur pour le moment."); }
}

window.addAmbassadorPoints = async function (id, amount) {
  if (!isConfigured || !db) return;
  try {
    await updateDoc(doc(db, 'edo_ambassadors', id), { points: increment(amount) });
    toast(amount >= 25 ? '🔥 +25 points — légende en approche' : '+' + amount + ' points', amount >= 25 ? '🔥' : '⭐');
  } catch (e) { console.error(e); alert("Impossible d'ajouter les points pour le moment."); }
};

window.deleteAmbassador = async function (id) {
  if (!confirm('Retirer cet ambassadeur du classement ?')) return;
  try { await deleteDoc(doc(db, 'edo_ambassadors', id)); }
  catch (e) { console.error(e); alert("Impossible de supprimer cet ambassadeur pour le moment."); }
};

function medalFor(rank) {
  if (rank === 0) return '🥇';
  if (rank === 1) return '🥈';
  if (rank === 2) return '🥉';
  return '#' + (rank + 1);
}

function renderAmbassadors() {
  const list = document.getElementById('ambassador-list');
  const empty = document.getElementById('ambassador-empty');
  if (!list) return;

  const fullSorted = [...state.ambassadors].sort((a, b) => num(b.points) - num(a.points));
  const searchInput = document.getElementById('amb-search');
  const q = (searchInput ? searchInput.value : '').trim().toLowerCase();
  const visible = q
    ? fullSorted.filter(a => `${a.firstname || ''} ${a.lastname || ''}`.toLowerCase().includes(q))
    : fullSorted;

  if (visible.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    if (q && state.ambassadors.length > 0) {
      empty.innerHTML = `<p class="text-sm font-semibold text-white/50">Aucun·e ambassadeur·rice ne répond à "${escapeHtml(q)}".</p><p class="text-xs text-white/25 mt-1">Vérifie l'orthographe, ou recrute-en un·e nouveau·elle.</p>`;
    } else {
      empty.innerHTML = `<p class="text-sm font-semibold text-white/50">Le podium est vide.</p><p class="text-xs text-white/25 mt-1">Recrute ton premier ambassadeur ci-dessus.</p>`;
    }
    return;
  }
  empty.classList.add('hidden');

  list.innerHTML = visible.map(a => {
    const rank = fullSorted.findIndex(x => x.id === a.id);
    const rankClass = rank === 0 ? 'amb-rank-1' : rank === 1 ? 'amb-rank-2' : rank === 2 ? 'amb-rank-3' : '';
    return `
    <div class="amb-row px-4 sm:px-5 py-4 flex flex-wrap items-center gap-4 ${rankClass}">
      <span class="font-heading font-black text-xl w-10 text-center shrink-0">${medalFor(rank)}</span>
      <div class="w-10 h-10 rounded-full bg-gradient-to-br from-edo-orange to-edo-yellow text-black flex items-center justify-center font-heading font-bold text-xs shrink-0">${escapeHtml(((a.firstname || '?')[0] || '') + ((a.lastname || '')[0] || ''))}</div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold text-white/85 truncate">${escapeHtml(a.firstname || '')} ${escapeHtml(a.lastname || '')}</p>
        <p class="text-[11px] text-white/35 truncate">${escapeHtml(a.email || '')}${a.phone ? ' · ' + escapeHtml(a.phone) : ''}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="font-heading font-extrabold text-lg text-edo-orange">${formatNumber(a.points)}</span>
        <span class="text-[11px] text-white/35">pts</span>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button onclick="addAmbassadorPoints('${a.id}', 5)" class="px-2.5 py-1.5 rounded text-xs font-bold border border-white/15 text-white/70 hover:border-edo-orange/50 hover:text-edo-orange">+5</button>
        <button onclick="addAmbassadorPoints('${a.id}', 10)" class="px-2.5 py-1.5 rounded text-xs font-bold border border-white/15 text-white/70 hover:border-edo-orange/50 hover:text-edo-orange">+10</button>
        <button onclick="addAmbassadorPoints('${a.id}', 25)" class="px-2.5 py-1.5 rounded text-xs font-bold bg-gradient-to-br from-edo-orange to-edo-yellow text-black">+25</button>
        <button onclick="deleteAmbassador('${a.id}')" class="px-2 py-1.5 rounded text-xs text-white/30 hover:text-white/70" title="Retirer">✕</button>
      </div>
    </div>`;
  }).join('');
}

/* ============ KANBAN ============ */
document.getElementById('task-form') && document.getElementById('task-form').addEventListener('submit', handleTaskSubmit);

async function handleTaskSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert("Configure Firebase avant d'ajouter une tâche."); return; }
  const title = (document.getElementById('t-title').value || '').trim();
  const assignee = (document.getElementById('t-assignee').value || '').trim();
  const status = document.getElementById('t-status').value;
  try {
    await addDoc(tasksCol(), { title, assignee, status, createdAt: serverTimestamp() });
    evt.target.reset();
    document.getElementById('t-status').value = status;
    toast('Nouvelle quête lancée', '⚔️');
  } catch (e) { console.error(e); alert('Impossible de créer cette tâche pour le moment.'); }
}

window.deleteTask = async function (id) {
  if (!confirm('Supprimer cette tâche ?')) return;
  try { await deleteDoc(doc(db, 'edo_tasks', id)); }
  catch (e) { console.error(e); alert('Impossible de supprimer cette tâche pour le moment.'); }
};

async function moveTask(id, newStatus) {
  try {
    await updateDoc(doc(db, 'edo_tasks', id), { status: newStatus });
    if (newStatus === 'valide') toast('Quête validée !', '🏆');
  } catch (e) { console.error(e); alert('Impossible de déplacer cette tâche pour le moment.'); }
}

window.handleTaskDragStart = function (evt, id) {
  state.draggedTaskId = id;
  evt.dataTransfer.effectAllowed = 'move';
  try { evt.dataTransfer.setData('text/plain', id); } catch (e) {}
  requestAnimationFrame(() => evt.target.classList.add('dragging'));
};
window.handleTaskDragEnd = function (evt) { evt.target.classList.remove('dragging'); state.draggedTaskId = null; };
window.handleColDragOver = function (evt) { evt.preventDefault(); evt.currentTarget.dataset.dragover = 'true'; };
window.handleColDragLeave = function (evt) { evt.currentTarget.dataset.dragover = 'false'; };
window.handleColDrop = function (evt, status) {
  evt.preventDefault();
  evt.currentTarget.dataset.dragover = 'false';
  const id = state.draggedTaskId || (evt.dataTransfer ? evt.dataTransfer.getData('text/plain') : null);
  if (!id) return;
  const task = state.tasks.find(t => t.id === id);
  if (task && task.status !== status) moveTask(id, status);
};

function initialsOf(name) {
  const parts = (name || '?').trim().split(/\s+/);
  return parts.slice(0, 2).map(p => p[0] ? p[0].toUpperCase() : '').join('') || '?';
}

function taskCardHtml(t) {
  return `
    <div class="kanban-card" draggable="true"
         ondragstart="handleTaskDragStart(event, '${t.id}')" ondragend="handleTaskDragEnd(event)">
      <div class="flex items-start justify-between gap-2">
        <p class="text-sm font-semibold text-white/85 leading-snug">${escapeHtml(t.title || 'Sans titre')}</p>
        <button onclick="deleteTask('${t.id}')" class="text-white/25 hover:text-white/60 text-xs shrink-0" title="Supprimer">✕</button>
      </div>
      <div class="flex items-center gap-2 mt-2.5">
        <span class="w-6 h-6 rounded-full bg-gradient-to-br from-edo-orange to-edo-yellow text-black flex items-center justify-center text-[10px] font-heading font-bold shrink-0">${escapeHtml(initialsOf(t.assignee))}</span>
        <span class="text-xs text-white/45 truncate">${escapeHtml(t.assignee || 'Non assigné')}</span>
      </div>
    </div>`;
}

function renderKanban() {
  TASK_STATUSES.forEach(status => {
    const container = document.getElementById('col-' + status);
    const countEl = document.getElementById('count-' + status);
    if (!container) return;
    const tasks = state.tasks.filter(t => t.status === status);
    countEl.textContent = tasks.length;
    container.innerHTML = tasks.length === 0
      ? `<p class="text-xs text-white/30 text-center py-6">Colonne vide. Le silence avant le buzz.</p>`
      : tasks.map(taskCardHtml).join('');
  });
}

/* ============ BRAND CENTER ============ */
window.copyHex = function (hex) {
  const done = () => toast('Copié : ' + hex, '🎨');
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(hex).then(done).catch(done);
  else done();
};

/* ============ INIT ============ */
function init() {
  const dateField = document.getElementById('f-date');
  if (dateField) dateField.value = toISO(todayDate());
  renderMetricsGrid();
  renderFollowers();
  renderCalendarSuivi();
  renderEditoList();
  renderSwipeGrid();
}
init();
