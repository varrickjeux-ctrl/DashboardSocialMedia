/* ==========================================================================
   FIREBASE — À CONFIGURER AVANT DÉPLOIEMENT
   --------------------------------------------------------------------------
   1. Projet Firebase > Firestore activé > Authentication activé (fournisseur
      "Email/Password") > crée les comptes de ton équipe côté console.
   2. Colle ta config web dans l'objet firebaseConfig juste en dessous.
   3. Règles Firestore (accès réservé aux comptes authentifiés) :

      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /social_posts/{id}    { allow read, write: if request.auth != null; }
          match /edo_editorial/{id}   { allow read, write: if request.auth != null; }
          match /swipe_file/{id}      { allow read, write: if request.auth != null; }
          match /edo_ambassadors/{id} { allow read, write: if request.auth != null; }
          match /edo_tasks/{id}       { allow read, write: if request.auth != null; }
          match /edo_bosses/{id}      { allow read, write: if request.auth != null; }
          match /edo_users/{id}       { allow read, write: if request.auth != null; }
          match /app_settings/{id}    { allow read, write: if request.auth != null; }
        }
      }

   4. Collections : "social_posts", "edo_editorial", "swipe_file",
      "edo_ambassadors", "edo_tasks", "edo_bosses", "edo_users", "app_settings"
      (créées automatiquement au premier enregistrement).
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, setDoc, getDoc, serverTimestamp, increment
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
let currentUser = null;

if (isConfigured) {
  try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
  } catch (e) { console.error("Erreur d'initialisation Firebase :", e); }
} else {
  document.getElementById('config-banner').classList.remove('hidden');
  document.getElementById('login-config-banner').classList.remove('hidden');
  document.getElementById('connection-text').textContent = 'FIREBASE NON CONFIGURÉ';
}

const postsCol = () => collection(db, 'social_posts');
const editoCol = () => collection(db, 'edo_editorial');
const swipeCol = () => collection(db, 'swipe_file');
const ambassadorsCol = () => collection(db, 'edo_ambassadors');
const tasksCol = () => collection(db, 'edo_tasks');
const bossesCol = () => collection(db, 'edo_bosses');
const settingsDoc = () => doc(db, 'app_settings', 'counters');
const userDoc = () => doc(db, 'edo_users', currentUser.uid);

/* ============ THÈME CLAIR / SOMBRE ============ */
window.toggleTheme = function () {
  const html = document.documentElement;
  const nowDark = html.classList.toggle('dark');
  try { localStorage.setItem('edo-theme', nowDark ? 'dark' : 'light'); } catch (e) {}
};

/* ============ CONFIG PLATEFORMES ============ */
const PLATFORM_CONFIG = {
  instagram: { label: 'Instagram', viewsLabel: 'Vues', metricALabel: 'Enregistrements', metricBLabel: 'Partages', color: '#FFA200' },
  linkedin:  { label: 'LinkedIn',  viewsLabel: 'Impressions', metricALabel: 'Reposts', metricBLabel: 'Clics', color: '#8a8a8a' }
};
function platformConfig(p) { return PLATFORM_CONFIG[p] || PLATFORM_CONFIG.instagram; }

const BREADCRUMB = {
  dashboard: { title: 'Dashboard RS', sub: "Le pouls de la communication EDO" },
  arene: { title: 'Arène / Objectifs', sub: 'Configure le Boss et consulte le tableau de chasse' },
  calendrier: { title: 'Calendrier suivi', sub: "Qui a publié quoi, et quand" },
  edito: { title: 'Calendrier édito', sub: "Anticipe la prochaine offensive" },
  idees: { title: "Banque d'idées", sub: "La veille créative de l'équipe" },
  ambassadeurs: { title: 'Ambassadeurs', sub: 'Le classement de la team' },
  taches: { title: 'Quêtes', sub: "Le kanban de l'équipe" },
  brand: { title: 'Brand Center', sub: 'Rester on-brand en toutes circonstances' }
};

const TASK_STATUSES = ['idees', 'afaire', 'encours', 'valide'];
const CHART_METRICS = { views: { label: 'vues' }, likes: { label: 'likes' }, comments: { label: 'commentaires' }, engagement: { label: "taux d'engagement" } };

/* ============ SYSTÈME XP / NIVEAUX / TITRES ============ */
const LEVELS = [
  { level: 1, xp: 0,    title: "Stagiaire de l'ombre" },
  { level: 2, xp: 100,  title: 'Posteur Débutant' },
  { level: 3, xp: 250,  title: 'Chasseur de Reach' },
  { level: 4, xp: 450,  title: 'Stratège Social' },
  { level: 5, xp: 700,  title: 'Maître du Feed' },
  { level: 6, xp: 1000, title: "Architecte d'Engagement" },
  { level: 7, xp: 1400, title: 'Oracle des Algorithmes' },
  { level: 8, xp: 2000, title: "Dompteur d'Algorithme" }
];

function getLevelInfo(xp) {
  xp = Math.max(0, Number(xp) || 0);
  let current = LEVELS[0];
  let next = LEVELS[1] || null;
  for (let i = 0; i < LEVELS.length; i++) {
    if (xp >= LEVELS[i].xp) { current = LEVELS[i]; next = LEVELS[i + 1] || null; }
  }
  const pct = next ? Math.min(100, ((xp - current.xp) / (next.xp - current.xp)) * 100) : 100;
  return { level: current.level, title: current.title, xp, nextXp: next ? next.xp : null, pct };
}

/* ============ BANQUE DE 100 QUÊTES JOURNALIÈRES ============ */
const QUEST_XP_CYCLE = [15, 20, 25, 10, 30];
const QUEST_TEXTS = [
  "Repérer un compte qui te fait rire sur les réseaux", "Prendre 3 photos random pour la banque d'images", "Demander à ton/ta voisin·e de bureau comment il/elle va",
  "S'étirer le dos 2 minutes", "Trouver un meme adaptable à EDO Campus", "Filmer 10 secondes de l'équipe en pleine action",
  "Complimenter sincèrement un·e collègue", "Boire un grand verre d'eau", "Regarder 3 vidéos virales et deviner pourquoi ça marche",
  "Prendre une photo de ton café ou thé du matin", "Proposer un café à quelqu'un de l'équipe", "Marcher 5 minutes dehors",
  "Repérer une chanson qui donnerait envie de danser en reel", "Filmer un time-lapse de 5 secondes de ton bureau", "Raconter une blague à un·e collègue",
  "Respirer profondément pendant 1 minute", "Chercher une tendance qui te fait sourire", "Prendre une photo d'un détail sympa dans les locaux",
  "Envoyer un message sympa à quelqu'un de l'équipe", "Faire 10 squats entre deux tâches", "Suivre un compte qui poste des idées créatives",
  "Immortaliser un moment marrant de la journée en photo", "Complimenter la tenue de quelqu'un aujourd'hui", "Étirer les poignets avant de taper",
  "Trouver un jeu de mots avec « EDO »", "Filmer un·e collègue en pleine action (avec son accord)", "Demander à quelqu'un ce qu'il ou elle a mangé ce midi",
  "Fermer les yeux 30 secondes et ne penser à rien", "Repérer un compte qui poste des memes potables", "Prendre une photo depuis la fenêtre",
  "Proposer d'aller chercher les cafés pour l'équipe", "Étirer les jambes sous le bureau", "Screenshot un post inspirant pour la banque d'idées",
  "Shooter un objet insolite sur ton bureau", "Partager une anecdote marrante avec l'équipe", "Boire un thé ou café en pleine conscience (pas devant l'écran)",
  "Repérer une tendance TikTok à tester un jour", "Prendre un selfie d'équipe improvisé", "Étirer le cou doucement de chaque côté",
  "Écouter une chanson qui te motive", "Complimenter le travail d'un·e collègue à voix haute", "Faire 5 respirations profondes avant une tâche importante",
  "Dessiner un doodle rapide sur un post-it", "Filmer un plan large de l'espace de travail", "Demander à un·e collègue s'il/elle a besoin d'un coup de main",
  "Marcher jusqu'à la machine à café et retour", "Repérer un compte inspirant à montrer à l'équipe", "Prendre une photo d'un moment de pause",
  "Étirer les épaules vers l'arrière 10 secondes", "Trouver une citation drôle à partager avec l'équipe", "Faire une pause de 2 minutes les yeux fermés",
  "Filmer une réaction rigolote d'un·e collègue (avec accord)", "Boire de l'eau (encore, oui c'est important)", "Repérer un format de contenu jamais vu ailleurs",
  "Prendre une photo du chaos ou de l'ordre de ton bureau", "Sourire à quelqu'un que tu croises dans le couloir", "Étirer les avant-bras après avoir écrit",
  "Inventer un nom rigolo pour ton prochain projet", "Filmer 5 secondes d'ambiance sonore du bureau", "Demander à ton/ta voisin·e sa série ou film préféré du moment",
  "Marcher 10 minutes pour changer d'air", "Repérer un post qui a une accroche qui claque, ailleurs", "Prendre une photo d'un sourire dans l'équipe",
  "Étirer les mollets debout 30 secondes", "Complimenter quelqu'un sur son organisation", "Faire une liste de 3 emojis qui résument ta journée",
  "Filmer un objet du quotidien sous un angle original", "Boire un café avec quelqu'un sans parler boulot", "Repérer une musique tendance qui pourrait plaire à l'équipe",
  "Étirer les trapèzes en haussant les épaules", "Prendre une photo d'un coin de bureau que personne ne remarque", "Demander à un·e collègue comment s'est passé son week-end",
  "Faire 3 grands bâillements pour se détendre", "Repérer un visuel qui sort du lot ailleurs", "Filmer un mini « behind the scenes » de 5 secondes",
  "Étirer le bas du dos en position debout", "Complimenter une idée qu'un·e collègue a eue récemment", "Prendre une photo insolite d'un objet du bureau",
  "Noter une gratitude du jour", "Repérer un compte à suivre pour changer d'inspiration", "Marcher jusqu'à la fenêtre et regarder dehors 1 minute",
  "Filmer un clin d'œil rigolo à la caméra", "Étirer les doigts après avoir tapé longtemps", "Demander à quelqu'un un conseil sur un sujet qui n'a rien à voir avec le travail",
  "Prendre une photo groupée improvisée", "Repérer une idée de collab qui pourrait plaire", "Faire une pause thé/café avec un·e collègue",
  "Étirer les chevilles assis 20 secondes", "Filmer une texture ou un détail visuel sympa dans les locaux", "Complimenter sincèrement quelqu'un sur son énergie du jour",
  "Prendre une photo qui capture bien l'ambiance du jour", "Repérer une tendance à contre-courant, juste pour le fun", "Marcher 5 minutes en écoutant un podcast",
  "Étirer les épaules en cercle lentement", "Demander à un·e collègue ce qui l'a fait rire récemment", "Filmer un objet qui roule, tombe ou rebondit (juste pour le fun)",
  "Prendre une photo d'un ciel, d'un arbre, ou de n'importe quoi dehors", "Complimenter le café ou le thé de quelqu'un (oui, vraiment)", "Faire une pause sans téléphone pendant 5 minutes",
  "Repérer un mème qui ferait sourire toute l'équipe"
];

const QUESTS_BANK = QUEST_TEXTS.map((text, i) => ({ id: 'q' + i, text, xp: QUEST_XP_CYCLE[i % QUEST_XP_CYCLE.length] }));

function pickDailyQuests() {
  const pool = [...QUESTS_BANK];
  const picked = [];
  for (let i = 0; i < 3 && pool.length > 0; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    const q = pool.splice(idx, 1)[0];
    picked.push({ id: q.id, text: q.text, xp: q.xp, done: false });
  }
  return picked;
}

/* ============ STATE ============ */
let state = {
  posts: [], editorial: [], swipes: [], ambassadors: [], tasks: [], bosses: [],
  profile: { pseudo: '', xp: 0, dailyQuests: null },
  activeTab: 'dashboard',
  formPlatform: 'instagram',
  editingId: null,
  editoPlatform: 'instagram',
  editoEditingId: null,
  range: { type: '7d', start: null, end: null },
  subview: 'global',
  chartMetric: 'views',
  calendar: { year: null, month: null, selectedDate: null },
  editoCalendar: { year: null, month: null, selectedDate: null },
  followers: { linkedin: 0, instagram: 0 },
  draggedTaskId: null,
  ambassadorSearch: ''
};

let lineChart = null;
let appIsShown = false;

/* ============ TOASTS ============ */
function toast(message, emoji) {
  const stack = document.getElementById('toast-stack');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = 'toast text-sm font-semibold px-4 py-2.5 rounded flex items-center gap-2 font-mono';
  el.innerHTML = `<span>${emoji || '✨'}</span><span>${message}</span>`;
  stack.appendChild(el);
  setTimeout(() => { el.classList.add('toast-out'); setTimeout(() => el.remove(), 300); }, 2200);
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
  submitBtn.textContent = 'CONNEXION…';

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
  if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-email'].includes(code)) return 'Identifiants incorrects. Vérifie ton email et ton mot de passe.';
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

  loading.classList.add('opacity-0'); setTimeout(() => loading.classList.add('hidden'), 300);
  shell.classList.add('opacity-0'); setTimeout(() => shell.classList.add('hidden'), 300);

  login.classList.remove('hidden');
  requestAnimationFrame(() => login.classList.remove('opacity-0'));
  document.getElementById('login-form').reset();
  document.getElementById('login-error').classList.add('hidden');
}

// NOTE : app-shell reste un bloc simple (jamais display:flex) — la sidebar est
// en position fixed, donc main (margin-left) occupe seul toute la largeur
// restante. Ne jamais y ajouter une classe flex, sinon un vide apparaît à droite.
function showApp() {
  const loading = document.getElementById('loading-screen');
  const shell = document.getElementById('app-shell');
  loading.classList.add('opacity-0'); setTimeout(() => loading.classList.add('hidden'), 400);
  shell.classList.remove('hidden');
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
  login.classList.add('opacity-0'); setTimeout(() => login.classList.add('hidden'), 300);

  const loading = document.getElementById('loading-screen');
  const fill = document.getElementById('loading-fill');
  const pct = document.getElementById('loading-pct');
  const phraseEl = document.getElementById('loading-phrase');

  fill.style.width = '0%'; pct.textContent = '0%';
  loading.classList.remove('hidden');
  requestAnimationFrame(() => loading.classList.remove('opacity-0'));

  const totalDuration = 2400;
  const stepEvery = Math.round(totalDuration / LOADING_PHRASES.length);
  let phraseIndex = 0, progress = 0;

  const setPhrase = (i) => {
    phraseEl.classList.remove('phrase-anim'); void phraseEl.offsetWidth; phraseEl.classList.add('phrase-anim');
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
    clearInterval(progressTimer); clearInterval(phraseTimer);
    pct.textContent = '100%'; setPhrase(LOADING_PHRASES.length - 1);
    setTimeout(() => { if (typeof onDone === 'function') onDone(); }, 250);
  }, totalDuration);
}

if (isConfigured && auth) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      if (!appIsShown) runLoadingSequence(() => { showApp(); initListeners(); appIsShown = true; });
    } else {
      currentUser = null;
      appIsShown = false; cleanupListeners(); showLogin();
    }
  });
} else {
  showLogin();
}

/* ============ FIRESTORE LISTENERS ============ */
function cleanupListeners() { unsubscribers.forEach(u => { try { u(); } catch (e) {} }); unsubscribers = []; }

async function ensureUserProfile() {
  try {
    const snap = await getDoc(userDoc());
    if (!snap.exists()) {
      const defaultPseudo = (currentUser.email || 'Joueur').split('@')[0];
      await setDoc(userDoc(), { pseudo: defaultPseudo, xp: 0, dailyQuests: null, createdAt: serverTimestamp() });
    }
  } catch (e) { console.error('Erreur création profil utilisateur :', e); }
}

function initListeners() {
  if (!isConfigured || !db || !currentUser) return;
  cleanupListeners();

  ensureUserProfile();

  try {
    unsubscribers.push(onSnapshot(query(postsCol(), orderBy('date', 'desc')), (snap) => {
      state.posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setConnectionStatus(true);
      renderBossBar();
      if (state.activeTab === 'dashboard') renderDashboard();
      if (state.activeTab === 'calendrier') renderCalendar();
      if (state.activeTab === 'arene') renderBossHistory();
    }, (err) => { console.error('Erreur social_posts :', err); setConnectionStatus(false); }));

    unsubscribers.push(onSnapshot(query(editoCol(), orderBy('date', 'asc')), (snap) => {
      state.editorial = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (state.activeTab === 'edito') renderEdito();
    }, (err) => console.error('Erreur edo_editorial :', err)));

    unsubscribers.push(onSnapshot(query(swipeCol(), orderBy('createdAt', 'desc')), (snap) => {
      state.swipes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      if (state.activeTab === 'idees') renderSwipeGrid();
    }, (err) => console.error('Erreur swipe_file :', err)));

    unsubscribers.push(onSnapshot(query(ambassadorsCol(), orderBy('points', 'desc')), (snap) => {
      state.ambassadors = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderAmbassadors();
    }, (err) => console.error('Erreur edo_ambassadors :', err)));

    unsubscribers.push(onSnapshot(query(tasksCol(), orderBy('createdAt', 'desc')), (snap) => {
      state.tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderKanban();
    }, (err) => console.error('Erreur edo_tasks :', err)));

    unsubscribers.push(onSnapshot(query(bossesCol(), orderBy('__name__', 'desc')), (snap) => {
      state.bosses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderBossBar();
      if (state.activeTab === 'arene') renderBossHistory();
    }, (err) => console.error('Erreur edo_bosses :', err)));

    unsubscribers.push(onSnapshot(settingsDoc(), (snap) => {
      if (snap.exists()) {
        const data = snap.data() || {};
        state.followers.linkedin = data.linkedin || 0;
        state.followers.instagram = data.instagram || 0;
        renderFollowers();
      }
    }, (err) => console.error('Erreur app_settings :', err)));

    unsubscribers.push(onSnapshot(userDoc(), (snap) => {
      if (snap.exists()) {
        state.profile = snap.data() || {};
        renderProfile();
        ensureDailyQuests();
      }
    }, (err) => console.error('Erreur edo_users :', err)));
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
  else { dot.className = 'w-1.5 h-1.5 rounded-full bg-red-400'; text.textContent = 'ERREUR'; }
}

/* ============ PROFIL JOUEUR (XP / NIVEAU / TITRE) ============ */
function renderProfile() {
  const info = getLevelInfo(state.profile.xp || 0);
  const pseudoEl = document.getElementById('profile-pseudo');
  const titleEl = document.getElementById('profile-title');
  const levelEl = document.getElementById('level-label');
  const xpFill = document.getElementById('xp-fill');
  const xpCaption = document.getElementById('xp-caption');

  if (pseudoEl) pseudoEl.textContent = state.profile.pseudo || 'Joueur';
  if (titleEl) titleEl.textContent = info.title;
  if (levelEl) levelEl.textContent = 'NIVEAU ' + info.level;
  if (xpFill) xpFill.style.width = info.pct + '%';
  if (xpCaption) xpCaption.textContent = info.nextXp ? `${info.xp} / ${info.nextXp} XP` : `${info.xp} XP — NIVEAU MAX`;

  const dates = new Set(state.posts.map(p => p.date).filter(Boolean));
  let streak = 0, cursor = todayDate();
  while (dates.has(toISO(cursor))) { streak += 1; cursor = addDays(cursor, -1); }
  const streakLabel = document.getElementById('streak-label');
  if (streakLabel) streakLabel.textContent = '🔥 ' + streak + 'J';
}

async function awardXp(amount) {
  if (!isConfigured || !db || !currentUser) return;
  try {
    await updateDoc(userDoc(), { xp: increment(amount) });
    const xpFill = document.getElementById('xp-fill');
    if (xpFill) {
      xpFill.classList.remove('xp-pulse'); void xpFill.offsetWidth; xpFill.classList.add('xp-pulse');
    }
  } catch (e) { console.error('Erreur attribution XP :', e); }
}

window.toggleProfilePanel = function () {
  const panel = document.getElementById('profile-panel');
  panel.classList.toggle('hidden');
  document.getElementById('f-pseudo').value = state.profile.pseudo || '';
};

window.savePseudo = async function () {
  const pseudo = (document.getElementById('f-pseudo').value || '').trim().slice(0, 24);
  if (!pseudo || !currentUser) return;
  try {
    await updateDoc(userDoc(), { pseudo });
    document.getElementById('profile-panel').classList.add('hidden');
    toast('Pseudo mis à jour', '🪪');
  } catch (e) { console.error(e); alert('Impossible de mettre à jour le pseudo pour le moment.'); }
};

/* ============ QUÊTES JOURNALIÈRES ============ */
function ensureDailyQuests() {
  const today = toISO(todayDate());
  const current = state.profile.dailyQuests;
  if (current && current.date === today && Array.isArray(current.quests)) {
    renderDailyQuests();
    return;
  }
  const quests = pickDailyQuests();
  updateDoc(userDoc(), { dailyQuests: { date: today, quests } }).catch(e => console.error('Erreur init quêtes du jour :', e));
}

function renderDailyQuests() {
  const list = document.getElementById('daily-quests-list');
  const dateLabel = document.getElementById('daily-date-label');
  if (!list) return;
  const dq = state.profile.dailyQuests;
  if (dateLabel) dateLabel.textContent = dq ? dq.date : '';
  if (!dq || !Array.isArray(dq.quests)) { list.innerHTML = ''; return; }

  list.innerHTML = dq.quests.map((q, i) => `
    <div class="quest-row" data-done="${!!q.done}">
      <button class="quest-check" data-done="${!!q.done}" onclick="completeQuest(${i})" ${q.done ? 'disabled' : ''}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>
      </button>
      <p class="text-sm flex-1 ${q.done ? 'line-through' : ''}">${escapeHtml(q.text)}</p>
      <span class="quest-xp">+${q.xp} XP</span>
    </div>
  `).join('');
}

window.completeQuest = async function (index) {
  const dq = state.profile.dailyQuests;
  if (!dq || !dq.quests || !dq.quests[index] || dq.quests[index].done) return;
  const quest = dq.quests[index];
  const updatedQuests = dq.quests.map((q, i) => i === index ? { ...q, done: true } : q);

  try {
    await updateDoc(userDoc(), { dailyQuests: { date: dq.date, quests: updatedQuests }, xp: increment(quest.xp) });
    toast(`+${quest.xp} XP — quête accomplie`, '✅');
    const xpFill = document.getElementById('xp-fill');
    if (xpFill) { xpFill.classList.remove('xp-pulse'); void xpFill.offsetWidth; xpFill.classList.add('xp-pulse'); }
  } catch (e) { console.error(e); alert('Impossible de valider cette quête pour le moment.'); }
};

/* ============ BOSS FIGHT ============ */
function currentMonthId(d) { d = d || todayDate(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function monthLabelFromId(id) {
  const [y, m] = id.split('-').map(Number);
  const names = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
  return names[m - 1] + ' ' + y;
}
function achievedViewsForMonth(monthId) {
  const [y, m] = monthId.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const endDate = new Date(y, m, 0);
  const end = toISO(endDate);
  return state.posts.filter(p => p.date && p.date >= start && p.date <= end).reduce((s, p) => s + num(p.views), 0);
}

function renderBossBar() {
  const monthId = currentMonthId();
  const bossDoc = state.bosses.find(b => b.id === monthId);
  const nameEl = document.getElementById('boss-name');
  const labelEl = document.getElementById('boss-hp-label');
  const fillEl = document.getElementById('boss-hp-fill');
  if (!nameEl || !labelEl || !fillEl) return;

  nameEl.textContent = 'BOSS DE ' + monthLabelFromId(monthId).toUpperCase();

  if (!bossDoc || !bossDoc.targetViews) {
    labelEl.textContent = 'Non configuré';
    fillEl.style.width = '0%';
    fillEl.dataset.defeated = 'false';
    return;
  }

  const target = num(bossDoc.targetViews);
  const achieved = achievedViewsForMonth(monthId);
  const remaining = Math.max(0, target - achieved);
  const pctDamage = target > 0 ? Math.min(100, (achieved / target) * 100) : 0;

  labelEl.textContent = `${formatNumber(remaining)} PV restants / ${formatNumber(target)}`;
  fillEl.style.width = (100 - pctDamage) + '%';

  const wasDefeated = !!bossDoc.defeated;
  const isDefeatedNow = achieved >= target && target > 0;
  fillEl.dataset.defeated = String(isDefeatedNow);

  if (isDefeatedNow && !wasDefeated) {
    updateDoc(doc(db, 'edo_bosses', monthId), { defeated: true, defeatedAt: serverTimestamp() })
      .then(() => { toast('👹 BOSS VAINCU ! +200 XP bonus', '🏆'); awardXp(200); })
      .catch(e => console.error('Erreur mise à jour Boss :', e));
  }
}

document.getElementById('boss-form') && document.getElementById('boss-form').addEventListener('submit', handleBossSubmit);

async function handleBossSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert('Configure Firebase avant de paramétrer le Boss.'); return; }
  const target = Number(document.getElementById('boss-target').value) || 0;
  if (target <= 0) { alert('Merci de saisir un objectif de vues valide.'); return; }
  const monthId = currentMonthId();
  try {
    await setDoc(doc(db, 'edo_bosses', monthId), { targetViews: target, defeated: false }, { merge: true });
    toast('Boss du mois mis à jour', '👹');
    evt.target.reset();
  } catch (e) { console.error(e); alert('Impossible de mettre à jour le Boss pour le moment.'); }
}

function renderBossHistory() {
  const tbody = document.getElementById('boss-history-body');
  const empty = document.getElementById('boss-history-empty');
  if (!tbody) return;
  const sorted = [...state.bosses].sort((a, b) => b.id.localeCompare(a.id));

  if (sorted.length === 0) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  tbody.innerHTML = sorted.map(b => {
    const achieved = achievedViewsForMonth(b.id);
    const target = num(b.targetViews);
    const won = target > 0 && achieved >= target;
    return `
      <tr>
        <td>${monthLabelFromId(b.id)}</td>
        <td class="font-mono">${formatNumber(target)}</td>
        <td class="font-mono">${formatNumber(achieved)}</td>
        <td class="font-semibold ${won ? 'text-emerald-500' : 'opacity-60'}">${won ? '✅ Vaincu' : '💀 Survécu'}</td>
      </tr>`;
  }).join('');
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
  ['dashboard', 'arene', 'calendrier', 'edito', 'idees', 'ambassadeurs', 'taches', 'brand'].forEach(t => {
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
  if (tab === 'arene') renderBossHistory();
  if (tab === 'calendrier') renderCalendar();
  if (tab === 'edito') renderEdito();
  if (tab === 'idees') renderSwipeGrid();
  if (tab === 'taches') renderKanban();
  if (tab === 'ambassadeurs') renderAmbassadors();
};

window.toggleMoreSheet = function () {
  document.getElementById('more-sheet').classList.toggle('hidden');
  document.getElementById('more-sheet-backdrop').classList.toggle('hidden');
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
  } catch (e) { console.error(e); alert("Impossible d'enregistrer les compteurs pour le moment."); }
};

function renderFollowers() {
  const l = document.getElementById('followers-linkedin');
  const i = document.getElementById('followers-instagram');
  if (l) l.textContent = new Intl.NumberFormat('fr-FR').format(state.followers.linkedin || 0);
  if (i) i.textContent = new Intl.NumberFormat('fr-FR').format(state.followers.instagram || 0);
}

/* ============ FORM POSTS (Dashboard RS) ============ */
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
    <div><label class="hud-label">${cfg.viewsLabel}</label><input required type="number" min="0" id="f-views" value="${v.views ?? ''}" class="hud-input w-full" /></div>
    <div><label class="hud-label">Likes</label><input required type="number" min="0" id="f-likes" value="${v.likes ?? ''}" class="hud-input w-full" /></div>
    <div><label class="hud-label">Commentaires</label><input required type="number" min="0" id="f-comments" value="${v.comments ?? ''}" class="hud-input w-full" /></div>
    <div><label class="hud-label">${cfg.metricALabel}</label><input required type="number" min="0" id="f-metricA" value="${v.metricA ?? ''}" class="hud-input w-full" /></div>
    <div><label class="hud-label">${cfg.metricBLabel}</label><input required type="number" min="0" id="f-metricB" value="${v.metricB ?? ''}" class="hud-input w-full" /></div>
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
      awardXp(50);
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
  a.href = url; a.download = `edo-social-posts-${toISO(todayDate())}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
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
  const cfg = platformConfig(platform);
  const isInsta = platform === 'instagram';
  return `<span class="inline-flex items-center gap-1.5 text-[11px] font-mono font-semibold px-2 py-1 rounded ${isInsta ? 'bg-edo-orange/15 text-edo-orange' : 'bg-current/10'}">${cfg.label.toUpperCase()}</span>`;
}

/* ============ DATE HELPERS ============ */
function toISO(d) { return d.toISOString().slice(0, 10); }
function addDays(d, days) { const nd = new Date(d); nd.setDate(nd.getDate() + days); return nd; }
function todayDate() { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }

function computeRangeDates() {
  const today = todayDate();
  if (state.range.type === '7d') return { start: toISO(addDays(today, -6)), end: toISO(today) };
  if (state.range.type === '30d') return { start: toISO(addDays(today, -29)), end: toISO(today) };
  return { start: state.range.start, end: state.range.end };
}
function computePreviousRangeDates(current) {
  const start = new Date(current.start), end = new Date(current.end);
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
  state.range.start = start; state.range.end = end;
  renderDashboard();
};

window.setSubview = function (subview) {
  state.subview = subview;
  document.querySelectorAll('.subview-btn').forEach(btn => { btn.dataset.active = (btn.dataset.subview === subview); });
  renderDashboard();
};

window.setChartMetric = function (metric) {
  state.chartMetric = metric;
  document.querySelectorAll('.metric-btn').forEach(btn => { btn.dataset.active = (btn.dataset.metric === metric); });
  document.getElementById('chart-title').textContent = 'Évolution des ' + CHART_METRICS[metric].label;
  renderDashboard();
};

function postsInDateRange(range) {
  if (!range.start || !range.end) return [];
  return state.posts.filter(p => p.date && p.date >= range.start && p.date <= range.end);
}
function filterByPlatform(posts, subview) { return subview === 'global' ? posts : posts.filter(p => p.platform === subview); }

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
  if (previous === 0) return current === 0 ? { text: 'Stable vs préc.', cls: 'opacity-40' } : { text: 'Nouveau vs préc.', cls: 'text-edo-orange' };
  const pct = ((current - previous) / previous) * 100;
  return { text: formatPercent(pct) + ' vs préc.', cls: pct >= 0 ? 'text-emerald-500' : 'text-red-500' };
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
  const cur = computeKPIs(currentPosts), prev = computeKPIs(previousPosts);

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
function dailyValue(dayPosts, metric) {
  if (metric === 'engagement') {
    const v = dayPosts.reduce((s, p) => s + num(p.views), 0);
    const inter = dayPosts.reduce((s, p) => s + interactions(p), 0);
    return v > 0 ? (inter / v) * 100 : 0;
  }
  return dayPosts.reduce((s, p) => s + num(p[metric]), 0);
}

function renderLineChart(currentPosts) {
  const canvas = document.getElementById('chart-line');
  if (!canvas) return;
  const dates = [...new Set(currentPosts.map(p => p.date).filter(Boolean))].sort();
  const ctx = canvas.getContext('2d');
  if (lineChart) { lineChart.destroy(); lineChart = null; }
  if (dates.length === 0) return;

  const isDark = document.documentElement.classList.contains('dark');
  const gridColor = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  const tickColor = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.45)';
  const neutralLine = isDark ? '#FFFFFF' : '#333333';

  const metric = state.chartMetric;
  let datasets;
  if (state.subview === 'global') {
    datasets = [
      { label: 'Instagram', data: dates.map(d => dailyValue(currentPosts.filter(p => p.date === d && p.platform === 'instagram'), metric)), borderColor: '#FFA200', backgroundColor: 'rgba(255,162,0,0.12)', fill: true, tension: 0.3, pointRadius: 3 },
      { label: 'LinkedIn', data: dates.map(d => dailyValue(currentPosts.filter(p => p.date === d && p.platform === 'linkedin'), metric)), borderColor: neutralLine, backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', fill: true, tension: 0.3, pointRadius: 3 }
    ];
  } else {
    const cfg = platformConfig(state.subview);
    const isInsta = state.subview === 'instagram';
    datasets = [{ label: cfg.label, data: dates.map(d => dailyValue(currentPosts.filter(p => p.date === d), metric)), borderColor: isInsta ? '#FFA200' : neutralLine, backgroundColor: isInsta ? 'rgba(255,162,0,0.12)' : (isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)'), fill: true, tension: 0.3, pointRadius: 3 }];
  }

  try {
    lineChart = new Chart(ctx, {
      type: 'line',
      data: { labels: dates, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, font: { family: 'Inter', size: 11 }, color: tickColor } } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 }, color: tickColor } },
          y: { grid: { color: gridColor }, ticks: { font: { size: 10 }, color: tickColor } }
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
  if (top3.length === 0) { el.innerHTML = '<p class="text-xs opacity-30">Pas assez de données sur cette période.</p>'; return; }
  el.innerHTML = top3.map((p, i) => `
    <li class="flex items-center gap-3">
      <span class="w-6 h-6 rounded flex items-center justify-center text-[11px] font-bold shrink-0 ${i === 0 ? 'bg-gradient-to-br from-edo-orange to-edo-yellow text-black' : 'bg-current/10 opacity-60'}">${i + 1}</span>
      <div class="min-w-0 flex-1">
        <p class="text-sm truncate">${escapeHtml(p.title || 'Sans titre')}</p>
        <p class="text-[11px] opacity-40 font-mono">${platformConfig(p.platform).label} · ${escapeHtml(p.date || '—')}</p>
      </div>
      <span class="text-sm font-heading font-bold shrink-0">${formatFn(valueFn(p))}</span>
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
      <td class="font-mono">${formatNumber(p.views)}</td>
      <td class="font-mono">${formatNumber(interactions(p))}</td>
      <td class="font-mono font-semibold text-edo-orange">${engagementRate(p).toFixed(1)} %</td>
      <td class="whitespace-nowrap">
        <button onclick="editPost('${p.id}')" class="text-edo-orange hover:underline text-xs font-semibold mr-3">Modifier</button>
        <button onclick="deletePost('${p.id}')" class="opacity-30 hover:opacity-70 text-xs">Supprimer</button>
      </td>
    </tr>`).join('');
  replay('dashboard-table-wrapper');
}

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
  let m = state.calendar.month + delta, y = state.calendar.year;
  if (m < 0) { m = 11; y -= 1; } if (m > 11) { m = 0; y += 1; }
  state.calendar.month = m; state.calendar.year = y; state.calendar.selectedDate = null;
  renderCalendar();
};

const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];

function renderCalendar() {
  if (state.calendar.year === null) {
    const today = todayDate();
    state.calendar.year = today.getFullYear(); state.calendar.month = today.getMonth();
  }
  const { year, month } = state.calendar;
  const label = document.getElementById('cal-month-label');
  if (label) label.textContent = MONTH_NAMES[month] + ' ' + year;

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadOffset = (firstOfMonth.getDay() + 6) % 7;

  const cells = [];
  for (let i = 0; i < leadOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const grid = document.getElementById('cal-grid');
  if (!grid) return;

  grid.innerHTML = cells.map(d => {
    if (d === null) return `<div class="cal-cell"></div>`;
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayPosts = state.posts.filter(p => p.date === iso);
    const hasPost = dayPosts.length > 0;
    const selected = state.calendar.selectedDate === iso;
    const dots = dayPosts.slice(0, 6).map(p => `<span class="cal-dot ${p.platform === 'instagram' ? 'bg-edo-orange' : 'cal-dot-neutral'}" title="${escapeHtml(p.title || '')}"></span>`).join('');
    return `
      <div class="cal-cell" data-has-post="${hasPost}" data-selected="${selected}" onclick="${hasPost ? `selectCalDay('${iso}')` : ''}">
        <span class="cal-day-num">${d}</span>
        <div class="flex flex-wrap gap-1">${dots}</div>
      </div>`;
  }).join('');

  replay('cal-wrapper');
  if (state.calendar.selectedDate) renderCalDayPanel(state.calendar.selectedDate);
}

window.selectCalDay = function (iso) {
  state.calendar.selectedDate = (state.calendar.selectedDate === iso) ? null : iso;
  renderCalendar();
  if (state.calendar.selectedDate) renderCalDayPanel(state.calendar.selectedDate);
  else document.getElementById('cal-day-panel').classList.add('hidden');
};

function renderCalDayPanel(iso) {
  const panel = document.getElementById('cal-day-panel');
  const dayPosts = state.posts.filter(p => p.date === iso);
  panel.classList.remove('hidden');
  document.getElementById('cal-day-title').textContent = 'Publications du ' + iso;
  document.getElementById('cal-day-posts').innerHTML = dayPosts.map(p => `
    <div class="flex items-center justify-between border rounded px-3 py-2 gap-3" style="border-color:var(--table-border)">
      <div class="flex items-center gap-2 min-w-0">${platformBadge(p.platform)}<p class="text-sm truncate">${escapeHtml(p.title || 'Sans titre')}</p></div>
      <span class="text-xs opacity-50 font-mono shrink-0">${formatNumber(p.views)} vues · ${engagementRate(p).toFixed(1)} %</span>
    </div>`).join('');
}

/* ============ CALENDRIER ÉDITO ============ */
window.toggleEditoForm = function () { document.getElementById('edito-form').classList.toggle('hidden'); };

window.setEditoPlatform = function (platform) {
  state.editoPlatform = platform;
  document.getElementById('e-btn-instagram').dataset.active = (platform === 'instagram');
  document.getElementById('e-btn-linkedin').dataset.active = (platform === 'linkedin');
};

document.getElementById('edito-form') && document.getElementById('edito-form').addEventListener('submit', handleEditoSubmit);

async function handleEditoSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert('Configure Firebase avant de planifier un post.'); return; }

  const payload = {
    date: document.getElementById('e-date').value,
    platform: state.editoPlatform,
    subject: (document.getElementById('e-subject').value || '').trim(),
    description: (document.getElementById('e-description').value || '').trim()
  };

  try {
    if (state.editoEditingId) {
      await updateDoc(doc(db, 'edo_editorial', state.editoEditingId), payload);
      toast('Planification mise à jour', '✏️');
      cancelEditoEdit();
    } else {
      await addDoc(editoCol(), { ...payload, done: false, createdAt: serverTimestamp() });
      toast('Post planifié', '🗓️');
      evt.target.reset();
      document.getElementById('e-date').value = '';
      setEditoPlatform('instagram');
      document.getElementById('edito-form').classList.add('hidden');
    }
  } catch (e) { console.error(e); alert('Impossible de planifier ce post pour le moment.'); }
}

window.editEditoItem = function (id) {
  const item = state.editorial.find(e => e.id === id);
  if (!item) return;
  state.editoEditingId = id;
  document.getElementById('edito-form').classList.remove('hidden');
  document.getElementById('edito-submit-btn').textContent = 'ENREGISTRER';
  document.getElementById('edito-cancel-btn').classList.remove('hidden');
  document.getElementById('e-date').value = item.date || '';
  document.getElementById('e-subject').value = item.subject || '';
  document.getElementById('e-description').value = item.description || '';
  setEditoPlatform(item.platform || 'instagram');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.cancelEditoEdit = function () {
  state.editoEditingId = null;
  document.getElementById('edito-submit-btn').textContent = 'PLANIFIER';
  document.getElementById('edito-cancel-btn').classList.add('hidden');
  document.getElementById('edito-form').reset();
  document.getElementById('e-date').value = '';
  setEditoPlatform('instagram');
};

window.toggleEditoDone = async function (id, current) {
  try { await updateDoc(doc(db, 'edo_editorial', id), { done: !current }); }
  catch (e) { console.error(e); alert('Impossible de mettre à jour ce statut pour le moment.'); }
};

window.deleteEditoItem = async function (id) {
  if (!confirm('Supprimer cette publication planifiée ?')) return;
  try { await deleteDoc(doc(db, 'edo_editorial', id)); }
  catch (e) { console.error(e); alert('Impossible de supprimer cet élément pour le moment.'); }
};

window.shiftEditoMonth = function (delta) {
  let m = state.editoCalendar.month + delta, y = state.editoCalendar.year;
  if (m < 0) { m = 11; y -= 1; } if (m > 11) { m = 0; y += 1; }
  state.editoCalendar.month = m; state.editoCalendar.year = y; state.editoCalendar.selectedDate = null;
  const panel = document.getElementById('edito-cal-day-panel');
  if (panel) panel.classList.add('hidden');
  renderEditoCalendar();
};

function editoDotClass(item) {
  if (item.done) return 'cal-dot-done';
  return item.platform === 'instagram' ? 'bg-edo-orange' : 'cal-dot-neutral';
}

function renderEditoCalendar() {
  if (state.editoCalendar.year === null) {
    const today = todayDate();
    state.editoCalendar.year = today.getFullYear(); state.editoCalendar.month = today.getMonth();
  }
  const { year, month } = state.editoCalendar;
  const label = document.getElementById('edito-cal-month-label');
  if (label) label.textContent = MONTH_NAMES[month] + ' ' + year;

  const firstOfMonth = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leadOffset = (firstOfMonth.getDay() + 6) % 7;

  const cells = [];
  for (let i = 0; i < leadOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const grid = document.getElementById('edito-cal-grid');
  if (!grid) return;

  grid.innerHTML = cells.map(d => {
    if (d === null) return `<div class="cal-cell"></div>`;
    const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayItems = state.editorial.filter(e => e.date === iso);
    const hasItems = dayItems.length > 0;
    const selected = state.editoCalendar.selectedDate === iso;
    const dots = dayItems.slice(0, 6).map(item => `<span class="cal-dot ${editoDotClass(item)}" title="${escapeHtml(item.subject || '')}"></span>`).join('');
    return `
      <div class="cal-cell" data-has-post="${hasItems}" data-selected="${selected}" onclick="${hasItems ? `selectEditoCalDay('${iso}')` : ''}">
        <span class="cal-day-num">${d}</span>
        <div class="flex flex-wrap gap-1">${dots}</div>
      </div>`;
  }).join('');

  replay('edito-cal-wrapper');
  if (state.editoCalendar.selectedDate) renderEditoCalDayPanel(state.editoCalendar.selectedDate);
}

window.selectEditoCalDay = function (iso) {
  state.editoCalendar.selectedDate = (state.editoCalendar.selectedDate === iso) ? null : iso;
  renderEditoCalendar();
  if (state.editoCalendar.selectedDate) renderEditoCalDayPanel(state.editoCalendar.selectedDate);
  else document.getElementById('edito-cal-day-panel').classList.add('hidden');
};

function renderEditoCalDayPanel(iso) {
  const panel = document.getElementById('edito-cal-day-panel');
  const dayItems = state.editorial.filter(e => e.date === iso);
  panel.classList.remove('hidden');
  document.getElementById('edito-cal-day-title').textContent = 'Planifié le ' + iso;
  document.getElementById('edito-cal-day-posts').innerHTML = dayItems.map(item => `
    <div class="flex items-center justify-between border rounded px-3 py-2 gap-3" style="border-color:var(--table-border)">
      <div class="flex items-center gap-2 min-w-0">${platformBadge(item.platform)}<p class="text-sm truncate">${escapeHtml(item.subject || 'Sans sujet')}</p></div>
      <button class="edito-done-btn shrink-0" data-done="${!!item.done}" onclick="toggleEditoDone('${item.id}', ${!!item.done})">${item.done ? '✅ FAIT' : '⏳ À FAIRE'}</button>
    </div>`).join('');
}

function renderEdito() {
  const list = document.getElementById('edito-list');
  const empty = document.getElementById('edito-empty');
  renderEditoCalendar();
  if (!list) return;
  const sorted = [...state.editorial].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  if (sorted.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  list.innerHTML = sorted.map(item => `
    <div class="edito-row p-4" data-done="${!!item.done}">
      <div class="flex items-start gap-4 flex-wrap">
        <div class="font-mono text-xs opacity-50 shrink-0 pt-0.5">${escapeHtml(item.date || '—')}</div>
        ${platformBadge(item.platform)}
        <div class="min-w-0 flex-1">
          <p class="text-sm font-semibold">${escapeHtml(item.subject || 'Sans sujet')}</p>
          ${item.description ? `<p class="text-xs opacity-50 mt-1 leading-relaxed">${escapeHtml(item.description)}</p>` : ''}
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <button class="edito-done-btn" data-done="${!!item.done}" onclick="toggleEditoDone('${item.id}', ${!!item.done})">${item.done ? '✅ FAIT' : '⏳ À FAIRE'}</button>
          <button onclick="editEditoItem('${item.id}')" class="text-edo-orange hover:underline text-xs font-semibold">Modifier</button>
          <button onclick="deleteEditoItem('${item.id}')" class="opacity-30 hover:opacity-70 text-xs">✕</button>
        </div>
      </div>
    </div>`).join('');
}

/* ============ BANQUE D'IDÉES (swipe file) ============ */
document.getElementById('swipe-form') && document.getElementById('swipe-form').addEventListener('submit', handleSwipeSubmit);

async function handleSwipeSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert("Configure Firebase avant d'ajouter une idée."); return; }
  const url = (document.getElementById('f-swipe-url').value || '').trim();
  const note = (document.getElementById('f-swipe-note').value || '').trim();
  try {
    await addDoc(swipeCol(), { url, note, createdAt: serverTimestamp() });
    evt.target.reset();
    toast('Idée ajoutée à la veille', '💡');
  } catch (e) { console.error(e); alert("Impossible d'enregistrer cette idée pour le moment."); }
}

window.deleteSwipe = async function (id) {
  if (!confirm('Supprimer cette idée de la veille ?')) return;
  try { await deleteDoc(doc(db, 'swipe_file', id)); }
  catch (e) { console.error(e); alert("Impossible de supprimer cette idée pour le moment."); }
};

function renderSwipeGrid() {
  const grid = document.getElementById('swipe-grid');
  const empty = document.getElementById('swipe-empty');
  if (!grid) return;

  if (state.swipes.length === 0) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  grid.innerHTML = state.swipes.map(s => {
    const dateLabel = s.createdAt && typeof s.createdAt.toDate === 'function' ? s.createdAt.toDate().toLocaleDateString('fr-FR') : '';
    let host = s.url || '';
    try { host = new URL(s.url).hostname.replace('www.', ''); } catch (e) {}
    return `
      <div class="hud-panel p-4 flex flex-col gap-2">
        <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" class="text-sm font-semibold text-edo-orange hover:underline truncate">${escapeHtml(host)}</a>
        <p class="text-sm opacity-70 leading-snug">${escapeHtml(s.note)}</p>
        <div class="flex items-center justify-between mt-1">
          <span class="text-[11px] opacity-35 font-mono">${dateLabel}</span>
          <button onclick="deleteSwipe('${s.id}')" class="text-[11px] opacity-30 hover:opacity-70">Supprimer</button>
        </div>
      </div>`;
  }).join('');
  replay('swipe-grid');
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
    toast('Nouvel ambassadeur recruté', '🎉');
  } catch (e) { console.error(e); alert("Impossible d'ajouter cet ambassadeur pour le moment."); }
}

window.addAmbassadorPoints = async function (id, amount) {
  if (!isConfigured || !db) return;
  try { await updateDoc(doc(db, 'edo_ambassadors', id), { points: increment(amount) }); toast('+' + amount + ' points', '⭐'); }
  catch (e) { console.error(e); alert("Impossible d'ajouter les points pour le moment."); }
};

window.deleteAmbassador = async function (id) {
  if (!confirm('Retirer cet ambassadeur du classement ?')) return;
  try { await deleteDoc(doc(db, 'edo_ambassadors', id)); }
  catch (e) { console.error(e); alert("Impossible de supprimer cet ambassadeur pour le moment."); }
};

function medalFor(rank) { return rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : '#' + (rank + 1); }

window.exportAmbassadorsCSV = function () {
  if (state.ambassadors.length === 0) { alert('Aucun ambassadeur à exporter pour le moment.'); return; }
  const headers = ['Prénom', 'Nom', 'Email', 'Téléphone', 'Points'];
  const rows = [...state.ambassadors]
    .sort((a, b) => num(b.points) - num(a.points))
    .map(a => [a.firstname || '', a.lastname || '', a.email || '', a.phone || '', num(a.points)]);
  const csvEscape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(row => row.map(csvEscape).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `edo-ambassadeurs-${toISO(todayDate())}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Export Excel téléchargé', '⬇️');
};

window.renderAmbassadors = function () {
  const list = document.getElementById('ambassador-list');
  const empty = document.getElementById('ambassador-empty');
  if (!list) return;

  const searchInput = document.getElementById('amb-search');
  const search = (searchInput ? searchInput.value : '').trim().toLowerCase();

  let sorted = [...state.ambassadors].sort((a, b) => num(b.points) - num(a.points));
  const filtered = search
    ? sorted.filter(a => `${a.firstname || ''} ${a.lastname || ''}`.toLowerCase().includes(search))
    : sorted;

  if (state.ambassadors.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  if (filtered.length === 0) {
    list.innerHTML = `<p class="text-sm opacity-40 text-center py-8">Aucun ambassadeur ne correspond à « ${escapeHtml(search)} ».</p>`;
    return;
  }

  list.innerHTML = filtered.map((a) => {
    const rank = sorted.indexOf(a);
    const rankClass = rank === 0 ? 'amb-rank-1' : rank === 1 ? 'amb-rank-2' : rank === 2 ? 'amb-rank-3' : '';
    return `
    <div class="amb-row px-4 sm:px-5 py-4 flex flex-wrap items-center gap-4 ${rankClass}">
      <span class="font-heading font-black text-xl w-10 text-center shrink-0">${medalFor(rank)}</span>
      <div class="w-10 h-10 rounded bg-current/10 flex items-center justify-center font-heading font-bold text-xs shrink-0 border" style="border-color:var(--table-border)">${escapeHtml(((a.firstname || '?')[0] || '') + ((a.lastname || '')[0] || ''))}</div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold truncate">${escapeHtml(a.firstname || '')} ${escapeHtml(a.lastname || '')}</p>
        <p class="text-[11px] opacity-40 font-mono truncate">${escapeHtml(a.email || '')}${a.phone ? ' · ' + escapeHtml(a.phone) : ''}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="font-heading font-extrabold text-lg text-edo-orange">${formatNumber(a.points)}</span>
        <span class="text-[11px] opacity-40 font-mono">PTS</span>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button onclick="addAmbassadorPoints('${a.id}', 5)" class="hud-btn-ghost !px-2.5 !py-1.5 text-xs">+5</button>
        <button onclick="addAmbassadorPoints('${a.id}', 10)" class="hud-btn-ghost !px-2.5 !py-1.5 text-xs">+10</button>
        <button onclick="addAmbassadorPoints('${a.id}', 25)" class="hud-btn-primary !px-2.5 !py-1.5 text-xs">+25</button>
        <button onclick="deleteAmbassador('${a.id}')" class="px-2 py-1.5 text-xs opacity-30 hover:opacity-70" title="Retirer">✕</button>
      </div>
    </div>`;
  }).join('');
};

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
    <div class="kanban-card" draggable="true" ondragstart="handleTaskDragStart(event, '${t.id}')" ondragend="handleTaskDragEnd(event)">
      <div class="flex items-start justify-between gap-2">
        <p class="text-sm font-semibold leading-snug">${escapeHtml(t.title || 'Sans titre')}</p>
        <button onclick="deleteTask('${t.id}')" class="opacity-30 hover:opacity-70 text-xs shrink-0" title="Supprimer">✕</button>
      </div>
      <div class="flex items-center gap-2 mt-2.5">
        <span class="w-6 h-6 rounded-full bg-current/10 flex items-center justify-center text-[10px] font-heading font-bold shrink-0 border" style="border-color:var(--table-border)">${escapeHtml(initialsOf(t.assignee))}</span>
        <span class="text-xs opacity-45 truncate">${escapeHtml(t.assignee || 'Non assigné')}</span>
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
      ? `<p class="text-xs opacity-30 text-center py-6">Colonne vide. Le silence avant le buzz.</p>`
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
}
init();
