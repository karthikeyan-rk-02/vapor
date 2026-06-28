'use strict';

/* ============================================================
   STATE
   ============================================================ */
const DEFAULT_PREFS = {
  durations: { pomodoro: 25, short: 5, long: 15 }, // minutes
  autoSwitch: true,
  autoStart: false,
  sound: true,
  notif: false
};

let prefs = loadPrefs();

let state = {
  mode: 'pomodoro',          // 'pomodoro' | 'short' | 'long'
  timeLeft: prefs.durations.pomodoro * 60,
  totalTime: prefs.durations.pomodoro * 60,
  isRunning: false,
  pomodorosCompleted: 0,     // cycle counter (resets every 4)
  sessionsToday: 0,
  todayDate: todayKey()
};

let tickHandle = null;
let busyClick = false; // guards accidental double-clicks

/* ============================================================
   DOM REFERENCES
   ============================================================ */
const el = {
  body: document.body,
  tabs: document.querySelectorAll('.tab'),
  tabSlider: document.getElementById('tabSlider'),
  ringWrap: document.getElementById('ringWrap'),
  ringProgress: document.getElementById('ringProgress'),
  timeDisplay: document.getElementById('timeDisplay'),
  modeLabel: document.getElementById('modeLabel'),
  startBtn: document.getElementById('startBtn'),
  startIcon: document.getElementById('startIcon'),
  startLabel: document.getElementById('startLabel'),
  resetBtn: document.getElementById('resetBtn'),
  sessionCount: document.getElementById('sessionCount'),
  cycleDots: document.getElementById('cycleDots'),
  toast: document.getElementById('toast'),
  settingsBtn: document.getElementById('settingsBtn'),
  closeSettings: document.getElementById('closeSettings'),
  settingsPanel: document.getElementById('settingsPanel'),
  overlay: document.getElementById('overlay'),
  durPomodoro: document.getElementById('durPomodoro'),
  durShort: document.getElementById('durShort'),
  durLong: document.getElementById('durLong'),
  toggleAutoSwitch: document.getElementById('toggleAutoSwitch'),
  toggleAutoStart: document.getElementById('toggleAutoStart'),
  toggleSound: document.getElementById('toggleSound'),
  toggleNotif: document.getElementById('toggleNotif'),
  saveSettings: document.getElementById('saveSettings')
};

const RING_RADIUS = 130;
const CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;
el.ringProgress.style.strokeDasharray = `${CIRCUMFERENCE}`;

const MODE_LABELS = {
  pomodoro: 'Focus session',
  short: 'Short break',
  long: 'Long break'
};

const MOTIVATION = {
  pomodoro: [
    "Nice work. Take a breath before the next one.",
    "Session complete — that focus added up.",
    "Done. Step away for a moment, you earned it."
  ],
  break: [
    "Break's over. Let's get back to it.",
    "Refreshed and ready when you are.",
    "Time's up — back to focus."
  ]
};

/* ============================================================
   PERSISTENCE
   ============================================================ */
function loadPrefs(){
  try{
    const raw = localStorage.getItem('pomodoro_prefs');
    if(!raw) return structuredCloneSafe(DEFAULT_PREFS);
    const parsed = JSON.parse(raw);
    return { ...structuredCloneSafe(DEFAULT_PREFS), ...parsed,
      durations: { ...DEFAULT_PREFS.durations, ...(parsed.durations || {}) } };
  }catch(e){ return structuredCloneSafe(DEFAULT_PREFS); }
}

function savePrefs(){
  localStorage.setItem('pomodoro_prefs', JSON.stringify(prefs));
}

function structuredCloneSafe(obj){ return JSON.parse(JSON.stringify(obj)); }

function loadPersistedState(){
  try{
    const raw = localStorage.getItem('pomodoro_state');
    if(!raw) return;
    const saved = JSON.parse(raw);

    // Reset daily session counter if the day has changed
    if(saved.todayDate === todayKey()){
      state.sessionsToday = saved.sessionsToday || 0;
      state.pomodorosCompleted = saved.pomodorosCompleted || 0;
    }

    state.mode = saved.mode || 'pomodoro';
    state.totalTime = saved.totalTime || prefs.durations[state.mode] * 60;

    // If timer was running while the tab was closed, account for elapsed time
    let timeLeft = saved.timeLeft;
    if(saved.isRunning && saved.lastTick){
      const elapsed = Math.floor((Date.now() - saved.lastTick) / 1000);
      timeLeft = Math.max(0, timeLeft - elapsed);
    }
    state.timeLeft = timeLeft != null ? timeLeft : prefs.durations[state.mode] * 60;
    state.isRunning = false; // always resume paused for safety/predictability
  }catch(e){ /* ignore corrupt state */ }
}

function saveState(){
  localStorage.setItem('pomodoro_state', JSON.stringify({
    mode: state.mode,
    timeLeft: state.timeLeft,
    totalTime: state.totalTime,
    isRunning: state.isRunning,
    pomodorosCompleted: state.pomodorosCompleted,
    sessionsToday: state.sessionsToday,
    todayDate: state.todayDate,
    lastTick: Date.now()
  }));
}

function todayKey(){
  const d = new Date();
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/* ============================================================
   TIMER CORE
   ============================================================ */
function formatTime(seconds){
  const m = Math.floor(seconds / 60).toString().padStart(2, '0');
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function updateDisplay(){
  el.timeDisplay.textContent = formatTime(state.timeLeft);
  el.modeLabel.textContent = MODE_LABELS[state.mode];
  updateRing();
  updateCycleDots();
  el.sessionCount.textContent = state.sessionsToday;
}

function updateRing(){
  const progress = state.totalTime > 0 ? (state.totalTime - state.timeLeft) / state.totalTime : 0;
  const offset = CIRCUMFERENCE * (1 - progress);
  el.ringProgress.style.strokeDashoffset = offset;
}

function updateCycleDots(){
  el.cycleDots.innerHTML = '';
  const filled = state.pomodorosCompleted % 4;
  for(let i = 0; i < 4; i++){
    const dot = document.createElement('span');
    dot.className = 'cycle-dot' + (i < filled ? ' filled' : '');
    el.cycleDots.appendChild(dot);
  }
}

function startTimer(){
  if(state.isRunning || state.timeLeft <= 0) return;
  state.isRunning = true;
  el.ringWrap.classList.add('running');
  setStartButtonUI();
  tickHandle = setInterval(tick, 1000);
  saveState();
}

function pauseTimer(){
  state.isRunning = false;
  el.ringWrap.classList.remove('running');
  clearInterval(tickHandle);
  setStartButtonUI();
  saveState();
}

function resetTimer(){
  pauseTimer();
  state.timeLeft = prefs.durations[state.mode] * 60;
  state.totalTime = state.timeLeft;
  updateDisplay();
  saveState();
}

function tick(){
  state.timeLeft -= 1;
  if(state.timeLeft <= 0){
    state.timeLeft = 0;
    updateDisplay();
    handleSessionComplete();
    return;
  }
  updateDisplay();
  saveState();
}

function setStartButtonUI(){
  if(state.isRunning){
    el.startIcon.innerHTML = '<rect x="5" y="4" width="5" height="16" rx="1"/><rect x="14" y="4" width="5" height="16" rx="1"/>';
    el.startLabel.textContent = 'Pause';
  }else{
    el.startIcon.innerHTML = '<polygon points="6 4 20 12 6 20 6 4"/>';
    el.startLabel.textContent = state.timeLeft === state.totalTime ? 'Start' : 'Resume';
  }
}

/* ============================================================
   SESSION COMPLETION
   ============================================================ */
function handleSessionComplete(){
  pauseTimer();
  playChime();
  maybeNotify();

  const wasPomodoro = state.mode === 'pomodoro';
  if(wasPomodoro){
    state.sessionsToday += 1;
    state.pomodorosCompleted += 1;
  }
  showToast(pickMessage(wasPomodoro ? 'pomodoro' : 'break'));
  saveState();

  if(prefs.autoSwitch){
    const nextMode = wasPomodoro
      ? (state.pomodorosCompleted % 4 === 0 ? 'long' : 'short')
      : 'pomodoro';
    setMode(nextMode, { keepRunning: prefs.autoStart });
  }else{
    updateDisplay();
  }
}

function pickMessage(kind){
  const list = MOTIVATION[kind];
  return list[Math.floor(Math.random() * list.length)];
}

/* ============================================================
   MODE SWITCHING
   ============================================================ */
function setMode(mode, opts = {}){
  pauseTimer();
  state.mode = mode;
  state.timeLeft = prefs.durations[mode] * 60;
  state.totalTime = state.timeLeft;

  el.body.setAttribute('data-mode', mode);
  el.tabs.forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  moveTabSlider(mode);

  updateDisplay();
  setStartButtonUI();
  saveState();

  if(opts.keepRunning) startTimer();
}

function moveTabSlider(mode){
  const index = { pomodoro: 0, short: 1, long: 2 }[mode];
  el.tabSlider.style.transform = `translateX(${index * 100}%)`;
}

/* ============================================================
   SOUND (Web Audio API — no external assets)
   ============================================================ */
let audioCtx = null;
function playChime(){
  if(!prefs.sound) return;
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const now = audioCtx.currentTime;
    [880, 1108.73].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const start = now + i * 0.16;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.18, start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
      osc.start(start);
      osc.stop(start + 0.95);
    });
  }catch(e){ /* audio not available */ }
}

/* ============================================================
   NOTIFICATIONS
   ============================================================ */
function maybeNotify(){
  if(!prefs.notif || !('Notification' in window)) return;
  if(Notification.permission === 'granted'){
    new Notification('Focus timer', { body: pickMessage(state.mode === 'pomodoro' ? 'pomodoro' : 'break') });
  }
}

function requestNotifPermission(){
  if('Notification' in window && Notification.permission === 'default'){
    Notification.requestPermission();
  }
}

/* ============================================================
   TOAST
   ============================================================ */
let toastTimer = null;
function showToast(message){
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.classList.add('show');
  toastTimer = setTimeout(() => el.toast.classList.remove('show'), 4200);
}

/* ============================================================
   SETTINGS PANEL
   ============================================================ */
function openSettingsPanel(){
  el.durPomodoro.value = prefs.durations.pomodoro;
  el.durShort.value = prefs.durations.short;
  el.durLong.value = prefs.durations.long;
  setSwitch(el.toggleAutoSwitch, prefs.autoSwitch);
  setSwitch(el.toggleAutoStart, prefs.autoStart);
  setSwitch(el.toggleSound, prefs.sound);
  setSwitch(el.toggleNotif, prefs.notif);

  el.settingsPanel.classList.add('show');
  el.overlay.classList.add('show');
}

function closeSettingsPanel(){
  el.settingsPanel.classList.remove('show');
  el.overlay.classList.remove('show');
}

function setSwitch(node, on){
  node.classList.toggle('on', !!on);
}

function toggleSwitch(node){
  node.classList.toggle('on');
}

function applySettingsForm(){
  const newDurations = {
    pomodoro: clampInt(el.durPomodoro.value, 1, 180, prefs.durations.pomodoro),
    short: clampInt(el.durShort.value, 1, 60, prefs.durations.short),
    long: clampInt(el.durLong.value, 1, 90, prefs.durations.long)
  };
  prefs.durations = newDurations;
  prefs.autoSwitch = el.toggleAutoSwitch.classList.contains('on');
  prefs.autoStart = el.toggleAutoStart.classList.contains('on');
  prefs.sound = el.toggleSound.classList.contains('on');
  prefs.notif = el.toggleNotif.classList.contains('on');

  if(prefs.notif) requestNotifPermission();

  savePrefs();

  // Refresh current mode's duration if the timer hasn't been started yet
  if(state.timeLeft === state.totalTime){
    state.timeLeft = prefs.durations[state.mode] * 60;
    state.totalTime = state.timeLeft;
  }
  updateDisplay();
  saveState();
  closeSettingsPanel();
  showToast('Preferences saved');
}

function clampInt(value, min, max, fallback){
  const n = parseInt(value, 10);
  if(Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/* ============================================================
   GUARDED CLICK (prevents accidental double-fires)
   ============================================================ */
function guarded(fn){
  return function(...args){
    if(busyClick) return;
    busyClick = true;
    fn.apply(this, args);
    setTimeout(() => { busyClick = false; }, 280);
  };
}

/* ============================================================
   EVENT WIRING
   ============================================================ */
el.tabs.forEach(tab => {
  tab.addEventListener('click', guarded(() => setMode(tab.dataset.mode)));
});

el.startBtn.addEventListener('click', guarded(() => {
  state.isRunning ? pauseTimer() : startTimer();
}));

el.resetBtn.addEventListener('click', guarded(resetTimer));

el.settingsBtn.addEventListener('click', openSettingsPanel);
el.closeSettings.addEventListener('click', closeSettingsPanel);
el.overlay.addEventListener('click', closeSettingsPanel);
el.saveSettings.addEventListener('click', applySettingsForm);

[el.toggleAutoSwitch, el.toggleAutoStart, el.toggleSound, el.toggleNotif].forEach(node => {
  node.addEventListener('click', () => toggleSwitch(node));
  node.addEventListener('keydown', e => {
    if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggleSwitch(node); }
  });
});

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement.tagName;
  if(tag === 'INPUT' || tag === 'TEXTAREA') return;

  if(e.code === 'Space'){
    e.preventDefault();
    state.isRunning ? pauseTimer() : startTimer();
  }
  if(e.key.toLowerCase() === 'r'){
    e.preventDefault();
    resetTimer();
  }
  if(e.key === 'Escape'){
    closeSettingsPanel();
  }
});

window.addEventListener('beforeunload', saveState);

/* ============================================================
   INIT
   ============================================================ */
function init(){
  loadPersistedState();
  el.body.setAttribute('data-mode', state.mode);
  el.tabs.forEach(t => t.classList.toggle('active', t.dataset.mode === state.mode));
  moveTabSlider(state.mode);
  updateDisplay();
  setStartButtonUI();
}

init();