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
          match /edo_media/{id}       { allow read, write: if request.auth != null; }
          match /edo_competitors/{id} { allow read, write: if request.auth != null; }
          match /edo_activity/{id}    { allow read, write: if request.auth != null; }
          match /app_settings/{id}    { allow read, write: if request.auth != null; }
        }
      }

   4. Collections : "social_posts", "edo_editorial", "swipe_file",
      "edo_ambassadors", "edo_tasks", "edo_bosses", "edo_users", "app_settings",
      "edo_media", "edo_competitors", "edo_activity"
      (créées automatiquement au premier enregistrement).
      ⚠️ Chaque collection DOIT figurer dans tes règles : une collection absente
      est refusée par Firestore (erreur "permission-denied", désormais affichée
      à l'écran). Les colonnes du kanban sont stockées dans app_settings/taskBoard.

      Raccourci équivalent si tu veux tout couvrir d'un coup :
        match /{document=**} { allow read, write: if request.auth != null; }

      Durcissement optionnel des rôles (admin / member) : dans edo_users/{uid}, le champ
      "role" vaut "admin" ou "member" (absent = admin). Pour que les membres ne puissent
      pas supprimer côté serveur, remplace "allow read, write" des collections sensibles
      (social_posts, edo_ambassadors, edo_bosses…) par :
        allow read, create, update: if request.auth != null;
        allow delete: if request.auth != null
          && get(/databases/$(database)/documents/edo_users/$(request.auth.uid)).data.get('role', 'admin') == 'admin';
      Et interdis qu'un membre modifie son propre rôle sur edo_users/{uid} (comparer
      request.resource.data.role à resource.data.role).
   ========================================================================== */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, query, orderBy, setDoc, getDoc, serverTimestamp, increment, writeBatch, limit, arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getAuth, signInWithEmailAndPassword, onAuthStateChanged, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

/* ⚠️ Complète cet objet avec tes clés Firebase (Console > Paramètres du projet > SDK) */
const firebaseConfig = {
  // apiKey: "",
  // authDomain: "",
  // projectId: "",
  // storageBucket: "",
  // messagingSenderId: "",
  // appId: ""
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
const boardDoc = () => doc(db, 'app_settings', 'taskBoard');
const followersHistoryDoc = () => doc(db, 'app_settings', 'followersHistory');
const rewardsDoc = () => doc(db, 'app_settings', 'rewards');
const challengeDoc = () => doc(db, 'app_settings', 'ambassadorChallenge');
const mediaCol = () => collection(db, 'edo_media');
const competitorsCol = () => collection(db, 'edo_competitors');
const activityCol = () => collection(db, 'edo_activity');
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
  brand: { title: 'Brand Center', sub: 'Rester on-brand en toutes circonstances' },
  equipe: { title: 'Équipe', sub: "Classement d'XP et succès de la guilde" },
  medias: { title: 'Médias & veille', sub: 'Banque d\'images et comptes à surveiller' },
  outils: { title: 'Outils', sub: 'Rapports, sauvegarde, rôles et journal' }
};

/* ---- Kanban : personnes attribuables + colonnes par défaut ---- */
const ASSIGNEES = ['COM', 'CLEM', 'ESTE'];
const DEFAULT_COLUMNS = [
  { id: 'idees',   name: '💡 Idées',    done: false },
  { id: 'afaire',  name: '📝 À faire',  done: false },
  { id: 'encours', name: '🚧 En cours', done: false },
  { id: 'valide',  name: '🏆 Validé',   done: true }
];
function loadTaskSort() { try { return localStorage.getItem('edo-task-sort') || 'recent'; } catch (e) { return 'recent'; } }
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

/* ---- Constantes des fonctionnalités ---- */
const $ = (id) => document.getElementById(id);
const POST_FORMATS = ['Reel', 'Carrousel', 'Story', 'Post simple', 'Vidéo', 'Autre'];
const WEEKDAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
const TIME_SLOTS = [
  { id: 'matin', label: 'Matin (6h–12h)',       from: 6,  to: 12 },
  { id: 'aprem', label: 'Après-midi (12h–18h)', from: 12, to: 18 },
  { id: 'soir',  label: 'Soir (18h–24h)',       from: 18, to: 24 },
  { id: 'nuit',  label: 'Nuit (0h–6h)',         from: 0,  to: 6 }
];
const RECURRENCES = { none: 'Aucune', daily: 'Chaque jour', weekly: 'Chaque semaine', monthly: 'Chaque mois' };
const AMB_TIERS = [
  { min: 0,   name: 'Recrue',  icon: '⚪' },
  { min: 50,  name: 'Bronze',  icon: '🥉' },
  { min: 150, name: 'Argent',  icon: '🥈' },
  { min: 300, name: 'Or',      icon: '🥇' },
  { min: 600, name: 'Platine', icon: '💎' }
];
const BOSS_MILESTONES = [{ pct: 25, xp: 25 }, { pct: 50, xp: 50 }, { pct: 75, xp: 75 }, { pct: 100, xp: 200 }];
const ACHIEVEMENTS = [
  { id: 'first_post',     icon: '🚀', name: 'Premier post',           desc: 'Ajouter ta première publication',           xp: 20,  goal: 1,  value: c => c.p.postsAdded },
  { id: 'posts_10',       icon: '📈', name: 'Machine à posts',         desc: 'Ajouter 10 publications',                   xp: 50,  goal: 10, value: c => c.p.postsAdded },
  { id: 'posts_50',       icon: '👑', name: 'Légende du feed',         desc: 'Ajouter 50 publications',                   xp: 150, goal: 50, value: c => c.p.postsAdded },
  { id: 'streak_7',       icon: '🔥', name: '7 jours de suite',        desc: "Publier 7 jours d'affilée",                 xp: 60,  goal: 7,  value: c => c.streak },
  { id: 'month_10',       icon: '📅', name: '10 posts dans le mois',   desc: '10 publications sur le mois en cours',      xp: 60,  goal: 10, value: c => c.monthPosts },
  { id: 'quests_10',      icon: '✅', name: 'Quêtes du quotidien',     desc: 'Valider 10 quêtes journalières',            xp: 40,  goal: 10, value: c => c.p.questsDone },
  { id: 'quests_50',      icon: '🛡️', name: "Routine d'acier",         desc: 'Valider 50 quêtes journalières',            xp: 120, goal: 50, value: c => c.p.questsDone },
  { id: 'boss_slayer',    icon: '👹', name: 'Tueur de Boss',           desc: 'Vaincre un Boss mensuel',                   xp: 100, goal: 1,  value: c => c.bossWins },
  { id: 'recruiter',      icon: '🤝', name: 'Recruteur',               desc: 'Recruter 5 ambassadeurs',                   xp: 40,  goal: 5,  value: c => c.p.ambRecruited },
  { id: 'task_master',    icon: '🗂️', name: 'Chef de quêtes',          desc: 'Terminer 10 étiquettes du kanban',          xp: 50,  goal: 10, value: c => c.p.tasksDone },
  { id: 'planner',        icon: '🧭', name: 'Planificateur',           desc: 'Planifier 5 posts dans le calendrier édito', xp: 30,  goal: 5,  value: c => c.p.planned },
  { id: 'idea_collector', icon: '💡', name: "Chasseur d'idées",        desc: 'Ajouter 5 idées à la banque',               xp: 30,  goal: 5,  value: c => c.p.ideasAdded }
];

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
  ambassadorSearch: '',
  columns: DEFAULT_COLUMNS.map(c => ({ ...c })),
  selectedTasks: new Set(),
  taskSort: loadTaskSort(),
  modalTaskId: null,
  followersHistory: {},
  users: [], media: [], competitors: [], activity: [],
  rewards: { 25: '', 50: '', 75: '', 100: '' },
  challenge: null,
  taskFilter: 'all',
  ideaFilter: { tag: '', fav: false },
  mediaFilter: { type: 'all' },
  modalChecklist: [],
  profileLoaded: false,
  claiming: new Set(),
  editingCompId: null
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

/* ============ ERREURS FIRESTORE (diagnostic lisible) ============ */
const warnedLabels = new Set();
function reportFirestoreError(label, err) {
  console.error(`Erreur ${label} :`, err);
  if (warnedLabels.has(label)) return;
  warnedLabels.add(label);
  const code = err && err.code ? err.code : 'inconnue';
  if (code === 'permission-denied') toast(`Accès refusé sur « ${label} » — vérifie les règles Firestore`, '🔒');
  else toast(`Erreur sur « ${label} » (${code})`, '⚠️');
}
function explainError(err, fallback) {
  const code = err && err.code ? err.code : '';
  if (code === 'permission-denied') return `${fallback}\n\nFirestore refuse l'accès : ajoute cette collection dans tes règles de sécurité (voir le commentaire en haut de app.js).`;
  return code ? `${fallback}\n(code : ${code})` : fallback;
}
async function runInBatches(ops, size = 400) {
  for (let i = 0; i < ops.length; i += size) {
    const batch = writeBatch(db);
    ops.slice(i, i + size).forEach(op => op(batch));
    await batch.commit();
  }
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

  // Chaque écouteur est indépendant : une erreur sur une collection
  // (ex. règle Firestore manquante) n'empêche plus les autres de démarrer.
  const listen = (label, source, onData) => {
    try {
      unsubscribers.push(onSnapshot(source, onData, (err) => {
        reportFirestoreError(label, err);
        if (label === 'social_posts') setConnectionStatus(false);
      }));
    } catch (e) { reportFirestoreError(label, e); }
  };

  listen('social_posts', query(postsCol(), orderBy('date', 'desc')), (snap) => {
    state.posts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    setConnectionStatus(true);
    renderBossBar();
    renderReminders();
    checkAchievements();
    if (state.activeTab === 'dashboard') renderDashboard();
    if (state.activeTab === 'calendrier') renderCalendar();
    if (state.activeTab === 'arene') renderBossHistory();
    if (state.activeTab === 'equipe') renderTeam();
    if (state.activeTab === 'medias') renderCompetitors();
  });

  listen('edo_editorial', query(editoCol(), orderBy('date', 'asc')), (snap) => {
    state.editorial = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderReminders();
    if (state.activeTab === 'edito') renderEdito();
  });

  listen('swipe_file', query(swipeCol(), orderBy('createdAt', 'desc')), (snap) => {
    state.swipes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.activeTab === 'idees') renderSwipeGrid();
  });

  listen('edo_ambassadors', query(ambassadorsCol(), orderBy('points', 'desc')), (snap) => {
    state.ambassadors = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderAmbassadors();
    renderChallenge();
  });

  listen('edo_tasks', tasksCol(), (snap) => {
    state.tasks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderKanban();
    renderReminders();
  });

  listen('app_settings/taskBoard', boardDoc(), (snap) => {
    const data = snap.exists() ? snap.data() : null;
    state.columns = data && Array.isArray(data.columns) && data.columns.length
      ? data.columns
      : DEFAULT_COLUMNS.map(c => ({ ...c }));
    renderKanban();
    renderReminders();
  });

  listen('edo_bosses', bossesCol(), (snap) => {
    state.bosses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderBossBar();
    if (state.activeTab === 'arene') renderBossHistory();
  });

  listen('app_settings/counters', settingsDoc(), (snap) => {
    if (snap.exists()) {
      const data = snap.data() || {};
      state.followers.linkedin = data.linkedin || 0;
      state.followers.instagram = data.instagram || 0;
      renderFollowers();
      if (state.activeTab === 'medias') renderCompetitors();
    }
  });

  listen('app_settings/followersHistory', followersHistoryDoc(), (snap) => {
    state.followersHistory = snap.exists() ? ((snap.data() || {}).history || {}) : {};
    renderFollowersChart();
    renderReminders();
  });

  listen('app_settings/rewards', rewardsDoc(), (snap) => {
    state.rewards = { 25: '', 50: '', 75: '', 100: '', ...(snap.exists() ? snap.data() : {}) };
    renderRewardsForm();
    renderBossBar();
  });

  listen('app_settings/ambassadorChallenge', challengeDoc(), (snap) => {
    state.challenge = snap.exists() ? snap.data() : null;
    renderChallenge();
  });

  listen('edo_users (équipe)', collection(db, 'edo_users'), (snap) => {
    state.users = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.activeTab === 'equipe') renderTeam();
  });

  listen('edo_media', mediaCol(), (snap) => {
    state.media = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.activeTab === 'medias') renderMedia();
  });

  listen('edo_competitors', competitorsCol(), (snap) => {
    state.competitors = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.activeTab === 'medias') renderCompetitors();
  });

  listen('edo_activity', query(activityCol(), orderBy('at', 'desc'), limit(200)), (snap) => {
    state.activity = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (state.activeTab === 'outils') renderActivity();
  });

  listen('edo_users', userDoc(), (snap) => {
    if (snap.exists()) {
      state.profile = snap.data() || {};
      state.profileLoaded = true;
      renderProfile();
      ensureDailyQuests();
      renderBossBar();
      checkAchievements();
      renderRole();
      if (state.activeTab === 'equipe') renderTeam();
      if (state.activeTab === 'outils') renderActivity();
    }
  });
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

function pulseXpBar() {
  const xpFill = $('xp-fill');
  if (xpFill) { xpFill.classList.remove('xp-pulse'); void xpFill.offsetWidth; xpFill.classList.add('xp-pulse'); }
}
// Ajoute de l'XP et/ou incrémente des compteurs du profil (succès, stats perso)
async function awardXp(amount, counters) {
  if (!isConfigured || !db || !currentUser) return;
  const upd = {};
  if (amount) upd.xp = increment(amount);
  Object.entries(counters || {}).forEach(([k, v]) => { upd[k] = increment(v); });
  if (!Object.keys(upd).length) return;
  try {
    await updateDoc(userDoc(), upd);
    if (amount) pulseXpBar();
  } catch (e) { reportFirestoreError('edo_users', e); }
}
function bumpCounter(name, n) { return awardXp(0, { [name]: n === undefined ? 1 : n }); }

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
    await updateDoc(userDoc(), { dailyQuests: { date: dq.date, quests: updatedQuests }, xp: increment(quest.xp), questsDone: increment(1) });
    toast(`+${quest.xp} XP — quête accomplie`, '✅');
    const xpFill = document.getElementById('xp-fill');
    if (xpFill) { xpFill.classList.remove('xp-pulse'); void xpFill.offsetWidth; xpFill.classList.add('xp-pulse'); }
  } catch (e) { console.error(e); alert('Impossible de valider cette quête pour le moment.'); }
};

/* ============ BOSS FIGHT ============ */
function currentMonthId(d) { d = d || todayDate(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function monthLabelFromId(id) {
  const [y, m] = String(id).split('-').map(Number);
  if (!y || !m) return String(id);
  return MONTH_NAMES[m - 1] + ' ' + y;
}
// Vues des posts saisis pendant le mois (YYYY-MM)
function postViewsForMonth(monthId) {
  const [y, m] = monthId.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2, '0')}-01`;
  const end = toISO(new Date(y, m, 0));
  return state.posts.filter(p => p.date && p.date >= start && p.date <= end).reduce((s, p) => s + num(p.views), 0);
}
// Dégâts totaux = vues des posts + stats manuelles saisies dans l'Arène
function bossStats(monthId, bossDoc) {
  const fromPosts = postViewsForMonth(monthId);
  const manual = num(bossDoc && bossDoc.manualViews);
  const target = num(bossDoc && bossDoc.targetViews);
  const total = fromPosts + manual;
  return { fromPosts, manual, total, target, pct: target > 0 ? (total / target) * 100 : 0 };
}

function renderBossBar() {
  const monthId = currentMonthId();
  const bossDoc = state.bosses.find(b => b.id === monthId);
  const nameEl = $('boss-name');
  const labelEl = $('boss-hp-label');
  const fillEl = $('boss-hp-fill');
  if (!nameEl || !labelEl || !fillEl) return;

  nameEl.textContent = 'BOSS DE ' + monthLabelFromId(monthId).toUpperCase();
  const bar = $('boss-bar');
  if (bar) bar.title = "Palier → récompense d'équipe : " + BOSS_MILESTONES.map(m => `${m.pct} % : ${state.rewards[m.pct] || '—'}`).join(' · ');

  if (!bossDoc || !(num(bossDoc.targetViews) > 0)) {
    labelEl.textContent = 'Aucun objectif ce mois-ci — clique ici pour en définir un';
    fillEl.style.width = '100%';
    fillEl.dataset.state = 'empty';
    return;
  }

  const s = bossStats(monthId, bossDoc);
  const defeated = s.total >= s.target;
  const damage = Math.min(100, s.pct);

  if (defeated) {
    fillEl.style.width = '100%';
    fillEl.dataset.state = 'defeated';
    labelEl.textContent = `BOSS VAINCU 🏆 — ${formatNumber(s.total)} / ${formatNumber(s.target)} vues`;
  } else {
    fillEl.style.width = (100 - damage) + '%';
    fillEl.dataset.state = 'alive';
    const next = BOSS_MILESTONES.find(m => s.pct < m.pct);
    const reward = next && state.rewards[next.pct] ? ` · 🎁 ${state.rewards[next.pct]} à ${next.pct} %` : '';
    labelEl.textContent = `${formatNumber(s.target - s.total)} PV restants / ${formatNumber(s.target)}  ·  ${Math.round(damage)} % de dégâts${reward}`;
  }
  claimBossMilestones(monthId, s);
}

// Chaque joueur touche lui-même l'XP de chaque palier (clé « mois:palier » stockée dans son profil)
function claimBossMilestones(monthId, s) {
  if (!state.profileLoaded || !currentUser || !db) return;
  const claimed = Array.isArray(state.profile.claimed) ? state.profile.claimed : [];
  BOSS_MILESTONES.forEach(m => {
    const key = `${monthId}:${m.pct}`;
    if (s.pct < m.pct || claimed.includes(key) || state.claiming.has(key)) return;
    state.claiming.add(key);
    updateDoc(userDoc(), { claimed: arrayUnion(key), xp: increment(m.xp) })
      .then(() => {
        const reward = state.rewards[m.pct];
        toast(m.pct === 100 ? `👹 BOSS VAINCU ! +${m.xp} XP` : `Palier ${m.pct} % atteint ! +${m.xp} XP`, m.pct === 100 ? '🏆' : '🎯');
        if (reward) toast(`Récompense d'équipe : ${escapeHtml(reward)}`, '🎁');
        pulseXpBar();
      })
      .catch(e => reportFirestoreError('edo_users', e));
  });
}

function renderRewardsForm() {
  [25, 50, 75, 100].forEach(p => {
    const el = $('rw-' + p);
    if (el && document.activeElement !== el) el.value = state.rewards[p] || '';
  });
}
$('rewards-form') && $('rewards-form').addEventListener('submit', async (evt) => {
  evt.preventDefault();
  if (!isConfigured || !db) { alert('Configure Firebase avant de définir les récompenses.'); return; }
  const data = {};
  [25, 50, 75, 100].forEach(p => { data[p] = ($('rw-' + p).value || '').trim().slice(0, 80); });
  try {
    await setDoc(rewardsDoc(), data);
    toast("Récompenses d'équipe enregistrées", '🎁');
    logActivity('Récompenses boss', Object.values(data).filter(Boolean).join(' / '));
  } catch (e) { reportFirestoreError('app_settings', e); alert(explainError(e, 'Impossible d\'enregistrer les récompenses pour le moment.')); }
});

document.getElementById('boss-form') && document.getElementById('boss-form').addEventListener('submit', handleBossSubmit);

async function handleBossSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert('Configure Firebase avant de paramétrer le Boss.'); return; }

  const month = (document.getElementById('boss-month').value || '').trim();
  const target = Number(document.getElementById('boss-target').value) || 0;
  const manualRaw = document.getElementById('boss-manual').value;
  const manual = manualRaw === '' ? 0 : Math.max(0, Number(manualRaw) || 0);

  if (!/^\d{4}-\d{2}$/.test(month)) { alert('Merci de choisir un mois valide (format AAAA-MM).'); return; }
  if (target <= 0) { alert('Merci de saisir un objectif de vues valide (supérieur à 0).'); return; }

  const payload = { targetViews: target, manualViews: manual };
  // Si le nouvel objectif n'est plus atteint, le boss est de nouveau vivant
  if (postViewsForMonth(month) + manual < target) payload.defeated = false;

  const btn = document.getElementById('boss-submit-btn');
  btn.disabled = true;
  try {
    await setDoc(doc(db, 'edo_bosses', month), payload, { merge: true });
    toast(`Boss de ${escapeHtml(monthLabelFromId(month))} enregistré`, '👹');
    resetBossForm();
  } catch (e) {
    reportFirestoreError('edo_bosses', e);
    alert(explainError(e, "Impossible d'enregistrer cet objectif pour le moment."));
  } finally {
    btn.disabled = false;
  }
}

window.resetBossForm = function () {
  const form = document.getElementById('boss-form');
  if (!form) return;
  form.reset();
  document.getElementById('boss-month').value = currentMonthId();
  document.getElementById('boss-submit-btn').textContent = "ENREGISTRER L'OBJECTIF";
  document.getElementById('boss-cancel-btn').classList.add('hidden');
};

window.editBoss = function (id) {
  const b = state.bosses.find(x => x.id === id);
  if (!b) return;
  document.getElementById('boss-month').value = b.id;
  document.getElementById('boss-target').value = num(b.targetViews) || '';
  document.getElementById('boss-manual').value = num(b.manualViews) || '';
  document.getElementById('boss-submit-btn').textContent = 'METTRE À JOUR';
  document.getElementById('boss-cancel-btn').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.deleteBoss = async function (id) {
  if (!requireAdmin('supprimer un objectif')) return;
  if (!confirm(`Supprimer l'objectif de ${monthLabelFromId(id)} ?`)) return;
  try { await deleteDoc(doc(db, 'edo_bosses', id)); toast('Objectif supprimé', '🗑️'); }
  catch (e) { reportFirestoreError('edo_bosses', e); alert(explainError(e, "Impossible de supprimer cet objectif pour le moment.")); }
};

function renderBossHistory() {
  const tbody = document.getElementById('boss-history-body');
  const empty = document.getElementById('boss-history-empty');
  if (!tbody) return;
  const nowId = currentMonthId();
  const sorted = [...state.bosses].sort((a, b) => b.id.localeCompare(a.id));

  if (sorted.length === 0) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  tbody.innerHTML = sorted.map(b => {
    const s = bossStats(b.id, b);
    const won = s.target > 0 && s.total >= s.target;
    let status;
    if (won) status = '<span class="text-emerald-500">✅ Vaincu</span>';
    else if (b.id === nowId) status = '<span class="text-edo-orange">⚔️ En cours</span>';
    else if (b.id > nowId) status = '<span class="opacity-60">⏳ À venir</span>';
    else status = '<span class="opacity-60">💀 Survécu</span>';
    return `
      <tr>
        <td class="whitespace-nowrap">${escapeHtml(monthLabelFromId(b.id))}</td>
        <td class="font-mono">${formatNumber(s.target)}</td>
        <td class="font-mono">${formatNumber(s.fromPosts)}</td>
        <td class="font-mono">${s.manual ? formatNumber(s.manual) : '—'}</td>
        <td class="font-mono font-semibold">${formatNumber(s.total)} <span class="opacity-40 text-[11px]">(${Math.round(s.pct)} %)</span></td>
        <td class="font-semibold whitespace-nowrap">${status}</td>
        <td class="whitespace-nowrap">
          <button onclick="editBoss('${b.id}')" class="text-edo-orange hover:underline text-xs font-semibold mr-3">Modifier</button>
          <button onclick="deleteBoss('${b.id}')" class="opacity-30 hover:opacity-70 text-xs">Supprimer</button>
        </td>
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
  ['dashboard', 'arene', 'calendrier', 'edito', 'idees', 'ambassadeurs', 'taches', 'brand', 'equipe', 'medias', 'outils'].forEach(t => {
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
  if (tab === 'ambassadeurs') { renderAmbassadors(); renderChallenge(); }
  if (tab === 'equipe') renderTeam();
  if (tab === 'medias') { renderMedia(); renderCompetitors(); }
  if (tab === 'outils') { renderActivity(); renderRole(); }
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
  const linkedin = Number($('f-followers-linkedin').value) || 0;
  const instagram = Number($('f-followers-instagram').value) || 0;
  if (!isConfigured || !db) { alert("Configure Firebase avant d'enregistrer les compteurs."); return; }
  try {
    await setDoc(settingsDoc(), { linkedin, instagram }, { merge: true });
    // 1 point par jour : permet de tracer la croissance dans le temps
    await setDoc(followersHistoryDoc(), { history: { [toISO(todayDate())]: { linkedin, instagram } } }, { merge: true });
    $('followers-panel').classList.add('hidden');
    toast('Compteurs enregistrés', '📈');
    logActivity('Compteurs abonnés', `LinkedIn ${linkedin} · Instagram ${instagram}`);
  } catch (e) { reportFirestoreError('app_settings', e); alert(explainError(e, "Impossible d'enregistrer les compteurs pour le moment.")); }
};

function renderFollowers() {
  const l = document.getElementById('followers-linkedin');
  const i = document.getElementById('followers-instagram');
  if (l) l.textContent = new Intl.NumberFormat('fr-FR').format(state.followers.linkedin || 0);
  if (i) i.textContent = new Intl.NumberFormat('fr-FR').format(state.followers.instagram || 0);
}

/* ============ FORM POSTS (Dashboard RS) ============ */
function fillFormatSelects() {
  const opts = '<option value="">— Non précisé</option>' + POST_FORMATS.map(f => `<option value="${f}">${f}</option>`).join('');
  ['f-format', 'e-format'].forEach(id => { const el = $(id); if (el) el.innerHTML = opts; });
}

window.toggleForm = function () {
  const form = $('post-form');
  form.classList.toggle('hidden');
  if (!form.classList.contains('hidden')) window.scrollTo({ top: form.offsetTop - 90, behavior: 'smooth' });
};

window.setPlatform = function (platform) {
  state.formPlatform = platform;
  $('btn-instagram').dataset.active = (platform === 'instagram');
  $('btn-linkedin').dataset.active = (platform === 'linkedin');
  renderMetricsGrid();
};

function renderMetricsGrid(values) {
  const cfg = platformConfig(state.formPlatform);
  const v = values || {};
  $('metrics-grid').innerHTML = `
    <div><label class="hud-label">${cfg.viewsLabel}</label><input required type="number" min="0" id="f-views" value="${v.views ?? ''}" class="hud-input w-full" /></div>
    <div><label class="hud-label">Likes</label><input required type="number" min="0" id="f-likes" value="${v.likes ?? ''}" class="hud-input w-full" /></div>
    <div><label class="hud-label">Commentaires</label><input required type="number" min="0" id="f-comments" value="${v.comments ?? ''}" class="hud-input w-full" /></div>
    <div><label class="hud-label">${cfg.metricALabel}</label><input required type="number" min="0" id="f-metricA" value="${v.metricA ?? ''}" class="hud-input w-full" /></div>
    <div><label class="hud-label">${cfg.metricBLabel}</label><input required type="number" min="0" id="f-metricB" value="${v.metricB ?? ''}" class="hud-input w-full" /></div>
  `;
}

$('post-form') && $('post-form').addEventListener('submit', handleSubmit);

async function handleSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert("Configure Firebase avant d'ajouter des données."); return; }

  const payload = {
    date: $('f-date').value,
    platform: state.formPlatform,
    title: ($('f-title').value || '').trim(),
    format: $('f-format').value || '',
    time: $('f-time').value || '',
    views: Number($('f-views').value) || 0,
    likes: Number($('f-likes').value) || 0,
    comments: Number($('f-comments').value) || 0,
    metricA: Number($('f-metricA').value) || 0,
    metricB: Number($('f-metricB').value) || 0
  };

  const submitBtn = $('submit-btn');
  submitBtn.disabled = true;

  try {
    if (state.editingId) {
      await updateDoc(doc(db, 'social_posts', state.editingId), { ...payload, statsPending: false });
      toast('Publication mise à jour', '✏️');
      logActivity('Post modifié', payload.title);
      cancelEdit();
    } else {
      await addDoc(postsCol(), { ...payload, statsPending: false, uid: currentUser ? currentUser.uid : '', createdAt: serverTimestamp() });
      toast('+50 XP — publication ajoutée', '🎮');
      awardXp(50, { postsAdded: 1 });
      logActivity('Post ajouté', `${payload.title} (${platformConfig(payload.platform).label})`);
      evt.target.reset();
      $('f-date').value = toISO(todayDate());
      setPlatform(state.formPlatform);
      $('post-form').classList.add('hidden');
    }
  } catch (e) {
    reportFirestoreError('social_posts', e);
    alert(explainError(e, "Impossible d'enregistrer cette publication pour le moment. Réessaie."));
  } finally {
    submitBtn.disabled = false;
  }
}

window.editPost = function (id) {
  const post = state.posts.find(p => p.id === id);
  if (!post) return;
  state.editingId = id;
  $('post-form').classList.remove('hidden');
  $('form-title').textContent = 'Modifier une publication';
  $('submit-btn').textContent = 'ENREGISTRER LES MODIFICATIONS';
  $('cancel-edit-btn').classList.remove('hidden');
  $('f-date').value = post.date || '';
  $('f-title').value = post.title || '';
  $('f-format').value = post.format || '';
  $('f-time').value = post.time || '';
  setPlatform(post.platform || 'instagram');
  renderMetricsGrid(post);
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.cancelEdit = function () {
  state.editingId = null;
  $('form-title').textContent = 'Ajouter une publication';
  $('submit-btn').textContent = 'AJOUTER LES PERFORMANCES';
  $('cancel-edit-btn').classList.add('hidden');
  $('post-form').reset();
  $('f-date').value = toISO(todayDate());
  setPlatform('instagram');
};

window.deletePost = async function (id) {
  if (!requireAdmin('supprimer une publication')) return;
  if (!confirm('Supprimer définitivement cette publication ?')) return;
  try { await deleteDoc(doc(db, 'social_posts', id)); toast('Publication supprimée', '🗑️'); logActivity('Post supprimé', id); }
  catch (e) { reportFirestoreError('social_posts', e); alert(explainError(e, 'Impossible de supprimer cette publication pour le moment.')); }
};

/* ============ CSV EXPORT ============ */
window.exportPostsCSV = function () {
  if (state.posts.length === 0) { alert('Aucune donnée à exporter pour le moment.'); return; }
  const headers = ['Date', 'Plateforme', 'Titre', 'Vues', 'Likes', 'Commentaires', 'Metrique_A', 'Metrique_B', 'Interactions', 'Engagement_%', 'Format', 'Heure'];
  const rows = [...state.posts].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(p => [
    p.date || '', platformConfig(p.platform).label, p.title || '', num(p.views), num(p.likes), num(p.comments),
    num(p.metricA), num(p.metricB), interactions(p), engagementRate(p).toFixed(1), p.format || '', p.time || ''
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
// Date locale → "YYYY-MM-DD". (toISOString() convertissait en UTC et décalait
// "aujourd'hui" d'un jour en heure de Paris.)
function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function addDays(d, days) { const nd = new Date(d); nd.setDate(nd.getDate() + days); return nd; }
function todayDate() { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }

function computeRangeDates() {
  const today = todayDate();
  if (state.range.type === '7d') return { start: toISO(addDays(today, -6)), end: toISO(today) };
  if (state.range.type === '30d') return { start: toISO(addDays(today, -29)), end: toISO(today) };
  return { start: state.range.start, end: state.range.end };
}
function computePreviousRangeDates(current) {
  const start = parseISO(current.start), end = parseISO(current.end);
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
  const tbody = $('dashboard-table');
  const empty = $('dashboard-empty');
  if (!tbody) return;
  const sorted = [...posts].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (sorted.length === 0) { tbody.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  tbody.innerHTML = sorted.map(p => `
    <tr>
      <td class="whitespace-nowrap font-mono text-xs">${escapeHtml(p.date || '—')}${p.time ? `<span class="opacity-40"> · ${escapeHtml(p.time)}</span>` : ''}</td>
      <td>${platformBadge(p.platform)}</td>
      <td>${escapeHtml(p.title || 'Sans titre')}
        ${p.format ? `<span class="chip">${escapeHtml(p.format)}</span>` : ''}
        ${p.statsPending ? '<span class="chip chip-warn" title="Publié depuis le calendrier édito : les chiffres restent à saisir">⚠ stats à saisir</span>' : ''}
      </td>
      <td class="font-mono">${formatNumber(p.views)}</td>
      <td class="font-mono">${formatNumber(interactions(p))}</td>
      <td class="font-mono font-semibold text-edo-orange">${engagementRate(p).toFixed(1)} %</td>
      <td class="whitespace-nowrap">
        <button onclick="editPost('${p.id}')" class="text-edo-orange hover:underline text-xs font-semibold mr-3">${p.statsPending ? 'Saisir les stats' : 'Modifier'}</button>
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
  renderAnalytics(currentPosts);
  renderFollowersChart();
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
    date: $('e-date').value,
    platform: state.editoPlatform,
    subject: ($('e-subject').value || '').trim(),
    description: ($('e-description').value || '').trim(),
    format: $('e-format').value || '',
    time: $('e-time').value || ''
  };

  try {
    if (state.editoEditingId) {
      await updateDoc(doc(db, 'edo_editorial', state.editoEditingId), payload);
      toast('Planification mise à jour', '✏️');
      cancelEditoEdit();
    } else {
      await addDoc(editoCol(), { ...payload, done: false, createdAt: serverTimestamp() });
      toast('Post planifié', '🗓️');
      bumpCounter('planned');
      logActivity('Post planifié', `${payload.subject} (${payload.date})`);
      evt.target.reset();
      $('e-date').value = '';
      setEditoPlatform('instagram');
      $('edito-form').classList.add('hidden');
    }
  } catch (e) { reportFirestoreError('edo_editorial', e); alert(explainError(e, 'Impossible de planifier ce post pour le moment.')); }
}

window.editEditoItem = function (id) {
  const item = state.editorial.find(e => e.id === id);
  if (!item) return;
  state.editoEditingId = id;
  $('edito-form').classList.remove('hidden');
  $('edito-submit-btn').textContent = 'ENREGISTRER';
  $('edito-cancel-btn').classList.remove('hidden');
  $('e-date').value = item.date || '';
  $('e-subject').value = item.subject || '';
  $('e-description').value = item.description || '';
  $('e-format').value = item.format || '';
  $('e-time').value = item.time || '';
  setEditoPlatform(item.platform || 'instagram');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.cancelEditoEdit = function () {
  state.editoEditingId = null;
  $('edito-submit-btn').textContent = 'PLANIFIER';
  $('edito-cancel-btn').classList.add('hidden');
  $('edito-form').reset();
  $('e-date').value = '';
  setEditoPlatform('instagram');
};

const editoInFlight = new Set();
// Cocher « Fait » crée automatiquement la ligne dans le suivi (stats à saisir ensuite)
window.toggleEditoDone = async function (id, current) {
  if (editoInFlight.has(id)) return;
  editoInFlight.add(id);
  try {
    const item = state.editorial.find(e => e.id === id);
    await updateDoc(doc(db, 'edo_editorial', id), { done: !current });
    if (!current && item && !item.postId) {
      const ref = await addDoc(postsCol(), {
        date: item.date || toISO(todayDate()), platform: item.platform || 'instagram', title: item.subject || 'Sans titre',
        views: 0, likes: 0, comments: 0, metricA: 0, metricB: 0,
        format: item.format || '', time: item.time || '', statsPending: true, fromEdito: id,
        uid: currentUser ? currentUser.uid : '', createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'edo_editorial', id), { postId: ref.id });
      toast('Publié ! Ajouté au suivi — pense à saisir les stats', '📊');
      logActivity('Post publié (édito)', item.subject || '');
    } else {
      toast(!current ? 'Marqué comme fait' : 'Remis à faire', !current ? '✅' : '↩️');
    }
  } catch (e) { reportFirestoreError('edo_editorial', e); alert(explainError(e, 'Impossible de mettre à jour ce statut pour le moment.')); }
  finally { editoInFlight.delete(id); }
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
          <p class="text-sm font-semibold">${escapeHtml(item.subject || 'Sans sujet')}${item.format ? ` <span class="chip">${escapeHtml(item.format)}</span>` : ''}${item.time ? ` <span class="chip">${escapeHtml(item.time)}</span>` : ''}${item.postId ? ' <span class="chip chip-ok">📊 dans le suivi</span>' : ''}</p>
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
function parseTags(str) {
  return [...new Set(String(str || '').split(/[,;]/).map(s => s.trim().replace(/^#/, '').trim().toLowerCase()).filter(Boolean))].slice(0, 8);
}
$('swipe-form') && $('swipe-form').addEventListener('submit', handleSwipeSubmit);

async function handleSwipeSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert("Configure Firebase avant d'ajouter une idée."); return; }
  const url = ($('f-swipe-url').value || '').trim();
  const note = ($('f-swipe-note').value || '').trim();
  const tags = parseTags($('f-swipe-tags').value);
  try {
    await addDoc(swipeCol(), { url, note, tags, fav: false, createdAt: serverTimestamp() });
    evt.target.reset();
    toast('Idée ajoutée à la veille', '💡');
    bumpCounter('ideasAdded');
    logActivity('Idée ajoutée', note.slice(0, 60));
  } catch (e) { reportFirestoreError('swipe_file', e); alert(explainError(e, "Impossible d'enregistrer cette idée pour le moment.")); }
}

window.toggleIdeaFav = async function (id, current) {
  try { await updateDoc(doc(db, 'swipe_file', id), { fav: !current }); }
  catch (e) { reportFirestoreError('swipe_file', e); }
};
window.setIdeaTag = function (tag) { state.ideaFilter.tag = state.ideaFilter.tag === tag ? '' : tag; renderSwipeGrid(); };
window.toggleIdeaFavFilter = function () { state.ideaFilter.fav = !state.ideaFilter.fav; renderSwipeGrid(); };

// Transforme une idée en post planifié : ouvre le formulaire édito pré-rempli
window.ideaToEdito = function (id) {
  const s = state.swipes.find(x => x.id === id);
  if (!s) return;
  switchTab('edito');
  cancelEditoEdit();
  $('edito-form').classList.remove('hidden');
  $('e-subject').value = String(s.note || '').split(/[.\n]/)[0].trim().slice(0, 70);
  $('e-description').value = `${s.note || ''}\nRéférence : ${s.url || ''}`.trim();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  toast("Idée prête à planifier — choisis la date et la plateforme", '🗓️');
};

window.deleteSwipe = async function (id) {
  if (!confirm('Supprimer cette idée de la veille ?')) return;
  try { await deleteDoc(doc(db, 'swipe_file', id)); }
  catch (e) { reportFirestoreError('swipe_file', e); alert(explainError(e, "Impossible de supprimer cette idée pour le moment.")); }
};

function renderSwipeGrid() {
  const grid = $('swipe-grid');
  const empty = $('swipe-empty');
  const filters = $('idea-filters');
  if (!grid) return;

  const allTags = [...new Set(state.swipes.flatMap(s => Array.isArray(s.tags) ? s.tags : []))].sort();
  if (filters) {
    filters.innerHTML = state.swipes.length
      ? `<button type="button" class="filter-chip ${state.ideaFilter.fav ? 'is-active' : ''}" onclick="toggleIdeaFavFilter()">⭐ Favoris</button>`
        + allTags.map(t => `<button type="button" class="filter-chip ${state.ideaFilter.tag === t ? 'is-active' : ''}" onclick="setIdeaTag('${escapeHtml(t)}')">#${escapeHtml(t)}</button>`).join('')
      : '';
  }

  let list = state.swipes;
  if (state.ideaFilter.fav) list = list.filter(s => s.fav);
  if (state.ideaFilter.tag) list = list.filter(s => Array.isArray(s.tags) && s.tags.includes(state.ideaFilter.tag));

  if (state.swipes.length === 0) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  if (!list.length) { grid.innerHTML = '<p class="text-sm opacity-40 col-span-full">Aucune idée ne correspond à ce filtre.</p>'; return; }

  grid.innerHTML = list.map(s => {
    const dateLabel = s.createdAt && typeof s.createdAt.toDate === 'function' ? s.createdAt.toDate().toLocaleDateString('fr-FR') : '';
    let host = s.url || '';
    try { host = new URL(s.url).hostname.replace('www.', ''); } catch (e) {}
    const tags = (Array.isArray(s.tags) ? s.tags : []).map(t => `<button type="button" class="chip" onclick="setIdeaTag('${escapeHtml(t)}')">#${escapeHtml(t)}</button>`).join(' ');
    return `
      <div class="hud-panel p-4 flex flex-col gap-2">
        <div class="flex items-start justify-between gap-2">
          <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" class="text-sm font-semibold text-edo-orange hover:underline truncate">${escapeHtml(host)}</a>
          <button type="button" class="fav-btn ${s.fav ? 'is-fav' : ''}" onclick="toggleIdeaFav('${s.id}', ${!!s.fav})" title="Favori">${s.fav ? '★' : '☆'}</button>
        </div>
        <p class="text-sm opacity-70 leading-snug">${escapeHtml(s.note)}</p>
        ${tags ? `<div class="flex flex-wrap gap-1">${tags}</div>` : ''}
        <div class="flex items-center justify-between mt-1 gap-2 flex-wrap">
          <span class="text-[11px] opacity-35 font-mono">${dateLabel}</span>
          <span class="flex items-center gap-3">
            <button type="button" onclick="ideaToEdito('${s.id}')" class="text-[11px] font-semibold text-edo-orange hover:underline">🗓 Planifier</button>
            <button type="button" onclick="deleteSwipe('${s.id}')" class="text-[11px] opacity-30 hover:opacity-70">Supprimer</button>
          </span>
        </div>
      </div>`;
  }).join('');
  replay('swipe-grid');
}

/* ============ AMBASSADEURS ============ */
$('ambassador-form') && $('ambassador-form').addEventListener('submit', handleAmbassadorSubmit);

async function handleAmbassadorSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert('Configure Firebase avant de recruter un ambassadeur.'); return; }
  const payload = {
    firstname: ($('amb-firstname').value || '').trim(),
    lastname: ($('amb-lastname').value || '').trim(),
    email: ($('amb-email').value || '').trim(),
    phone: ($('amb-phone').value || '').trim(),
    points: 0,
    log: []
  };
  try {
    await addDoc(ambassadorsCol(), { ...payload, createdAt: serverTimestamp() });
    evt.target.reset();
    toast('Nouvel ambassadeur recruté', '🎉');
    bumpCounter('ambRecruited');
    logActivity('Ambassadeur recruté', `${payload.firstname} ${payload.lastname}`);
  } catch (e) { reportFirestoreError('edo_ambassadors', e); alert(explainError(e, "Impossible d'ajouter cet ambassadeur pour le moment.")); }
}

function pointsGainedInMonth(a, monthId) {
  return (Array.isArray(a.log) ? a.log : [])
    .filter(l => String(l.day || l.at || '').startsWith(monthId) && num(l.points) > 0)
    .reduce((s, l) => s + num(l.points), 0);
}
function ambTier(points) {
  let tier = AMB_TIERS[0];
  AMB_TIERS.forEach(t => { if (points >= t.min) tier = t; });
  return { tier, next: AMB_TIERS.find(t => t.min > points) || null };
}
function currentReason() { const el = $('amb-reason'); return el ? el.value.trim().slice(0, 80) : ''; }

async function applyAmbassadorPoints(id, amount, reason) {
  if (!isConfigured || !db) return;
  const a = state.ambassadors.find(x => x.id === id);
  if (!a) return;
  amount = Math.max(amount, -num(a.points)); // jamais sous 0
  if (!amount) return;
  const entry = { at: new Date().toISOString(), day: toISO(todayDate()), points: amount, reason: reason || '', by: state.profile.pseudo || (currentUser && currentUser.email) || '' };
  const log = [...(Array.isArray(a.log) ? a.log : []), entry].slice(-100);
  try {
    await updateDoc(doc(db, 'edo_ambassadors', id), { points: increment(amount), log });
    toast(`${amount > 0 ? '+' : ''}${amount} points`, amount > 0 ? '⭐' : '➖');
    logActivity('Points ambassadeur', `${a.firstname || ''} ${a.lastname || ''} : ${amount > 0 ? '+' : ''}${amount}${reason ? ' (' + reason + ')' : ''}`);
  } catch (e) { reportFirestoreError('edo_ambassadors', e); alert(explainError(e, "Impossible de modifier les points pour le moment.")); }
}
window.addAmbassadorPoints = function (id, amount) { return applyAmbassadorPoints(id, amount, currentReason()); };
window.customAmbassadorPoints = async function (id) {
  const raw = prompt('Points à ajouter (nombre négatif pour en retirer) :', '15');
  if (raw === null) return;
  const n = Math.round(Number(String(raw).replace(',', '.')));
  if (!n || isNaN(n)) return;
  const reason = prompt('Motif (optionnel) :', currentReason());
  await applyAmbassadorPoints(id, n, (reason || '').trim().slice(0, 80));
};

window.deleteAmbassador = async function (id) {
  if (!requireAdmin('retirer un ambassadeur')) return;
  if (!confirm('Retirer cet ambassadeur du classement ?')) return;
  try { await deleteDoc(doc(db, 'edo_ambassadors', id)); logActivity('Ambassadeur retiré', id); }
  catch (e) { reportFirestoreError('edo_ambassadors', e); alert(explainError(e, "Impossible de supprimer cet ambassadeur pour le moment.")); }
};

window.openAmbHistory = function (id) {
  const a = state.ambassadors.find(x => x.id === id);
  if (!a) return;
  $('amb-modal-title').textContent = `Historique — ${a.firstname || ''} ${a.lastname || ''}`.trim();
  const log = [...(Array.isArray(a.log) ? a.log : [])].reverse();
  $('amb-modal-list').innerHTML = log.length
    ? log.map(l => `<div class="amb-log-row">
        <span class="font-mono text-xs opacity-60 w-24 shrink-0">${escapeHtml(l.day || String(l.at || '').slice(0, 10))}</span>
        <span class="font-mono font-bold w-12 shrink-0 ${num(l.points) > 0 ? 'text-emerald-500' : 'text-red-500'}">${num(l.points) > 0 ? '+' : ''}${num(l.points)}</span>
        <span class="flex-1 text-sm">${escapeHtml(l.reason || '—')}</span>
        <span class="text-[11px] opacity-40">${escapeHtml(l.by || '')}</span></div>`).join('')
    : '<p class="text-sm opacity-50 py-4 text-center">Aucun historique pour le moment.</p>';
  $('amb-modal').classList.remove('hidden');
};
window.closeAmbHistory = function () { const m = $('amb-modal'); if (m) m.classList.add('hidden'); };

/* ---- Challenge mensuel ---- */
function renderChallenge() {
  const box = $('challenge-box');
  if (!box) return;
  const monthId = currentMonthId();
  const ch = state.challenge;
  if (!ch || ch.month !== monthId || !(num(ch.goal) > 0)) {
    box.innerHTML = `<p class="text-sm opacity-60">Aucun challenge pour ${escapeHtml(monthLabelFromId(monthId))}. Lance-en un juste en dessous 👇</p>`;
    return;
  }
  const total = state.ambassadors.reduce((s, a) => s + pointsGainedInMonth(a, monthId), 0);
  const pct = Math.min(100, Math.round((total / ch.goal) * 100));
  box.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <p class="font-heading font-bold text-sm">🏁 ${escapeHtml(ch.title || 'Challenge du mois')}</p>
      <span class="font-mono text-xs ${pct >= 100 ? 'text-emerald-500' : 'text-edo-orange'} font-bold">${formatNumber(total)} / ${formatNumber(ch.goal)} pts · ${pct} %${pct >= 100 ? ' 🎉' : ''}</span>
    </div>
    <div class="xp-track-light mt-2"><div class="xp-fill-light" style="width:${pct}%"></div></div>
    <button type="button" onclick="stopChallenge()" class="text-[11px] opacity-40 hover:opacity-80 mt-2">Arrêter ce challenge</button>`;
}
$('challenge-form') && $('challenge-form').addEventListener('submit', async (evt) => {
  evt.preventDefault();
  if (!isConfigured || !db) { alert('Configure Firebase avant de lancer un challenge.'); return; }
  const title = ($('ch-title').value || '').trim().slice(0, 80);
  const goal = Math.max(0, Math.round(Number($('ch-goal').value) || 0));
  if (!title || goal <= 0) { alert('Donne un titre et un objectif de points (supérieur à 0).'); return; }
  try {
    await setDoc(challengeDoc(), { title, goal, month: currentMonthId() });
    evt.target.reset();
    toast('Challenge lancé', '🏁');
    logActivity('Challenge ambassadeurs', `${title} (${goal} pts)`);
  } catch (e) { reportFirestoreError('app_settings', e); alert(explainError(e, 'Impossible de lancer le challenge pour le moment.')); }
});
window.stopChallenge = async function () {
  if (!confirm('Arrêter le challenge en cours ?')) return;
  try { await deleteDoc(challengeDoc()); } catch (e) { reportFirestoreError('app_settings', e); }
};

function medalFor(rank) { return rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : '#' + (rank + 1); }

/* ---- Export / import Excel des ambassadeurs ---- */
window.exportAmbassadorsExcel = function () {
  if (state.ambassadors.length === 0) { alert('Aucun ambassadeur à exporter pour le moment.'); return; }
  const headers = ['Prénom', 'Nom', 'Email', 'Téléphone', 'Points'];
  const rows = [...state.ambassadors]
    .sort((a, b) => num(b.points) - num(a.points))
    .map(a => [a.firstname || '', a.lastname || '', a.email || '', a.phone || '', num(a.points)]);
  const stamp = toISO(todayDate());

  if (typeof XLSX !== 'undefined') {
    try {
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      ws['!cols'] = [{ wch: 16 }, { wch: 18 }, { wch: 32 }, { wch: 16 }, { wch: 10 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Ambassadeurs');
      XLSX.writeFile(wb, `edo-ambassadeurs-${stamp}.xlsx`);
      toast('Export Excel (.xlsx) téléchargé', '⬇️');
      return;
    } catch (e) { console.error('Export xlsx impossible, repli CSV :', e); }
  }

  const csvEscape = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows].map(row => row.map(csvEscape).join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `edo-ambassadeurs-${stamp}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Export CSV téléchargé', '⬇️');
};

const AMB_ALIASES = {
  firstname: ['prenom', 'firstname', 'first', 'givenname'],
  lastname:  ['nom', 'lastname', 'last', 'surname', 'familyname', 'nomdefamille'],
  email:     ['email', 'mail', 'courriel', 'emailaddress', 'adressemail', 'adresseemail'],
  phone:     ['telephone', 'tel', 'phone', 'mobile', 'portable', 'gsm', 'numero'],
  points:    ['points', 'point', 'pts', 'score']
};
function normalizeHeader(h) {
  return String(h || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}
function pickField(row, aliases) {
  for (const key of Object.keys(row)) {
    if (aliases.includes(normalizeHeader(key))) return String(row[key] ?? '').trim();
  }
  return '';
}

// Lecture CSV tolérante (séparateur ; , ou tabulation, guillemets, BOM UTF-8)
function parseCSVToObjects(text) {
  text = String(text).replace(/^\uFEFF/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const counts = { ';': (first.match(/;/g) || []).length, ',': (first.match(/,/g) || []).length, '\t': (first.match(/\t/g) || []).length };
  const delim = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const rows = [];
  let row = [], cur = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.some(v => v !== '')) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(r => { const o = {}; headers.forEach((h, i) => { o[h] = r[i] ?? ''; }); return o; });
}

async function readSpreadsheetRows(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.csv') || name.endsWith('.txt')) return parseCSVToObjects(await file.text());
  if (typeof XLSX === 'undefined') throw new Error("La librairie Excel n'a pas pu se charger (connexion ?). Importe plutôt un fichier .csv.");
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

window.importAmbassadors = async function (evt) {
  const input = evt.target;
  const file = input.files && input.files[0];
  if (!file) return;
  if (!requireAdmin("importer des ambassadeurs")) { input.value = ''; return; }
  if (!isConfigured || !db) { alert("Configure Firebase avant d'importer des ambassadeurs."); input.value = ''; return; }

  try {
    const rows = await readSpreadsheetRows(file);
    if (!rows.length) { alert("Aucune ligne exploitable : vérifie que la 1re ligne contient les en-têtes (Prénom, Nom, Email, Téléphone, Points)."); return; }

    const nameKey = (f, l) => `${f}|${l}`.toLowerCase().trim();
    const emails = new Set(state.ambassadors.map(a => String(a.email || '').trim().toLowerCase()).filter(Boolean));
    const names = new Set(state.ambassadors.map(a => nameKey(a.firstname || '', a.lastname || '')));
    const toCreate = [];
    let duplicates = 0, invalid = 0;

    rows.forEach(row => {
      const firstname = pickField(row, AMB_ALIASES.firstname);
      const lastname = pickField(row, AMB_ALIASES.lastname);
      const email = pickField(row, AMB_ALIASES.email);
      const phone = pickField(row, AMB_ALIASES.phone);
      const pointsRaw = pickField(row, AMB_ALIASES.points).replace(',', '.').replace(/\s/g, '');
      if (!firstname && !lastname) { invalid++; return; }

      const eKey = email.toLowerCase();
      const nKey = nameKey(firstname, lastname);
      if ((eKey && emails.has(eKey)) || names.has(nKey)) { duplicates++; return; }
      if (eKey) emails.add(eKey);
      names.add(nKey);

      const points = Math.max(0, Math.round(Number(pointsRaw) || 0));
      toCreate.push({ firstname, lastname, email, phone, points });
    });

    if (!toCreate.length) {
      alert(`Rien à importer : ${duplicates} doublon(s) ignoré(s), ${invalid} ligne(s) sans nom.`);
      return;
    }
    if (!confirm(`${toCreate.length} ambassadeur(s) vont être ajoutés.\n(${duplicates} doublon(s) et ${invalid} ligne(s) sans nom ignorés.)\n\nContinuer ?`)) return;

    await runInBatches(toCreate.map(a => (batch) => batch.set(doc(ambassadorsCol()), { ...a, log: [], createdAt: serverTimestamp() })));
    toast(`${toCreate.length} ambassadeur(s) importé(s)`, '📥');
    logActivity('Import ambassadeurs', `${toCreate.length} ajouté(s)`);
  } catch (e) {
    console.error(e);
    reportFirestoreError('edo_ambassadors', e);
    alert(explainError(e, e && e.message ? `Import impossible : ${e.message}` : "Import impossible pour le moment."));
  } finally {
    input.value = '';
  }
};

window.renderAmbassadors = function () {
  const list = $('ambassador-list');
  const empty = $('ambassador-empty');
  if (!list) return;

  const searchInput = $('amb-search');
  const search = (searchInput ? searchInput.value : '').trim().toLowerCase();

  const sorted = [...state.ambassadors].sort((a, b) => num(b.points) - num(a.points));
  const filtered = search ? sorted.filter(a => `${a.firstname || ''} ${a.lastname || ''}`.toLowerCase().includes(search)) : sorted;

  if (state.ambassadors.length === 0) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');

  if (filtered.length === 0) {
    list.innerHTML = `<p class="text-sm opacity-40 text-center py-8">Aucun ambassadeur ne correspond à « ${escapeHtml(search)} ».</p>`;
    return;
  }

  list.innerHTML = filtered.map((a) => {
    const rank = sorted.indexOf(a);
    const rankClass = rank === 0 ? 'amb-rank-1' : rank === 1 ? 'amb-rank-2' : rank === 2 ? 'amb-rank-3' : '';
    const { tier, next } = ambTier(num(a.points));
    const nextTxt = next ? `encore ${next.min - num(a.points)} pts → ${next.name} ${next.icon}` : 'Palier maximum atteint 💎';
    return `
    <div class="amb-row px-4 sm:px-5 py-4 flex flex-wrap items-center gap-4 ${rankClass}">
      <span class="font-heading font-black text-xl w-10 text-center shrink-0">${medalFor(rank)}</span>
      <div class="w-10 h-10 rounded bg-current/10 flex items-center justify-center font-heading font-bold text-xs shrink-0 border" style="border-color:var(--table-border)">${escapeHtml(((a.firstname || '?')[0] || '') + ((a.lastname || '')[0] || ''))}</div>
      <div class="min-w-0 flex-1">
        <p class="text-sm font-semibold truncate">${escapeHtml(a.firstname || '')} ${escapeHtml(a.lastname || '')} <span class="chip" title="${nextTxt}">${tier.icon} ${tier.name}</span></p>
        <p class="text-[11px] opacity-40 font-mono truncate">${escapeHtml(a.email || '')}${a.phone ? ' · ' + escapeHtml(a.phone) : ''}</p>
        <p class="text-[10px] opacity-35 mt-0.5">${nextTxt}</p>
      </div>
      <div class="flex items-center gap-2">
        <span class="font-heading font-extrabold text-lg text-edo-orange">${formatNumber(a.points)}</span>
        <span class="text-[11px] opacity-40 font-mono">PTS</span>
      </div>
      <div class="flex items-center gap-1.5 shrink-0 flex-wrap">
        <button onclick="addAmbassadorPoints('${a.id}', 5)" class="hud-btn-ghost !px-2.5 !py-1.5 text-xs">+5</button>
        <button onclick="addAmbassadorPoints('${a.id}', 10)" class="hud-btn-ghost !px-2.5 !py-1.5 text-xs">+10</button>
        <button onclick="addAmbassadorPoints('${a.id}', 25)" class="hud-btn-primary !px-2.5 !py-1.5 text-xs">+25</button>
        <button onclick="customAmbassadorPoints('${a.id}')" class="hud-btn-ghost !px-2.5 !py-1.5 text-xs" title="Montant libre (négatif possible)">±</button>
        <button onclick="openAmbHistory('${a.id}')" class="hud-btn-ghost !px-2.5 !py-1.5 text-xs" title="Historique des points">📜</button>
        <button onclick="deleteAmbassador('${a.id}')" class="px-2 py-1.5 text-xs opacity-30 hover:opacity-70" title="Retirer">✕</button>
      </div>
    </div>`;
  }).join('');
};

/* ============ QUÊTES (KANBAN) ============ */
document.getElementById('task-form') && document.getElementById('task-form').addEventListener('submit', handleTaskSubmit);

function getColumns() { return Array.isArray(state.columns) && state.columns.length ? state.columns : DEFAULT_COLUMNS; }
function columnById(id) { return getColumns().find(c => c.id === id) || null; }
function normalizeAssignee(v) { const a = String(v || '').trim().toUpperCase(); return ASSIGNEES.includes(a) ? a : ''; }
// Une étiquette dont la colonne a été supprimée retombe dans la 1re colonne
function taskColumnId(t) { return columnById(t.status) ? t.status : getColumns()[0].id; }
function taskCreatedMs(t) { return t.createdAt && typeof t.createdAt.toMillis === 'function' ? t.createdAt.toMillis() : Date.now(); }
function shortDate(iso) { if (!iso) return ''; const [, m, d] = String(iso).split('-'); return `${d}/${m}`; }
function closeColMenus() { document.querySelectorAll('details.col-menu[open]').forEach(d => d.removeAttribute('open')); }

function sortTasks(list) {
  const arr = [...list];
  const byRecent = (a, b) => taskCreatedMs(b) - taskCreatedMs(a);
  switch (state.taskSort) {
    case 'deadline':
      arr.sort((a, b) => (a.deadline || '9999-99-99').localeCompare(b.deadline || '9999-99-99') || byRecent(a, b));
      break;
    case 'assignee': {
      const rank = (t) => { const i = ASSIGNEES.indexOf(normalizeAssignee(t.assignee)); return i < 0 ? 99 : i; };
      arr.sort((a, b) => rank(a) - rank(b) || byRecent(a, b));
      break;
    }
    case 'title':
      arr.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'fr', { sensitivity: 'base' }));
      break;
    default:
      arr.sort(byRecent);
  }
  return arr;
}

function deadlineBadgeHtml(iso, isDone) {
  if (!iso) return '';
  const diff = Math.round((parseISO(iso) - todayDate()) / 86400000);
  const short = shortDate(iso);
  let cls = '', label = '🗓 ' + short;
  if (isDone) cls = 'dl-done';
  else if (diff < 0) { cls = 'dl-late'; label = '⚠ En retard · ' + short; }
  else if (diff === 0) { cls = 'dl-soon'; label = "🗓 Aujourd'hui"; }
  else if (diff === 1) { cls = 'dl-soon'; label = '🗓 Demain'; }
  else if (diff <= 3) cls = 'dl-soon';
  return `<span class="dl-badge ${cls}" title="Deadline : ${escapeHtml(iso)}">${label}</span>`;
}

function assigneeOptions(selected, emptyLabel) {
  return `<option value="">${emptyLabel}</option>` +
    ASSIGNEES.map(a => `<option value="${a}" ${selected === a ? 'selected' : ''}>${a}</option>`).join('');
}

function taskCardHtml(t, col) {
  const who = normalizeAssignee(t.assignee);
  const selected = state.selectedTasks.has(t.id);
  const cl = Array.isArray(t.checklist) ? t.checklist : [];
  const clDone = cl.filter(c => c.done).length;
  const meta = [
    cl.length ? `<span class="chip ${clDone === cl.length ? 'chip-ok' : ''}" title="Checklist">☑ ${clDone}/${cl.length}</span>` : '',
    (t.recurrence && t.recurrence !== 'none') ? `<span class="chip" title="${escapeHtml(RECURRENCES[t.recurrence] || '')}">🔁 ${escapeHtml(RECURRENCES[t.recurrence] || '')}</span>` : ''
  ].join('');
  return `
    <div class="kanban-card ${selected ? 'is-selected' : ''}" data-task-id="${t.id}">
      <div class="flex items-start gap-2">
        <input type="checkbox" class="task-check" ${selected ? 'checked' : ''} onclick="event.stopPropagation()" onchange="toggleTaskSelect('${t.id}', this.checked)" title="Sélectionner" aria-label="Sélectionner l'étiquette" />
        <div class="min-w-0 flex-1 cursor-pointer" onclick="openTaskModal('${t.id}')" title="Ouvrir l'étiquette">
          <p class="text-sm font-semibold leading-snug break-words">${escapeHtml(t.title || 'Sans titre')}</p>
          ${t.description ? `<p class="text-[11px] opacity-45 mt-1 line-clamp-2 break-words">${escapeHtml(t.description)}</p>` : ''}
        </div>
        <button onclick="deleteTask('${t.id}')" class="opacity-25 hover:opacity-70 text-xs shrink-0" title="Supprimer">✕</button>
        <span class="task-grip" draggable="true" ondragstart="handleTaskDragStart(event, '${t.id}')" ondragend="handleTaskDragEnd(event)" title="Glisser pour déplacer">⠿</span>
      </div>
      ${meta ? `<div class="flex gap-1 mt-1.5 flex-wrap">${meta}</div>` : ''}
      <div class="flex items-center justify-between gap-2 mt-2.5 flex-wrap">
        <select class="assignee-select" data-who="${who}" onclick="event.stopPropagation()" onchange="setTaskAssignee('${t.id}', this)" title="Attribuer à">${assigneeOptions(who, 'Attribuer…')}</select>
        ${deadlineBadgeHtml(t.deadline, !!col.done)}
      </div>
    </div>`;
}

function columnHtml(col, idx, total, count, cardsHtml) {
  return `
  <div class="hud-kanban-col" data-col-id="${col.id}" ondragover="handleColDragOver(event)" ondragleave="handleColDragLeave(event)" ondrop="handleColDrop(event, '${col.id}')">
    <div class="hud-kanban-head">
      <div class="flex items-center gap-2 min-w-0">
        <p class="truncate">${escapeHtml(col.name)}</p>
        ${col.done ? '<span class="col-done-tag" title="Colonne terminée : les deadlines n\'y alertent plus">✓</span>' : ''}
        <span class="hud-kanban-count">${count}</span>
      </div>
      <details class="col-menu">
        <summary title="Options de la colonne" aria-label="Options de la colonne">⋯</summary>
        <div class="col-menu-panel">
          <button type="button" onclick="selectColumnTasks('${col.id}')">☑ Tout sélectionner</button>
          <button type="button" onclick="renameColumn('${col.id}')">✎ Renommer</button>
          <button type="button" onclick="toggleColumnDone('${col.id}')">${col.done ? '○ Ne plus marquer comme terminée' : '✓ Marquer comme colonne terminée'}</button>
          <button type="button" onclick="moveColumn('${col.id}', -1)" ${idx === 0 ? 'disabled' : ''}>◀ Déplacer avant</button>
          <button type="button" onclick="moveColumn('${col.id}', 1)" ${idx === total - 1 ? 'disabled' : ''}>▶ Déplacer après</button>
          <button type="button" class="danger" onclick="deleteColumn('${col.id}')">🗑 Supprimer la colonne</button>
        </div>
      </details>
    </div>
    <div class="space-y-2.5 p-3 flex-1">${cardsHtml}</div>
  </div>`;
}

function renderTaskSelects() {
  const cols = getColumns();
  const opts = cols.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  const sel = document.getElementById('t-status');
  if (sel) { const cur = sel.value; sel.innerHTML = opts; if (cols.some(c => c.id === cur)) sel.value = cur; }
  const bulk = document.getElementById('bulk-move');
  if (bulk) bulk.innerHTML = '<option value="">Déplacer vers…</option>' + opts;
}

function updateBulkBar() {
  const bar = document.getElementById('bulk-bar');
  if (!bar) return;
  const n = state.selectedTasks.size;
  bar.classList.toggle('hidden', n === 0);
  const label = document.getElementById('bulk-count');
  if (label) label.textContent = `${n} étiquette${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''}`;
}

function taskPasses(t) {
  const f = state.taskFilter;
  if (f === 'all') return true;
  const w = normalizeAssignee(t.assignee);
  return f === 'none' ? w === '' : w === f;
}
function visibleTasks() { return state.tasks.filter(taskPasses); }

window.setTaskFilter = function (f) {
  state.taskFilter = f;
  document.querySelectorAll('.task-filter-btn').forEach(b => { b.dataset.active = (b.dataset.filter === f); });
  const vis = new Set(visibleTasks().map(t => t.id));
  // On ne garde en sélection que ce qui est visible (évite de supprimer des étiquettes masquées)
  state.selectedTasks = new Set([...state.selectedTasks].filter(id => vis.has(id)));
  renderKanban();
};

function renderKanban() {
  const board = $('kanban-board');
  if (!board) return;
  const cols = getColumns();
  renderTaskSelects();

  const existing = new Set(state.tasks.map(t => t.id));
  [...state.selectedTasks].forEach(id => { if (!existing.has(id)) state.selectedTasks.delete(id); });

  const byCol = {};
  cols.forEach(c => { byCol[c.id] = []; });
  visibleTasks().forEach(t => { byCol[taskColumnId(t)].push(t); });

  board.innerHTML = cols.map((col, idx) => {
    const tasks = sortTasks(byCol[col.id]);
    const cards = tasks.length
      ? tasks.map(t => taskCardHtml(t, col)).join('')
      : '<p class="text-xs opacity-30 text-center py-6">Colonne vide. Le silence avant le buzz.</p>';
    return columnHtml(col, idx, cols.length, tasks.length, cards);
  }).join('');

  updateBulkBar();
}

/* ---- Création / suppression d'étiquettes ---- */
async function handleTaskSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert("Configure Firebase avant d'ajouter une tâche."); return; }
  const title = ($('t-title').value || '').trim();
  if (!title) return;
  const assignee = normalizeAssignee($('t-assignee').value);
  const deadline = $('t-deadline').value || '';
  const recurrence = $('t-recurrence').value || 'none';
  const status = $('t-status').value || getColumns()[0].id;
  try {
    await addDoc(tasksCol(), { title, assignee, deadline, recurrence, checklist: [], description: '', status, createdAt: serverTimestamp() });
    evt.target.reset();
    $('t-status').value = status;
    $('t-assignee').dataset.who = '';
    toast('Nouvelle quête lancée', '⚔️');
    logActivity('Étiquette créée', title);
  } catch (e) { reportFirestoreError('edo_tasks', e); alert(explainError(e, 'Impossible de créer cette tâche pour le moment.')); }
}

window.deleteTask = async function (id) {
  if (!confirm('Supprimer cette étiquette ?')) return;
  try { await deleteDoc(doc(db, 'edo_tasks', id)); state.selectedTasks.delete(id); }
  catch (e) { reportFirestoreError('edo_tasks', e); alert(explainError(e, 'Impossible de supprimer cette étiquette pour le moment.')); }
};

window.setTaskAssignee = async function (id, selectEl) {
  const who = normalizeAssignee(selectEl.value);
  selectEl.dataset.who = who;
  try { await updateDoc(doc(db, 'edo_tasks', id), { assignee: who }); }
  catch (e) { reportFirestoreError('edo_tasks', e); alert(explainError(e, "Impossible d'attribuer cette étiquette pour le moment.")); }
};

window.setTaskSort = function (mode) {
  state.taskSort = mode;
  try { localStorage.setItem('edo-task-sort', mode); } catch (e) {}
  renderKanban();
};

/* ---- Sélection multiple + suppression / déplacement en masse ---- */
window.toggleTaskSelect = function (id, checked) {
  if (checked) state.selectedTasks.add(id); else state.selectedTasks.delete(id);
  const card = document.querySelector(`.kanban-card[data-task-id="${id}"]`);
  if (card) card.classList.toggle('is-selected', !!checked);
  updateBulkBar();
};
window.selectAllTasks = function () {
  const vis = visibleTasks();
  const allSelected = vis.length > 0 && vis.every(t => state.selectedTasks.has(t.id));
  if (allSelected) vis.forEach(t => state.selectedTasks.delete(t.id)); else vis.forEach(t => state.selectedTasks.add(t.id));
  renderKanban();
};
window.selectColumnTasks = function (colId) {
  closeColMenus();
  visibleTasks().filter(t => taskColumnId(t) === colId).forEach(t => state.selectedTasks.add(t.id));
  renderKanban();
};
window.clearTaskSelection = function () { state.selectedTasks.clear(); renderKanban(); };

window.deleteSelectedTasks = async function () {
  const ids = [...state.selectedTasks];
  if (!ids.length) return;
  if (!confirm(`Supprimer définitivement ${ids.length} étiquette${ids.length > 1 ? 's' : ''} ?`)) return;
  try {
    await runInBatches(ids.map(id => (batch) => batch.delete(doc(db, 'edo_tasks', id))));
    state.selectedTasks.clear();
    renderKanban();
    toast(`${ids.length} étiquette${ids.length > 1 ? 's' : ''} supprimée${ids.length > 1 ? 's' : ''}`, '🗑️');
    logActivity('Étiquettes supprimées', `${ids.length} en une fois`);
  } catch (e) { reportFirestoreError('edo_tasks', e); alert(explainError(e, 'Impossible de supprimer la sélection pour le moment.')); }
};

function nextRecurringDate(t) {
  const step = (d) => {
    const n = new Date(d);
    if (t.recurrence === 'weekly') n.setDate(n.getDate() + 7);
    else if (t.recurrence === 'monthly') n.setMonth(n.getMonth() + 1);
    else n.setDate(n.getDate() + 1);
    return n;
  };
  const today = todayDate();
  let d = step(t.deadline ? parseISO(t.deadline) : today);
  while (d < today) d = step(d);
  return toISO(d);
}
// Tâche récurrente terminée → une nouvelle occurrence repart dans la 1re colonne
async function spawnRecurring(t) {
  await addDoc(tasksCol(), {
    title: t.title || 'Sans titre', description: t.description || '', assignee: normalizeAssignee(t.assignee),
    deadline: nextRecurringDate(t), recurrence: t.recurrence,
    checklist: (Array.isArray(t.checklist) ? t.checklist : []).map(c => ({ ...c, done: false })),
    status: getColumns()[0].id, createdAt: serverTimestamp()
  });
  toast(`Nouvelle occurrence créée : ${escapeHtml(t.title || '')}`, '🔁');
}

async function moveTasksToColumn(ids, colId) {
  const col = columnById(colId);
  const toMove = ids.map(id => state.tasks.find(x => x.id === id)).filter(t => t && taskColumnId(t) !== colId);
  if (!toMove.length) return;
  const spawnList = [];
  try {
    await runInBatches(toMove.map(t => (batch) => {
      const upd = { status: colId };
      if (col && col.done && t.recurrence && t.recurrence !== 'none' && !t.recurrenceSpawned) { upd.recurrenceSpawned = true; spawnList.push(t); }
      batch.update(doc(db, 'edo_tasks', t.id), upd);
    }));
    for (const t of spawnList) await spawnRecurring(t);
    if (col && col.done) {
      toast(toMove.length > 1 ? `${toMove.length} quêtes validées !` : 'Quête validée !', '🏆');
      bumpCounter('tasksDone', toMove.length);
    }
    logActivity('Étiquettes déplacées', `${toMove.length} → ${col ? col.name : colId}`);
  } catch (e) { reportFirestoreError('edo_tasks', e); alert(explainError(e, 'Impossible de déplacer cette étiquette pour le moment.')); }
}

window.moveSelectedTasks = async function (colId) {
  const sel = document.getElementById('bulk-move');
  if (!colId) return;
  await moveTasksToColumn([...state.selectedTasks], colId);
  if (sel) sel.value = '';
};

/* ---- Glisser-déposer (poignée ⠿) ---- */
window.handleTaskDragStart = function (evt, id) {
  state.draggedTaskId = id;
  evt.dataTransfer.effectAllowed = 'move';
  try { evt.dataTransfer.setData('text/plain', id); } catch (e) {}
  const card = evt.target.closest('.kanban-card');
  if (card) {
    try { evt.dataTransfer.setDragImage(card, 24, 18); } catch (e) {}
    requestAnimationFrame(() => card.classList.add('dragging'));
  }
};
window.handleTaskDragEnd = function () {
  document.querySelectorAll('.kanban-card.dragging').forEach(c => c.classList.remove('dragging'));
  document.querySelectorAll('.hud-kanban-col[data-dragover="true"]').forEach(c => { c.dataset.dragover = 'false'; });
  state.draggedTaskId = null;
};
window.handleColDragOver = function (evt) { evt.preventDefault(); evt.currentTarget.dataset.dragover = 'true'; };
window.handleColDragLeave = function (evt) {
  if (!evt.currentTarget.contains(evt.relatedTarget)) evt.currentTarget.dataset.dragover = 'false';
};
window.handleColDrop = async function (evt, colId) {
  evt.preventDefault();
  evt.currentTarget.dataset.dragover = 'false';
  const dragged = state.draggedTaskId || (evt.dataTransfer ? evt.dataTransfer.getData('text/plain') : null);
  if (!dragged) return;
  // Si l'étiquette glissée fait partie d'une sélection multiple, on déplace toute la sélection
  const ids = (state.selectedTasks.has(dragged) && state.selectedTasks.size > 1) ? [...state.selectedTasks] : [dragged];
  await moveTasksToColumn(ids, colId);
};

/* ---- Fenêtre « ouvrir l'étiquette » ---- */
function renderModalChecklist() {
  const el = $('tm-checklist');
  if (!el) return;
  el.innerHTML = state.modalChecklist.length
    ? state.modalChecklist.map((c, i) => `
      <div class="check-row">
        <input type="checkbox" class="task-check" ${c.done ? 'checked' : ''} onchange="toggleChecklistItem(${i})" />
        <span class="flex-1 text-sm break-words ${c.done ? 'line-through opacity-50' : ''}">${escapeHtml(c.text)}</span>
        <button type="button" class="opacity-40 hover:opacity-90 text-xs" onclick="removeChecklistItem(${i})" title="Retirer">✕</button>
      </div>`).join('')
    : '<p class="text-xs opacity-40">Aucune sous-tâche. Ajoute-en ci-dessous.</p>';
}
window.addChecklistItem = function () {
  const input = $('tm-check-new');
  const text = (input.value || '').trim().slice(0, 120);
  if (!text) return;
  state.modalChecklist.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 4), text, done: false });
  input.value = '';
  renderModalChecklist();
};
window.toggleChecklistItem = function (i) { const c = state.modalChecklist[i]; if (c) { c.done = !c.done; renderModalChecklist(); } };
window.removeChecklistItem = function (i) { state.modalChecklist.splice(i, 1); renderModalChecklist(); };

window.openTaskModal = function (id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  state.modalTaskId = id;
  const who = normalizeAssignee(t.assignee);
  $('tm-title').value = t.title || '';
  $('tm-desc').value = t.description || '';
  $('tm-deadline').value = t.deadline || '';
  const whoSel = $('tm-assignee');
  whoSel.value = who; whoSel.dataset.who = who;
  $('tm-recurrence').value = t.recurrence || 'none';
  const colSel = $('tm-column');
  colSel.innerHTML = getColumns().map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');
  colSel.value = taskColumnId(t);
  state.modalChecklist = (Array.isArray(t.checklist) ? t.checklist : []).map(c => ({ ...c }));
  renderModalChecklist();
  $('task-modal').classList.remove('hidden');
};
window.closeTaskModal = function () {
  state.modalTaskId = null;
  const m = $('task-modal');
  if (m) m.classList.add('hidden');
};
window.handleTaskModalSubmit = async function (evt) {
  evt.preventDefault();
  const id = state.modalTaskId;
  if (!id) return;
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const title = ($('tm-title').value || '').trim();
  if (!title) return;
  const newStatus = $('tm-column').value;
  const prevCol = columnById(taskColumnId(t));
  const newCol = columnById(newStatus);
  const recurrence = $('tm-recurrence').value || 'none';
  const payload = {
    title,
    description: ($('tm-desc').value || '').trim(),
    deadline: $('tm-deadline').value || '',
    assignee: normalizeAssignee($('tm-assignee').value),
    status: newStatus,
    recurrence,
    checklist: state.modalChecklist.map(c => ({ ...c }))
  };
  const movingToDone = !!(newCol && newCol.done && !(prevCol && prevCol.done));
  const spawn = movingToDone && recurrence !== 'none' && !t.recurrenceSpawned;
  if (spawn) payload.recurrenceSpawned = true;
  try {
    await updateDoc(doc(db, 'edo_tasks', id), payload);
    if (spawn) await spawnRecurring({ ...t, ...payload });
    if (movingToDone) bumpCounter('tasksDone');
    closeTaskModal();
    toast('Étiquette mise à jour', '✏️');
    logActivity('Étiquette modifiée', title);
  } catch (e) { reportFirestoreError('edo_tasks', e); alert(explainError(e, "Impossible d'enregistrer cette étiquette pour le moment.")); }
};
window.deleteTaskFromModal = async function () {
  const id = state.modalTaskId;
  if (!id) return;
  if (!confirm('Supprimer cette étiquette ?')) return;
  try { await deleteDoc(doc(db, 'edo_tasks', id)); closeTaskModal(); }
  catch (e) { reportFirestoreError('edo_tasks', e); alert(explainError(e, 'Impossible de supprimer cette étiquette pour le moment.')); }
};

/* ---- Colonnes : ajout, renommage, ordre, suppression ---- */
async function saveColumns(newColumns, okMsg) {
  try {
    await setDoc(boardDoc(), { columns: newColumns }, { merge: true });
    if (okMsg) toast(okMsg, '🗂️');
  } catch (e) { reportFirestoreError('app_settings/taskBoard', e); alert(explainError(e, 'Impossible de modifier les colonnes pour le moment.')); }
}

window.addColumn = async function (evt) {
  if (evt) evt.preventDefault();
  if (!isConfigured || !db) { alert('Configure Firebase avant de modifier les colonnes.'); return; }
  const input = document.getElementById('new-col-name');
  const name = (input.value || '').trim().slice(0, 30);
  if (!name) return;
  const id = 'col_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  await saveColumns([...getColumns().map(c => ({ ...c })), { id, name, done: false }], 'Colonne ajoutée');
  input.value = '';
};

window.renameColumn = async function (id) {
  closeColMenus();
  const col = columnById(id);
  if (!col) return;
  const name = (prompt('Nouveau nom de la colonne :', col.name) || '').trim().slice(0, 30);
  if (!name || name === col.name) return;
  await saveColumns(getColumns().map(c => c.id === id ? { ...c, name } : c), 'Colonne renommée');
};

window.toggleColumnDone = async function (id) {
  closeColMenus();
  await saveColumns(getColumns().map(c => c.id === id ? { ...c, done: !c.done } : c));
};

window.moveColumn = async function (id, dir) {
  closeColMenus();
  const cols = getColumns().map(c => ({ ...c }));
  const i = cols.findIndex(c => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= cols.length) return;
  [cols[i], cols[j]] = [cols[j], cols[i]];
  await saveColumns(cols);
};

window.deleteColumn = async function (id) {
  closeColMenus();
  if (!requireAdmin('supprimer une colonne')) return;
  const cols = getColumns();
  if (cols.length <= 1) { alert('Il faut garder au moins une colonne.'); return; }
  const col = columnById(id);
  if (!col) return;
  const remaining = cols.filter(c => c.id !== id);
  const fallback = remaining[0];
  const affected = state.tasks.filter(t => t.status === id);
  const msg = affected.length
    ? `Supprimer la colonne « ${col.name} » ?\nSes ${affected.length} étiquette(s) seront déplacées dans « ${fallback.name} ».`
    : `Supprimer la colonne « ${col.name} » ?`;
  if (!confirm(msg)) return;
  try {
    const batch = writeBatch(db);
    affected.forEach(t => batch.update(doc(db, 'edo_tasks', t.id), { status: fallback.id }));
    batch.set(boardDoc(), { columns: remaining }, { merge: true });
    await batch.commit();
    toast('Colonne supprimée', '🗑️');
  } catch (e) { reportFirestoreError('app_settings/taskBoard', e); alert(explainError(e, 'Impossible de supprimer cette colonne pour le moment.')); }
};

/* ============ RAPPELS ============ */
function daysBetween(a, b) { return Math.round((parseISO(b) - parseISO(a)) / 86400000); }

function computeReminders() {
  const items = [];
  const today = toISO(todayDate());

  state.editorial.filter(e => !e.done && e.date && e.date <= today).forEach(e => {
    const late = e.date < today;
    items.push({ icon: '📅', level: late ? 'late' : 'today', tab: 'edito',
      text: `${late ? 'En retard' : "À publier aujourd'hui"} : ${e.subject || 'Sans sujet'} (${platformConfig(e.platform).label})` });
  });

  const doneCols = new Set(getColumns().filter(c => c.done).map(c => c.id));
  state.tasks.filter(t => t.deadline && !doneCols.has(taskColumnId(t))).forEach(t => {
    const diff = daysBetween(today, t.deadline);
    if (diff > 2) return;
    const when = diff < 0 ? 'en retard' : diff === 0 ? "aujourd'hui" : diff === 1 ? 'demain' : 'dans 2 jours';
    items.push({ icon: diff < 0 ? '⚠️' : '⏰', level: diff < 0 ? 'late' : 'soon', tab: 'taches', text: `${t.title || 'Sans titre'} — ${when}` });
  });

  state.posts.filter(p => p.statsPending && p.date && daysBetween(p.date, today) >= 3).forEach(p => {
    items.push({ icon: '📊', level: 'soon', tab: 'dashboard', text: `Stats à saisir : ${p.title || 'Sans titre'} (publié le ${p.date})` });
  });

  const lastFollowers = Object.keys(state.followersHistory || {}).sort().pop();
  if (!lastFollowers || daysBetween(lastFollowers, today) > 7) {
    items.push({ icon: '👥', level: 'soon', tab: 'dashboard', text: "Mets à jour les compteurs d'abonnés (crayon dans l'en-tête)" });
  }
  return items;
}

function renderReminders() {
  const list = $('reminders-list');
  const badge = $('reminder-count');
  if (!list || !badge) return;
  const items = computeReminders();
  badge.textContent = items.length;
  badge.classList.toggle('hidden', items.length === 0);
  list.innerHTML = items.length
    ? items.map(i => `<button type="button" class="reminder-item reminder-${i.level}" onclick="goReminder('${i.tab}')"><span>${i.icon}</span><span class="flex-1 text-left">${escapeHtml(i.text)}</span></button>`).join('')
    : '<p class="text-xs opacity-50 px-3 py-5 text-center">Rien d\'urgent. Tu es à jour 🎯</p>';
}
window.toggleReminders = function () { $('reminders-panel').classList.toggle('hidden'); };
window.goReminder = function (tab) { $('reminders-panel').classList.add('hidden'); switchTab(tab); };

/* ============ COURBE DES ABONNÉS ============ */
let followersChart = null;
function chartColors() {
  const isDark = document.documentElement.classList.contains('dark');
  return {
    isDark,
    grid: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)',
    tick: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.45)',
    neutral: isDark ? '#FFFFFF' : '#333333'
  };
}
function renderFollowersChart() {
  const canvas = $('chart-followers');
  const empty = $('followers-chart-empty');
  const wrap = $('followers-chart-wrap');
  if (!canvas || !empty || !wrap) return;
  if (followersChart) { followersChart.destroy(); followersChart = null; }
  const entries = Object.entries(state.followersHistory || {}).sort((a, b) => a[0].localeCompare(b[0])).slice(-90);
  if (entries.length < 2) { empty.classList.remove('hidden'); wrap.classList.add('hidden'); return; }
  empty.classList.add('hidden'); wrap.classList.remove('hidden');
  const c = chartColors();
  try {
    followersChart = new Chart(canvas.getContext('2d'), {
      type: 'line',
      data: {
        labels: entries.map(e => e[0]),
        datasets: [
          { label: 'Instagram', data: entries.map(e => num(e[1].instagram)), borderColor: '#FFA200', backgroundColor: 'rgba(255,162,0,0.12)', fill: true, tension: 0.3, pointRadius: 3 },
          { label: 'LinkedIn', data: entries.map(e => num(e[1].linkedin)), borderColor: c.neutral, backgroundColor: c.isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)', fill: true, tension: 0.3, pointRadius: 3 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, color: c.tick, font: { family: 'Inter', size: 11 } } } },
        scales: { x: { grid: { display: false }, ticks: { color: c.tick, font: { size: 10 } } }, y: { grid: { color: c.grid }, ticks: { color: c.tick, font: { size: 10 } } } }
      }
    });
  } catch (e) { console.error('Erreur graphique abonnés :', e); }
}

/* ============ ANALYSES (format / jour / créneau) ============ */
function weightedStats(list) {
  const views = list.reduce((s, p) => s + num(p.views), 0);
  const inter = list.reduce((s, p) => s + interactions(p), 0);
  return { count: list.length, views, avgViews: list.length ? views / list.length : 0, eng: views > 0 ? (inter / views) * 100 : 0 };
}
function analyticsRowsHtml(groups, emptyMsg) {
  const filled = groups.filter(g => g.stats.count > 0);
  if (!filled.length) return `<p class="text-xs opacity-40">${emptyMsg}</p>`;
  const max = Math.max(...filled.map(g => g.stats.eng), 0.0001);
  const best = filled.reduce((a, b) => (b.stats.eng > a.stats.eng ? b : a));
  return groups.map(g => {
    const s = g.stats;
    if (!s.count) return `<div class="an-row an-row-empty"><span class="an-label">${escapeHtml(g.label)}</span><span class="an-bar"><i style="width:0%"></i></span><span class="an-val">—</span></div>`;
    return `<div class="an-row ${g === best ? 'an-row-best' : ''}" title="${s.count} post(s) · ${formatNumber(s.avgViews)} vues en moyenne">
      <span class="an-label">${g === best ? '★ ' : ''}${escapeHtml(g.label)}</span>
      <span class="an-bar"><i style="width:${Math.max(4, (s.eng / max) * 100)}%"></i></span>
      <span class="an-val">${s.eng.toFixed(1)} % <small class="opacity-40">· ${s.count}</small></span>
    </div>`;
  }).join('');
}
function renderAnalytics(posts) {
  if (!$('an-format')) return;
  const valid = posts.filter(p => !p.statsPending && num(p.views) > 0);
  $('an-note').textContent = valid.length ? `${valid.length} post(s) analysé(s) sur la période` : 'Aucun post avec des stats sur la période';

  const fmtGroups = [...POST_FORMATS, ''].map(f => ({ label: f || 'Non précisé', stats: weightedStats(valid.filter(p => (p.format || '') === f)) }));
  $('an-format').innerHTML = analyticsRowsHtml(fmtGroups, 'Précise le format dans le formulaire pour activer cette analyse.');

  const dayGroups = WEEKDAYS.map((label, i) => ({ label, stats: weightedStats(valid.filter(p => p.date && ((parseISO(p.date).getDay() + 6) % 7) === i)) }));
  $('an-weekday').innerHTML = analyticsRowsHtml(dayGroups, 'Pas encore de données.');

  const slotOf = (p) => { if (!p.time) return null; const h = Number(String(p.time).split(':')[0]); return TIME_SLOTS.find(s => h >= s.from && h < s.to) || null; };
  const slotGroups = TIME_SLOTS.map(s => ({ label: s.label, stats: weightedStats(valid.filter(p => { const x = slotOf(p); return x && x.id === s.id; })) }));
  $('an-slot').innerHTML = analyticsRowsHtml(slotGroups, "Renseigne l'heure de publication dans le formulaire pour activer cette analyse.");
}

/* ============ RAPPORT MENSUEL ============ */
function monthRange(monthId) {
  const [y, m] = monthId.split('-').map(Number);
  return { start: `${y}-${String(m).padStart(2, '0')}-01`, end: toISO(new Date(y, m, 0)) };
}
function buildMonthlyReport(monthId) {
  const r = monthRange(monthId);
  const posts = state.posts.filter(p => p.date && p.date >= r.start && p.date <= r.end).sort((a, b) => a.date.localeCompare(b.date));
  const bossDoc = state.bosses.find(b => b.id === monthId);
  return {
    monthId, label: monthLabelFromId(monthId), posts,
    kpi: computeKPIs(posts),
    perPlatform: ['instagram', 'linkedin'].map(pf => { const list = posts.filter(p => p.platform === pf); return { label: platformConfig(pf).label, count: list.length, kpi: computeKPIs(list) }; }),
    top: [...posts].sort((a, b) => engagementRate(b) - engagementRate(a)).slice(0, 3),
    boss: bossDoc ? bossStats(monthId, bossDoc) : null,
    edito: state.editorial.filter(e => e.date && e.date >= r.start && e.date <= r.end),
    ambs: [...state.ambassadors].sort((a, b) => num(b.points) - num(a.points)).slice(0, 10)
      .map(a => ({ name: `${a.firstname || ''} ${a.lastname || ''}`.trim(), points: num(a.points), gained: pointsGainedInMonth(a, monthId) }))
  };
}
function reportMonthValue() { const v = $('report-month') ? $('report-month').value : ''; return /^\d{4}-\d{2}$/.test(v) ? v : currentMonthId(); }

window.exportMonthlyReportExcel = function () {
  if (typeof XLSX === 'undefined') { alert("La librairie Excel n'est pas chargée (connexion ?). Utilise l'export PDF."); return; }
  const rep = buildMonthlyReport(reportMonthValue());
  const k = rep.kpi;
  const summary = [
    [`Rapport mensuel — ${rep.label}`], [],
    ['Indicateur', 'Valeur'],
    ['Publications', rep.posts.length], ['Vues totales', k.totalViews], ['Likes', k.totalLikes], ['Commentaires', k.totalComments],
    ['Engagement moyen (%)', Number(k.avgEngagement.toFixed(2))], [],
    ['Plateforme', 'Posts', 'Vues', 'Engagement (%)'],
    ...rep.perPlatform.map(p => [p.label, p.count, p.kpi.totalViews, Number(p.kpi.avgEngagement.toFixed(2))]), []
  ];
  if (rep.boss) summary.push(['Boss du mois', 'Objectif', 'Vues obtenues', 'Progression (%)'], ['', rep.boss.target, rep.boss.total, Math.round(rep.boss.pct)]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Résumé');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Date', 'Heure', 'Plateforme', 'Titre', 'Format', 'Vues', 'Likes', 'Commentaires', 'Interactions', 'Engagement (%)'],
    ...rep.posts.map(p => [p.date, p.time || '', platformConfig(p.platform).label, p.title || '', p.format || '', num(p.views), num(p.likes), num(p.comments), interactions(p), Number(engagementRate(p).toFixed(2))])
  ]), 'Posts');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Rang', 'Titre', 'Plateforme', 'Engagement (%)', 'Vues'],
    ...rep.top.map((p, i) => [i + 1, p.title || '', platformConfig(p.platform).label, Number(engagementRate(p).toFixed(2)), num(p.views)])
  ]), 'Top 3');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Ambassadeur', 'Points (total)', 'Points gagnés ce mois'], ...rep.ambs.map(a => [a.name, a.points, a.gained])
  ]), 'Ambassadeurs');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Date', 'Plateforme', 'Sujet', 'Fait'], ...rep.edito.map(e => [e.date, platformConfig(e.platform).label, e.subject || '', e.done ? 'Oui' : 'Non'])
  ]), 'Édito');
  XLSX.writeFile(wb, `edo-rapport-${rep.monthId}.xlsx`);
  toast('Rapport Excel téléchargé', '📄');
  logActivity('Rapport exporté', rep.label);
};

function reportHtml(rep) {
  const k = rep.kpi;
  const css = 'body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:32px}h1{margin:0 0 4px;font-size:26px}.sub{color:#666;margin-bottom:22px}'
    + '.kpis{display:flex;gap:12px;flex-wrap:wrap}.kpi{border:2px solid #FFA200;border-radius:6px;padding:10px 14px;min-width:130px}.kpi b{display:block;font-size:22px}'
    + 'h2{font-size:15px;border-bottom:3px solid #FFA200;padding-bottom:4px;margin-top:26px}table{width:100%;border-collapse:collapse;font-size:12px;margin-top:8px}'
    + 'th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#111;color:#fff}@media print{body{margin:14px}}';
  const row = (cells) => `<tr>${cells.map(c => `<td>${escapeHtml(String(c))}</td>`).join('')}</tr>`;
  const head = (cells) => `<tr>${cells.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>Rapport ${escapeHtml(rep.label)}</title><style>${css}</style></head><body>
    <h1>EDO Campus — Rapport ${escapeHtml(rep.label)}</h1><div class="sub">Communication réseaux sociaux · généré le ${new Date().toLocaleDateString('fr-FR')}</div>
    <div class="kpis">
      <div class="kpi"><b>${rep.posts.length}</b>publications</div><div class="kpi"><b>${formatNumber(k.totalViews)}</b>vues</div>
      <div class="kpi"><b>${formatNumber(k.totalLikes)}</b>likes</div><div class="kpi"><b>${formatNumber(k.totalComments)}</b>commentaires</div>
      <div class="kpi"><b>${k.avgEngagement.toFixed(1)} %</b>engagement moyen</div>
    </div>
    <h2>Par plateforme</h2><table>${head(['Plateforme', 'Posts', 'Vues', 'Engagement'])}${rep.perPlatform.map(p => row([p.label, p.count, formatNumber(p.kpi.totalViews), p.kpi.avgEngagement.toFixed(1) + ' %'])).join('')}</table>
    ${rep.boss ? `<h2>Boss du mois</h2><p>Objectif ${formatNumber(rep.boss.target)} vues — obtenu ${formatNumber(rep.boss.total)} (${Math.round(rep.boss.pct)} %) ${rep.boss.total >= rep.boss.target ? '— <b>Boss vaincu 🏆</b>' : ''}</p>` : ''}
    <h2>Top 3 (engagement)</h2><table>${head(['#', 'Titre', 'Plateforme', 'Engagement', 'Vues'])}${rep.top.map((p, i) => row([i + 1, p.title || '', platformConfig(p.platform).label, engagementRate(p).toFixed(1) + ' %', formatNumber(p.views)])).join('')}</table>
    <h2>Publications du mois</h2><table>${head(['Date', 'Plateforme', 'Titre', 'Format', 'Vues', 'Engagement'])}${rep.posts.map(p => row([p.date, platformConfig(p.platform).label, p.title || '', p.format || '', formatNumber(p.views), engagementRate(p).toFixed(1) + ' %'])).join('')}</table>
    <h2>Ambassadeurs</h2><table>${head(['Ambassadeur', 'Points', 'Gagnés ce mois'])}${rep.ambs.map(a => row([a.name, a.points, a.gained])).join('')}</table>
  </body></html>`;
}
window.printMonthlyReport = function () {
  const rep = buildMonthlyReport(reportMonthValue());
  const w = window.open('', '_blank');
  if (!w) { alert('Autorise les pop-ups pour générer le PDF, puis réessaie.'); return; }
  w.document.write(reportHtml(rep));
  w.document.close();
  w.focus();
  setTimeout(() => { try { w.print(); } catch (e) {} }, 400);
  logActivity('Rapport PDF', rep.label);
};

/* ============ BANQUE D'IMAGES ============ */
const MEDIA_TYPES = { photo: { icon: '📷', label: 'Photo' }, video: { icon: '🎬', label: 'Vidéo' }, autre: { icon: '📁', label: 'Autre' } };

$('media-form') && $('media-form').addEventListener('submit', handleMediaSubmit);
async function handleMediaSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert("Configure Firebase avant d'ajouter un média."); return; }
  const payload = {
    title: ($('md-title').value || '').trim(),
    url: ($('md-url').value || '').trim(),
    type: $('md-type').value || 'photo',
    tags: parseTags($('md-tags').value),
    by: state.profile.pseudo || ''
  };
  try {
    await addDoc(mediaCol(), { ...payload, createdAt: serverTimestamp() });
    evt.target.reset();
    toast('Média ajouté à la banque', '📷');
    logActivity('Média ajouté', payload.title);
  } catch (e) { reportFirestoreError('edo_media', e); alert(explainError(e, "Impossible d'ajouter ce média pour le moment.")); }
}
window.deleteMedia = async function (id) {
  if (!confirm('Retirer ce média de la banque ?')) return;
  try { await deleteDoc(doc(db, 'edo_media', id)); }
  catch (e) { reportFirestoreError('edo_media', e); alert(explainError(e, 'Impossible de supprimer ce média pour le moment.')); }
};
window.setMediaType = function (type) {
  state.mediaFilter.type = type;
  document.querySelectorAll('.media-type-btn').forEach(b => { b.dataset.active = (b.dataset.type === type); });
  renderMedia();
};
function renderMedia() {
  const grid = $('media-grid');
  const empty = $('media-empty');
  if (!grid) return;
  const q = (($('media-search') || {}).value || '').trim().toLowerCase();
  let list = [...state.media].sort((a, b) => (b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : Date.now()) - (a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : Date.now()));
  if (state.mediaFilter.type !== 'all') list = list.filter(m => m.type === state.mediaFilter.type);
  if (q) list = list.filter(m => `${m.title || ''} ${(m.tags || []).join(' ')}`.toLowerCase().includes(q));

  if (!state.media.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
  empty.classList.add('hidden');
  if (!list.length) { grid.innerHTML = '<p class="text-sm opacity-40 col-span-full">Aucun média ne correspond.</p>'; return; }

  grid.innerHTML = list.map(m => {
    const t = MEDIA_TYPES[m.type] || MEDIA_TYPES.autre;
    let host = m.url || '';
    try { host = new URL(m.url).hostname.replace('www.', ''); } catch (e) {}
    const tags = (Array.isArray(m.tags) ? m.tags : []).map(x => `<span class="chip">#${escapeHtml(x)}</span>`).join(' ');
    return `
      <div class="hud-panel p-4 flex flex-col gap-2">
        <div class="flex items-start justify-between gap-2">
          <p class="text-sm font-semibold break-words">${t.icon} ${escapeHtml(m.title || 'Sans titre')}</p>
          <button type="button" onclick="deleteMedia('${m.id}')" class="opacity-30 hover:opacity-70 text-xs shrink-0" title="Retirer">✕</button>
        </div>
        <a href="${escapeHtml(m.url)}" target="_blank" rel="noopener" class="text-xs font-mono text-edo-orange hover:underline truncate">${escapeHtml(host)} ↗</a>
        ${tags ? `<div class="flex flex-wrap gap-1">${tags}</div>` : ''}
        <p class="text-[11px] opacity-35 font-mono">${t.label}${m.by ? ' · ' + escapeHtml(m.by) : ''}</p>
      </div>`;
  }).join('');
}

/* ============ VEILLE CONCURRENTIELLE ============ */
$('comp-form') && $('comp-form').addEventListener('submit', handleCompSubmit);
async function handleCompSubmit(evt) {
  evt.preventDefault();
  if (!isConfigured || !db) { alert("Configure Firebase avant d'ajouter un compte à surveiller."); return; }
  const payload = {
    name: ($('cp-name').value || '').trim(),
    platform: $('cp-platform').value || 'instagram',
    url: ($('cp-url').value || '').trim(),
    followers: Math.max(0, Math.round(Number($('cp-followers').value) || 0)),
    postsPerWeek: Math.max(0, Number($('cp-ppw').value) || 0),
    notes: ($('cp-notes').value || '').trim().slice(0, 200)
  };
  try {
    if (state.editingCompId) {
      await updateDoc(doc(db, 'edo_competitors', state.editingCompId), { ...payload, updatedAt: serverTimestamp() });
      toast('Compte mis à jour', '✏️');
    } else {
      await addDoc(competitorsCol(), { ...payload, updatedAt: serverTimestamp() });
      toast('Compte ajouté à la veille', '🕵️');
    }
    logActivity('Veille concurrentielle', payload.name);
    resetCompForm();
  } catch (e) { reportFirestoreError('edo_competitors', e); alert(explainError(e, "Impossible d'enregistrer ce compte pour le moment.")); }
}
window.resetCompForm = function () {
  state.editingCompId = null;
  $('comp-form').reset();
  $('cp-submit-btn').textContent = 'AJOUTER';
  $('cp-cancel-btn').classList.add('hidden');
};
window.editComp = function (id) {
  const c = state.competitors.find(x => x.id === id);
  if (!c) return;
  state.editingCompId = id;
  $('cp-name').value = c.name || '';
  $('cp-platform').value = c.platform || 'instagram';
  $('cp-url').value = c.url || '';
  $('cp-followers').value = num(c.followers) || '';
  $('cp-ppw').value = num(c.postsPerWeek) || '';
  $('cp-notes').value = c.notes || '';
  $('cp-submit-btn').textContent = 'METTRE À JOUR';
  $('cp-cancel-btn').classList.remove('hidden');
  $('comp-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
};
window.deleteComp = async function (id) {
  if (!confirm('Retirer ce compte de la veille ?')) return;
  try { await deleteDoc(doc(db, 'edo_competitors', id)); }
  catch (e) { reportFirestoreError('edo_competitors', e); alert(explainError(e, 'Impossible de supprimer ce compte pour le moment.')); }
};
function renderCompetitors() {
  const body = $('comp-body');
  if (!body) return;
  const today = toISO(todayDate());
  // Ligne de référence « nous » : abonnés saisis + rythme de publication sur 28 jours
  const own = ['instagram', 'linkedin'].map(pf => {
    const recent = state.posts.filter(p => p.platform === pf && p.date && daysBetween(p.date, today) >= 0 && daysBetween(p.date, today) < 28).length;
    return `<tr class="comp-own"><td class="font-semibold">★ EDO Campus (nous)</td><td>${platformBadge(pf)}</td><td class="font-mono">${formatNumber(state.followers[pf])}</td><td class="font-mono">${(recent / 4).toFixed(1)}</td><td class="text-xs opacity-50">Calculé : posts des 28 derniers jours ÷ 4</td><td></td></tr>`;
  }).join('');
  const rows = [...state.competitors].sort((a, b) => num(b.followers) - num(a.followers)).map(c => `
    <tr>
      <td class="font-semibold">${c.url ? `<a href="${escapeHtml(c.url)}" target="_blank" rel="noopener" class="hover:underline">${escapeHtml(c.name || '—')} ↗</a>` : escapeHtml(c.name || '—')}</td>
      <td>${platformBadge(c.platform)}</td>
      <td class="font-mono">${formatNumber(c.followers)}</td>
      <td class="font-mono">${num(c.postsPerWeek)}</td>
      <td class="text-xs opacity-60">${escapeHtml(c.notes || '')}</td>
      <td class="whitespace-nowrap">
        <button onclick="editComp('${c.id}')" class="text-edo-orange hover:underline text-xs font-semibold mr-3">Modifier</button>
        <button onclick="deleteComp('${c.id}')" class="opacity-30 hover:opacity-70 text-xs">Retirer</button>
      </td>
    </tr>`).join('');
  body.innerHTML = own + rows;
}

/* ============ ÉQUIPE : CLASSEMENT D'XP + SUCCÈS ============ */
function computeStreak() {
  const dates = new Set(state.posts.map(p => p.date).filter(Boolean));
  let streak = 0, cursor = todayDate();
  while (dates.has(toISO(cursor))) { streak += 1; cursor = addDays(cursor, -1); }
  return streak;
}
function achievementContext() {
  const p = { postsAdded: 0, questsDone: 0, tasksDone: 0, ambRecruited: 0, planned: 0, ideasAdded: 0, ...state.profile };
  const r = monthRange(currentMonthId());
  return {
    p,
    streak: computeStreak(),
    monthPosts: state.posts.filter(x => x.date && x.date >= r.start && x.date <= r.end).length,
    bossWins: (Array.isArray(state.profile.claimed) ? state.profile.claimed : []).filter(k => String(k).endsWith(':100')).length
  };
}
function checkAchievements() {
  if (!state.profileLoaded || !currentUser || !db) return;
  const ctx = achievementContext();
  const unlocked = state.profile.achievements || {};
  ACHIEVEMENTS.forEach(a => {
    const key = 'ach:' + a.id;
    if (unlocked[a.id] || state.claiming.has(key) || a.value(ctx) < a.goal) return;
    state.claiming.add(key);
    updateDoc(userDoc(), { [`achievements.${a.id}`]: toISO(todayDate()), xp: increment(a.xp) })
      .then(() => { toast(`Succès débloqué : ${a.name} (+${a.xp} XP)`, a.icon); pulseXpBar(); })
      .catch(e => reportFirestoreError('edo_users', e));
  });
}
function renderTeam() {
  const body = $('team-body');
  const grid = $('ach-grid');
  if (!body || !grid) return;
  const users = [...state.users].sort((a, b) => num(b.xp) - num(a.xp));
  body.innerHTML = users.length
    ? users.map((u, i) => {
        const info = getLevelInfo(num(u.xp));
        const me = currentUser && u.id === currentUser.uid;
        return `<tr class="${me ? 'team-me' : ''}"><td class="font-heading font-black">${medalFor(i)}</td>
          <td class="font-semibold">${escapeHtml(u.pseudo || 'Joueur')}${me ? ' <span class="chip">toi</span>' : ''}</td>
          <td class="text-xs opacity-70">${escapeHtml(info.title)}</td>
          <td class="font-mono">Niv. ${info.level}</td>
          <td class="font-mono font-bold text-edo-orange">${formatNumber(num(u.xp))} XP</td></tr>`;
      }).join('')
    : '<tr><td colspan="5" class="text-center opacity-50 py-6">Pas encore de joueurs.</td></tr>';

  const ctx = achievementContext();
  const unlocked = state.profile.achievements || {};
  $('ach-summary').textContent = `${ACHIEVEMENTS.filter(a => unlocked[a.id]).length} / ${ACHIEVEMENTS.length} succès débloqués`;
  grid.innerHTML = ACHIEVEMENTS.map(a => {
    const got = !!unlocked[a.id];
    const v = Math.min(a.value(ctx), a.goal);
    return `<div class="ach-card ${got ? 'is-unlocked' : ''}">
      <div class="ach-icon">${a.icon}</div>
      <div class="min-w-0">
        <p class="text-sm font-semibold">${escapeHtml(a.name)}</p>
        <p class="text-[11px] opacity-50">${escapeHtml(a.desc)}</p>
        <p class="text-[10px] font-mono mt-1 ${got ? 'text-emerald-500' : 'opacity-50'}">${got ? `✔ débloqué le ${escapeHtml(String(unlocked[a.id]))} · +${a.xp} XP` : `${v}/${a.goal} · +${a.xp} XP`}</p>
      </div></div>`;
  }).join('');
}

/* ============ RÔLES, JOURNAL D'ACTIVITÉ, SAUVEGARDE ============ */
// Sans champ "role" dans edo_users/{ton uid}, tout le monde est admin (aucun blocage).
// Pour restreindre un compte : mets role = "member" dans la console Firebase.
function isAdmin() { const r = state.profile && state.profile.role; return !r || r === 'admin'; }
function requireAdmin(what) {
  if (isAdmin()) return true;
  alert(`Action réservée aux administrateurs : ${what}.`);
  return false;
}
function tsMs(v) { return v && typeof v.toMillis === 'function' ? v.toMillis() : (v ? new Date(v).getTime() : Date.now()); }

function logActivity(action, detail) {
  if (!isConfigured || !db || !currentUser) return;
  addDoc(activityCol(), {
    at: serverTimestamp(), uid: currentUser.uid,
    who: state.profile.pseudo || currentUser.email || '',
    action, detail: String(detail || '').slice(0, 200)
  }).catch(e => reportFirestoreError('edo_activity', e));
}

function renderActivity() {
  const body = $('activity-body');
  const empty = $('activity-empty');
  const wrap = $('activity-wrap');
  if (!body || !empty || !wrap) return;
  if (!isAdmin()) { wrap.classList.add('hidden'); empty.classList.remove('hidden'); empty.textContent = 'Le journal est réservé aux administrateurs.'; return; }
  wrap.classList.remove('hidden');
  const list = [...state.activity].sort((a, b) => tsMs(b.at) - tsMs(a.at)).slice(0, 200);
  if (!list.length) { body.innerHTML = ''; empty.classList.remove('hidden'); empty.textContent = 'Aucune activité enregistrée pour le moment.'; return; }
  empty.classList.add('hidden');
  body.innerHTML = list.map(a => `<tr>
    <td class="font-mono text-xs whitespace-nowrap">${escapeHtml(new Date(tsMs(a.at)).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</td>
    <td>${escapeHtml(a.who || '—')}</td><td class="font-semibold">${escapeHtml(a.action || '')}</td><td class="text-xs opacity-70">${escapeHtml(a.detail || '')}</td></tr>`).join('');
}

function renderRole() {
  const el = $('role-box');
  if (!el) return;
  const role = (state.profile && state.profile.role) || '';
  el.innerHTML = `<p class="text-sm">Ton rôle : <span class="chip ${isAdmin() ? 'chip-ok' : ''}">${escapeHtml(role || 'admin (par défaut)')}</span></p>
    <p class="text-xs opacity-50 mt-2 leading-relaxed">Les <b>admins</b> peuvent supprimer des posts, des colonnes, des objectifs et des ambassadeurs, importer des fichiers, sauvegarder et voir le journal.
    Les <b>membres</b> gardent la saisie et la consultation. Pour changer un rôle : console Firebase → Firestore → <code>edo_users</code> → document de la personne → champ <code>role</code> = <code>admin</code> ou <code>member</code>.</p>`;
}

window.downloadBackup = function () {
  if (!requireAdmin('sauvegarde complète')) return;
  const data = {
    app: 'EDO//COMMAND', exportedAt: new Date().toISOString(),
    collections: {
      social_posts: state.posts, edo_editorial: state.editorial, swipe_file: state.swipes, edo_ambassadors: state.ambassadors,
      edo_tasks: state.tasks, edo_bosses: state.bosses, edo_media: state.media, edo_competitors: state.competitors, edo_users: state.users
    },
    settings: { counters: state.followers, followersHistory: state.followersHistory, taskBoard: state.columns, rewards: state.rewards, ambassadorChallenge: state.challenge }
  };
  const json = JSON.stringify(data, (k, v) => (v && typeof v.toDate === 'function') ? v.toDate().toISOString() : v, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `edo-sauvegarde-${toISO(todayDate())}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Sauvegarde complète téléchargée', '💾');
  logActivity('Sauvegarde JSON', `${state.posts.length} posts, ${state.ambassadors.length} ambassadeurs, ${state.tasks.length} étiquettes`);
};

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
  resetBossForm();
  fillFormatSelects();
  const sortSel = $('task-sort');
  if (sortSel) sortSel.value = state.taskSort;
  const rm = $('report-month');
  if (rm) rm.value = currentMonthId();
  renderKanban();
  renderReminders();
  renderChallenge();
  renderRewardsForm();
  renderRole();

  // Ferme menus / panneaux au clic extérieur, modales avec Échap
  document.addEventListener('click', (e) => {
    document.querySelectorAll('details.col-menu[open]').forEach(d => { if (!d.contains(e.target)) d.removeAttribute('open'); });
    const panel = $('reminders-panel');
    if (panel && !panel.classList.contains('hidden') && !e.target.closest('#reminders-panel') && !e.target.closest('#reminder-btn')) panel.classList.add('hidden');
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeTaskModal(); closeAmbHistory(); } });

  // PWA : installation sur téléphone / ordinateur (nécessite https)
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();
