/* ============================================================================
 * script.js — Digitales Bullet Journal (PWA)
 * ----------------------------------------------------------------------------
 * Eine Datei, mehrere logische Module (durch Kommentar-Banner getrennt):
 *   CONFIG     globale Konstanten & Debug-Flag
 *   utils      Hilfsfunktionen (Datum, DOM, UUID, Toast …)
 *   db         IndexedDB: Init + CRUD über alle Stores
 *   demo       Demo-Datensatz beim ersten Start
 *   calendar   Jahr/Monat/Woche/Tag-Logik & Datumsberechnungen
 *   heatmap    Aktivitäts-Heatmap des Jahreskalenders
 *   backlinks  Erkennung von [[...]] und @Person + Verknüpfungspflege
 *   recurring  Generierung wiederkehrender Aufgaben
 *   search     Volltextsuche über alle Stores
 *   icsParser  .ics-Parsing (regex-basiert, ohne externe Bibliothek)
 *   extCal     Termin-Modal & Import-UI für externe Kalender
 *   exportImp  JSON- und AES-256-verschlüsselter Export/Import
 *   mobile     Swipe-Gesten, Haptic Feedback, Share Target API
 *   keyboard   Tastaturkürzel (Desktop)
 *   ui         DOM-Rendering aller Ansichten
 *   app        Bootstrap / Initialisierung
 *
 * Alle Pfade sind relativ — die App läuft unverändert auf GitHub Pages.
 * ========================================================================== */
'use strict';

/* ========================================================================== *
 *  MODUL: CONFIG
 * ========================================================================== */
const CONFIG = {
  DB_NAME: 'bujo_db',
  DB_VERSION: 2,
  STORES: ['days', 'projects', 'people', 'knowledge', 'collections',
           'future_log', 'external_events', 'notes'],
  TASKS_PER_PAGE: 50,          // Paginierung der Aufgaben-Sammlung
  AUTOBACKUP_EVERY: 10,        // Auto-Backup nach jeder n-ten Änderung
  LS_PREFIX: 'bujo_',          // Präfix für localStorage-Schlüssel
  DEBUG: true                  // false setzen, um Konsolen-Logs zu deaktivieren
};

/* Symbole des Rapid Logging — Glyph, Bezeichnung, optionaler Tastatur-Hinweis */
const RL_SYMBOLS = [
  { sym: '•',  name: 'Aufgabe'   },
  { sym: '-',  name: 'Notiz'     },
  { sym: '○',  name: 'Event'     },
  { sym: '◼',  name: 'Erledigt'  },
  { sym: '⚡', name: 'Priorität' },
  { sym: '👁️', name: 'Recherche' },
  { sym: '💡', name: 'Idee'      },
  { sym: '📞', name: 'Telefonat' }
];

/* Zentrales Debug-Log — über CONFIG.DEBUG abschaltbar. */
function log(...args) { if (CONFIG.DEBUG) console.log('[BuJo]', ...args); }
function warn(...args) { if (CONFIG.DEBUG) console.warn('[BuJo]', ...args); }

/* ========================================================================== *
 *  MODUL: utils — Hilfsfunktionen
 * ========================================================================== */
const U = {
  /* --- UUID (RFC-4122 v4, mit Fallback ohne crypto) --- */
  uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },

  /* --- Datum: lokales Date -> "YYYY-MM-DD" --- */
  ymd(d) {
    const dt = (d instanceof Date) ? d : new Date(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const da = String(dt.getDate()).padStart(2, '0');
    return `${y}-${m}-${da}`;
  },

  /* --- "YYYY-MM-DD" -> Date (lokale Mitternacht) --- */
  parseYmd(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  },

  today() { return U.ymd(new Date()); },

  /* Tag verschieben: ymd +/- n Tage */
  addDays(ymd, n) {
    const d = U.parseYmd(ymd);
    d.setDate(d.getDate() + n);
    return U.ymd(d);
  },

  addMonths(ymd, n) {
    const d = U.parseYmd(ymd);
    d.setMonth(d.getMonth() + n);
    return U.ymd(d);
  },

  /* Lesbares Datum, z. B. "Mo, 19. Mai 2026" */
  prettyDate(ymd) {
    const d = U.parseYmd(ymd);
    return d.toLocaleDateString('de-DE', {
      weekday: 'short', day: 'numeric', month: 'long', year: 'numeric'
    });
  },

  /* Kurzform "19. Mai" */
  shortDate(ymd) {
    const d = U.parseYmd(ymd);
    return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  },

  /* Monatsname + Jahr */
  monthLabel(year, month /*0-11*/) {
    return new Date(year, month, 1)
      .toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  },

  MONTHS_SHORT: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
                 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
  DOW_SHORT: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],

  /* Wochentag-Index Mo=0 … So=6 */
  isoDow(date) { return (date.getDay() + 6) % 7; },

  /* Anzahl Tage im Monat */
  daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate(); },

  /* Montag der Woche, in der "ymd" liegt */
  weekStart(ymd) {
    const d = U.parseYmd(ymd);
    d.setDate(d.getDate() - U.isoDow(d));
    return U.ymd(d);
  },

  /* --- DOM-Helfer --- */
  el(id) { return document.getElementById(id); },
  qs(sel, root = document) { return root.querySelector(sel); },
  qsa(sel, root = document) { return Array.from(root.querySelectorAll(sel)); },

  /* Element erzeugen: U.make('div', {class:'x'}, 'Text' | [child, …]) */
  make(tag, attrs = {}, children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'html') node.innerHTML = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') {
        node.addEventListener(k.slice(2), v);
      } else if (v === true) node.setAttribute(k, '');
      else if (v !== false && v != null) node.setAttribute(k, v);
    }
    if (children != null) {
      const arr = Array.isArray(children) ? children : [children];
      for (const c of arr) {
        if (c == null) continue;
        node.appendChild(typeof c === 'string'
          ? document.createTextNode(c) : c);
      }
    }
    return node;
  },

  /* HTML-Escape gegen versehentliche Injektion */
  esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  },

  /* --- Toast-Benachrichtigung --- */
  toast(msg, kind = '') {
    const root = U.el('toast-root');
    if (!root) return;
    const t = U.make('div', { class: 'toast' + (kind ? ' ' + kind : ''), text: msg });
    root.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transition = 'opacity .25s';
      setTimeout(() => t.remove(), 260);
    }, 2600);
  },

  /* --- localStorage mit JSON & try/catch --- */
  lsGet(key, fallback = null) {
    try {
      const raw = localStorage.getItem(CONFIG.LS_PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { warn('lsGet', e); return fallback; }
  },
  lsSet(key, val) {
    try { localStorage.setItem(CONFIG.LS_PREFIX + key, JSON.stringify(val)); }
    catch (e) { warn('lsSet', e); }
  },
  lsDel(key) {
    try { localStorage.removeItem(CONFIG.LS_PREFIX + key); }
    catch (e) { warn('lsDel', e); }
  },

  /* Zeitstempel ISO */
  nowIso() { return new Date().toISOString(); },

  /* Uhrzeit aus ISO-String, z. B. "14:30" */
  timeOf(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return '';
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  },

  /* einfache Debounce-Funktion */
  debounce(fn, ms = 220) {
    let h;
    return function (...a) {
      clearTimeout(h);
      h = setTimeout(() => fn.apply(this, a), ms);
    };
  },

  /* Klammert n in [min,max] */
  clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
};

/* ========================================================================== *
 *  MODUL: db — IndexedDB (Init + CRUD)
 * ----------------------------------------------------------------------------
 *  Alle Operationen sind promisifiziert und mit error-Handling versehen.
 * ========================================================================== */
const DB = {
  _db: null,
  _changeCounter: 0,          // zählt Schreibvorgänge -> Auto-Backup

  /* IndexedDB öffnen / Schema anlegen. */
  open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(CONFIG.DB_NAME, CONFIG.DB_VERSION);

      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        // "days" nutzt das Datum (YYYY-MM-DD) als Schlüssel,
        // alle übrigen Stores eine UUID im Feld "id".
        for (const name of CONFIG.STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: 'id' });
          }
        }
        log('IndexedDB-Schema angelegt');
      };

      req.onsuccess = (ev) => {
        DB._db = ev.target.result;
        DB._db.onerror = (e) => warn('IndexedDB-Fehler', e.target.error);
        resolve(DB._db);
      };

      req.onerror = (ev) => {
        warn('IndexedDB konnte nicht geöffnet werden', ev.target.error);
        reject(ev.target.error);
      };
    });
  },

  /* Interner Transaktions-Helfer. */
  _tx(store, mode) {
    const tx = DB._db.transaction(store, mode);
    return tx.objectStore(store);
  },

  /* Alle Einträge eines Stores lesen. */
  getAll(store) {
    return new Promise((resolve, reject) => {
      try {
        const req = DB._tx(store, 'readonly').getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
    });
  },

  /* Einen Eintrag per Schlüssel lesen. */
  get(store, key) {
    return new Promise((resolve, reject) => {
      try {
        const req = DB._tx(store, 'readonly').get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
    });
  },

  /* Eintrag schreiben/überschreiben (put). */
  put(store, value) {
    return new Promise((resolve, reject) => {
      try {
        const req = DB._tx(store, 'readwrite').put(value);
        req.onsuccess = () => { DB._afterWrite(); resolve(value); };
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
    });
  },

  /* Eintrag löschen. */
  del(store, key) {
    return new Promise((resolve, reject) => {
      try {
        const req = DB._tx(store, 'readwrite').delete(key);
        req.onsuccess = () => { DB._afterWrite(); resolve(true); };
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
    });
  },

  /* Kompletten Store leeren. */
  clear(store) {
    return new Promise((resolve, reject) => {
      try {
        const req = DB._tx(store, 'readwrite').clear();
        req.onsuccess = () => resolve(true);
        req.onerror = () => reject(req.error);
      } catch (e) { reject(e); }
    });
  },

  /* Mehrere Einträge in einer Transaktion schreiben (Bulk-Import). */
  bulkPut(store, values) {
    return new Promise((resolve, reject) => {
      try {
        const tx = DB._db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        for (const v of values) os.put(v);
        tx.oncomplete = () => resolve(values.length);
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    });
  },

  /* Nach jedem Schreibvorgang: Änderungszähler -> ggf. Auto-Backup. */
  _afterWrite() {
    DB._changeCounter++;
    if (DB._changeCounter % CONFIG.AUTOBACKUP_EVERY === 0) {
      // Auto-Backup im Hintergrund (definiert im exportImp-Modul).
      if (window.ExportImport) ExportImport.autoBackup().catch((e) => warn('autoBackup', e));
    }
  },

  /* Prüft, ob die Datenbank komplett leer ist (Erststart-Erkennung). */
  async isEmpty() {
    for (const s of CONFIG.STORES) {
      const all = await DB.getAll(s);
      if (all.length > 0) return false;
    }
    return true;
  },

  /* --- Komfort-Funktionen für den Tages-Store --- */

  /* Tages-Datensatz holen oder ein leeres Gerüst zurückgeben. */
  async getDay(ymd) {
    const d = await DB.get('days', ymd);
    if (d) return d;
    return {
      id: ymd,
      rapid_logging: [],
      notes: '',
      tasks: [],
      mood: null,
      created_at: U.nowIso(),
      updated_at: U.nowIso()
    };
  },

  /* Tages-Datensatz speichern (setzt updated_at). */
  async saveDay(day) {
    day.updated_at = U.nowIso();
    if (!day.created_at) day.created_at = U.nowIso();
    return DB.put('days', day);
  }
};
/* ========================================================================== *
 *  MODUL: calendar — Datums- & Ansichtslogik
 * ========================================================================== */
const Calendar = {
  /* Aktueller Zustand der Kalendernavigation. */
  state: {
    day: U.today(),                                    // Tagesansicht
    month: { year: new Date().getFullYear(), m: new Date().getMonth() },
    week: U.weekStart(U.today()),                      // Montag der Woche
    year: new Date().getFullYear()
  },

  /* Liefert ein Array aller Tagesdaten (ymd) eines Monats. */
  monthDays(year, m) {
    const n = U.daysInMonth(year, m);
    const out = [];
    for (let d = 1; d <= n; d++) out.push(U.ymd(new Date(year, m, d)));
    return out;
  },

  /* 6x7-Raster für die Monatsmatrix (inkl. Rand-Tage des Vor-/Folgemonats). */
  monthMatrix(year, m) {
    const first = new Date(year, m, 1);
    const lead = U.isoDow(first);                      // Leerzellen am Anfang
    const cells = [];
    const start = new Date(year, m, 1 - lead);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      cells.push({
        ymd: U.ymd(d),
        inMonth: d.getMonth() === m,
        day: d.getDate()
      });
    }
    return cells;
  },

  /* Die 7 Tage (Mo–So) einer Woche ab Montag "weekStartYmd". */
  weekDays(weekStartYmd) {
    const out = [];
    for (let i = 0; i < 7; i++) out.push(U.addDays(weekStartYmd, i));
    return out;
  },

  /* Migriert offene Aufgaben OHNE Fälligkeitsdatum eines Monats in einen
     Folgetag des Zielmonats (Standard: erster Tag). Gibt Anzahl zurück. */
  async migrateTasks(fromYear, fromMonth, toYmd) {
    const days = Calendar.monthDays(fromYear, fromMonth);
    let moved = 0;
    const target = await DB.getDay(toYmd);
    for (const ymd of days) {
      const day = await DB.get('days', ymd);
      if (!day || !day.tasks) continue;
      const keep = [];
      for (const t of day.tasks) {
        if (!t.done && !t.due_date && !t.recurring) {
          target.tasks.push({ ...t, id: U.uuid() });    // neue ID, verschieben
          moved++;
        } else {
          keep.push(t);
        }
      }
      if (keep.length !== day.tasks.length) {
        day.tasks = keep;
        await DB.saveDay(day);
      }
    }
    if (moved > 0) await DB.saveDay(target);
    return moved;
  }
};

/* ========================================================================== *
 *  MODUL: heatmap — Aktivitäts-Heatmap des Jahreskalenders
 * ========================================================================== */
const Heatmap = {
  /* Zählt "Aktivität" eines Tages: Journal-Blöcke + Tasks. */
  dayScore(day) {
    if (!day) return 0;
    let s = 0;
    s += (day.rapid_logging || []).length;
    s += (day.tasks || []).length;
    return s;
  },

  /* Score -> Heat-Stufe 0–4 für die CSS-Klasse. */
  level(score) {
    if (score <= 0) return 0;
    if (score <= 2) return 1;
    if (score <= 4) return 2;
    if (score <= 7) return 3;
    return 4;
  },

  /* Baut eine Map { ymd: {level, hasExt} } für ein ganzes Jahr. */
  async buildYear(year) {
    const days = await DB.getAll('days');
    const ext = await DB.getAll('external_events');
    const map = {};
    for (const d of days) {
      if (d.id && d.id.startsWith(String(year))) {
        map[d.id] = { level: Heatmap.level(Heatmap.dayScore(d)), hasExt: false };
      }
    }
    // Externe Termine als rote Punkt-Indikatoren markieren.
    for (const e of ext) {
      const ymd = (e.start || '').slice(0, 10);
      if (ymd.startsWith(String(year))) {
        if (!map[ymd]) map[ymd] = { level: 0, hasExt: true };
        else map[ymd].hasExt = true;
      }
    }
    return map;
  }
};

/* ========================================================================== *
 *  MODUL: backlinks — [[Projekt]] und @Person erkennen & verknüpfen
 * ========================================================================== */
const Backlinks = {
  /* Findet alle [[...]]-Vorkommen in einem Text. */
  wikiLinks(text) {
    const out = [];
    const re = /\[\[([^\]]+)\]\]/g;
    let m;
    while ((m = re.exec(text || '')) !== null) out.push(m[1].trim());
    return out;
  },

  /* Findet alle @Name-Erwähnungen (Name = Buchstaben/Zahlen/Umlaute). */
  mentions(text) {
    const out = [];
    const re = /@([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß.\-]*)/g;
    let m;
    while ((m = re.exec(text || '')) !== null) out.push(m[1].trim());
    return out;
  },

  /* Sucht in allen Tagen nach Verweisen auf einen Projekt- oder Personennamen.
     Gibt eine Liste { ymd, snippets } zurück, wobei "snippets" alle
     Journal-Blöcke des Tages enthält, die den Namen erwähnen. */
  async findReferences(name) {
    const days = await DB.getAll('days');
    const needleWiki = '[[' + name.toLowerCase() + ']]';
    const needleAt = '@' + name.toLowerCase();
    const hits = [];
    for (const d of days) {
      const matches = [];

      // Journal-Blöcke: jeder Treffer einzeln als ganzer Satz.
      for (const r of (d.rapid_logging || [])) {
        const txt = (r.content || '').toLowerCase();
        if (txt.includes(needleWiki) || txt.includes(needleAt)) {
          matches.push((r.symbol || '•') + ' ' + r.content);
        }
      }

      // Aufgaben des Tages mitberücksichtigen.
      for (const t of (d.tasks || [])) {
        const txt = (t.text || '').toLowerCase();
        if (txt.includes(needleWiki) || txt.includes(needleAt)) {
          matches.push('☐ ' + t.text);
        }
      }

      // Notizen-Feld (Legacy / Monatsreflexion) ebenfalls.
      const notesLower = (d.notes || '').toLowerCase();
      if (notesLower.includes(needleWiki) || notesLower.includes(needleAt)) {
        matches.push(d.notes);
      }

      if (matches.length) {
        hits.push({ ymd: d.id, snippets: matches, snippet: matches.join('\n') });
      }
    }
    hits.sort((a, b) => b.ymd.localeCompare(a.ymd));
    return hits;
  },

  /* Aktualisiert die backlinks-Arrays aller Wissens-Einträge:
     ein Wissens-Eintrag wird mit Tagen verknüpft, deren Journal-Blöcke
     [[Titel]] enthalten. */
  async refreshKnowledgeBacklinks() {
    const knowledge = await DB.getAll('knowledge');
    const days = await DB.getAll('days');
    for (const k of knowledge) {
      const needle = '[[' + (k.title || '').toLowerCase() + ']]';
      const linked = [];
      for (const d of days) {
        const hay = ((d.rapid_logging || []).map((b) => b.content || '').join('\n')
          + '\n' + (d.notes || '')).toLowerCase();
        if (hay.includes(needle)) linked.push(d.id);
      }
      k.backlinks = linked;
      await DB.put('knowledge', k);
    }
  },

  /* Rendert Notiztext mit minimalem Markdown + klickbaren [[Links]]. */
  renderMarkdown(text) {
    let html = U.esc(text || '');
    // Überschriften (### am Zeilenanfang)
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    // fett **…**  /  kursiv *…*
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    // Inline-Code `…`
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Listenpunkte "- …"
    html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => '<ul>' + m + '</ul>');
    // [[Wiki-Links]] -> anklickbare Spans
    html = html.replace(/\[\[([^\]]+)\]\]/g,
      '<a class="wikilink" data-link="$1">[[$1]]</a>');
    // @Mentions hervorheben
    html = html.replace(/@([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß.\-]*)/g,
      '<a class="wikilink" data-mention="$1">@$1</a>');
    // Zeilenumbrüche
    html = html.replace(/\n/g, '<br>');
    return html;
  }
};

/* ========================================================================== *
 *  MODUL: mentions — Auflösung von [[Projekt]] / @Person aus Block-Inhalten
 * ----------------------------------------------------------------------------
 *  Ein Journal-Block wird mit einem Projekt/einer Person verknüpft, wenn
 *  dessen Name im Text als [[Name]] bzw. @Name vorkommt. Zusätzlich werden
 *  ältere, fest gespeicherte project_id/person_id berücksichtigt.
 * ========================================================================== */
const Mentions = {
  /* RegExp-Escape. */
  _esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); },

  /* Liefert alle Projekte, die in "content" als [[Name]] erwähnt werden. */
  projectsIn(content, projects) {
    const text = content || '';
    return projects.filter((p) => {
      if (!p.name) return false;
      const re = new RegExp('\\[\\[\\s*' + Mentions._esc(p.name) + '\\s*\\]\\]', 'i');
      return re.test(text);
    });
  },

  /* Liefert alle Personen, die in "content" als @Name erwähnt werden. */
  peopleIn(content, people) {
    const text = content || '';
    return people.filter((p) => {
      if (!p.name) return false;
      // @Name, gefolgt von Nicht-Wortzeichen oder Textende.
      const re = new RegExp('@' + Mentions._esc(p.name) + '(?![\\wÄÖÜäöüß])', 'i');
      return re.test(text);
    });
  },

  /* Verknüpfte Projekt-IDs eines Blocks (Inhalt + evtl. gespeicherte ID). */
  blockProjectIds(block, projects) {
    const ids = new Set();
    if (block.project_id) ids.add(block.project_id);
    Mentions.projectsIn(block.content, projects).forEach((p) => ids.add(p.id));
    return [...ids];
  },

  /* Verknüpfte Personen-IDs eines Blocks (Inhalt + evtl. gespeicherte ID). */
  blockPersonIds(block, people) {
    const ids = new Set();
    if (block.person_id) ids.add(block.person_id);
    Mentions.peopleIn(block.content, people).forEach((p) => ids.add(p.id));
    return [...ids];
  }
};

/* ========================================================================== *
 *  MODUL: recurring — wiederkehrende Aufgaben
 * ----------------------------------------------------------------------------
 *  Eine wiederkehrende Aufgabe lebt in genau EINEM Tages-Datensatz und trägt
 *  das Feld recurring ('daily'|'weekly'|'monthly') sowie last_completed.
 *  Beim App-Start prüft generate(), ob für "heute" eine Instanz fehlt.
 * ========================================================================== */
const Recurring = {
  /* Liefert true, wenn an "ymd" eine Instanz der Aufgabe fällig ist. */
  dueOn(task, ymd, anchorYmd) {
    if (!task.recurring) return false;
    const d = U.parseYmd(ymd), a = U.parseYmd(anchorYmd);
    if (d < a) return false;
    if (task.recurring === 'daily') return true;
    if (task.recurring === 'weekly') return U.isoDow(d) === U.isoDow(a);
    if (task.recurring === 'monthly') return d.getDate() === a.getDate();
    return false;
  },

  /* Generiert fehlende Instanzen wiederkehrender Aufgaben bis einschließlich
     "heute". Verschiebt nichts, sondern legt fehlende Tages-Tasks neu an.
     Gibt die Anzahl neu erzeugter Instanzen zurück. */
  async generate(uptoYmd = U.today()) {
    const days = await DB.getAll('days');
    let created = 0;

    // 1) Alle Vorlagen (recurring-Tasks) einsammeln.
    const templates = [];
    for (const day of days) {
      for (const t of (day.tasks || [])) {
        if (t.recurring && !t._instance) {
          templates.push({ anchor: day.id, task: t });
        }
      }
    }

    // 2) Für jede Vorlage prüfen, bis zu welchem Datum Instanzen existieren.
    for (const { anchor, task } of templates) {
      let cursor = task.last_completed
        ? U.addDays(task.last_completed, 1)
        : U.addDays(anchor, 1);

      // Nicht in die Vergangenheit vor den Anker.
      if (U.parseYmd(cursor) < U.parseYmd(anchor)) cursor = anchor;

      while (U.parseYmd(cursor) <= U.parseYmd(uptoYmd)) {
        if (Recurring.dueOn(task, cursor, anchor)) {
          const target = await DB.getDay(cursor);
          // Existiert bereits eine Instanz dieser Aufgabe an dem Tag?
          const exists = (target.tasks || []).some(
            (x) => x._fromRecurring === task.id);
          if (!exists) {
            target.tasks.push({
              id: U.uuid(),
              text: task.text,
              done: false,
              due_date: cursor,
              project_id: task.project_id || null,
              person_id: task.person_id || null,
              recurring: null,            // Instanz selbst wiederholt sich nicht
              _instance: true,
              _fromRecurring: task.id,
              last_completed: null,
              external_event_id: null
            });
            await DB.saveDay(target);
            created++;
          }
        }
        cursor = U.addDays(cursor, 1);
      }
    }
    if (created) log(`${created} wiederkehrende Aufgaben-Instanzen erzeugt`);
    return created;
  }
};

/* ========================================================================== *
 *  MODUL: search — Volltextsuche über alle Stores
 * ========================================================================== */
const Search = {
  /* Durchsucht days, knowledge und external_events.
     opts: { from, to, projectId, personId, tag } — alle optional. */
  async run(query, opts = {}) {
    const q = (query || '').trim().toLowerCase();
    if (!q && !opts.from && !opts.to && !opts.projectId && !opts.personId && !opts.tag) {
      return [];
    }
    const results = [];
    const inRange = (ymd) => {
      if (opts.from && ymd < opts.from) return false;
      if (opts.to && ymd > opts.to) return false;
      return true;
    };
    const match = (text) => !q || (text || '').toLowerCase().includes(q);

    /* --- Tage: Journal-Blöcke + Aufgaben --- */
    const days = await DB.getAll('days');
    const projects = await DB.getAll('projects');
    const people = await DB.getAll('people');
    for (const d of days) {
      if (!inRange(d.id)) continue;

      for (const r of (d.rapid_logging || [])) {
        if (opts.projectId &&
            !Mentions.blockProjectIds(r, projects).includes(opts.projectId)) continue;
        if (opts.personId &&
            !Mentions.blockPersonIds(r, people).includes(opts.personId)) continue;
        if (match(r.content)) {
          results.push({
            type: 'Journal-Eintrag', typeKey: 'rl',
            title: `${r.symbol || '•'} ${r.content}`,
            preview: U.prettyDate(d.id),
            ymd: d.id, nav: 'day'
          });
        }
      }
      for (const t of (d.tasks || [])) {
        if (opts.projectId && t.project_id !== opts.projectId) continue;
        if (opts.personId && t.person_id !== opts.personId) continue;
        if (match(t.text)) {
          results.push({
            type: 'Aufgabe', typeKey: 'task',
            title: (t.done ? '☑ ' : '☐ ') + t.text,
            preview: U.prettyDate(d.id),
            ymd: d.id, nav: 'day'
          });
        }
      }
    }

    /* --- Wissen: title + excerpt --- */
    const knowledge = await DB.getAll('knowledge');
    for (const k of knowledge) {
      const tagHit = !opts.tag || (k.tags || []).map(String)
        .map((s) => s.toLowerCase()).includes(opts.tag.toLowerCase());
      if (!tagHit) continue;
      if (match(k.title) || match(k.excerpt)) {
        results.push({
          type: 'Wissen', typeKey: 'knowledge',
          title: k.title, preview: (k.excerpt || '').slice(0, 110),
          knowledgeId: k.id, nav: 'collections'
        });
      }
    }

    /* --- Externe Termine: title, location, description --- */
    const ext = await DB.getAll('external_events');
    for (const e of ext) {
      const ymd = (e.start || '').slice(0, 10);
      if (ymd && !inRange(ymd)) continue;
      if (match(e.title) || match(e.location) || match(e.description)) {
        results.push({
          type: 'Externer Termin', typeKey: 'ext',
          title: '📅 ' + (e.title || 'Termin'),
          preview: [U.prettyDate(ymd || U.today()), e.location].filter(Boolean).join(' · '),
          ymd: ymd || U.today(), nav: 'day'
        });
      }
    }

    return results;
  },

  /* Hebt den Suchbegriff in einer Vorschau mit <mark> hervor. */
  highlight(text, query) {
    const q = (query || '').trim();
    if (!q) return U.esc(text);
    const esc = U.esc(text);
    try {
      const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
      return esc.replace(re, '<mark>$1</mark>');
    } catch (e) { return esc; }
  }
};

/* ========================================================================== *
 *  MODUL: icsParser — .ics-Parsing ohne externe Bibliothek
 * ----------------------------------------------------------------------------
 *  Unterstützt VEVENT mit UID, DTSTART, DTEND, SUMMARY, LOCATION, DESCRIPTION.
 *  Erkennt UTC-Format (…Z), reine Datumswerte (VALUE=DATE) und lokale Zeiten.
 *  Serientermine (RRULE) werden nur als einmaliger Termin importiert.
 * ========================================================================== */
const IcsParser = {
  /* Hebt Zeilen-Faltung (RFC 5545: Fortsetzung mit führendem Leerzeichen) auf. */
  _unfold(text) {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
               .replace(/\n[ \t]/g, '');
  },

  /* Wandelt einen ICS-Datumswert in ein ISO-Datetime + allDay-Flag um. */
  _parseDate(raw, params) {
    // raw z. B. "20251215T143000Z" oder "20251215" oder "20251215T143000"
    const isDateOnly = (params || '').includes('VALUE=DATE')
      || /^\d{8}$/.test(raw);
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/);
    if (!m) return { iso: raw, allDay: false };

    const [, y, mo, d, hh, mm, ss, z] = m;
    if (isDateOnly || !hh) {
      // Reiner Tag — als lokale Mitternacht behandeln.
      const dt = new Date(Number(y), Number(mo) - 1, Number(d));
      return { iso: dt.toISOString(), allDay: true };
    }
    let dt;
    if (z) {
      // UTC-Zeit
      dt = new Date(Date.UTC(+y, +mo - 1, +d, +hh, +mm, +ss || 0));
    } else {
      // Lokale Zeit (ohne TZID-Auflösung — bewusst vereinfacht).
      dt = new Date(+y, +mo - 1, +d, +hh, +mm, +ss || 0);
    }
    return { iso: dt.toISOString(), allDay: false };
  },

  /* Entschärft ICS-Escapes (\n \, \; \\). */
  _unescape(s) {
    return (s || '')
      .replace(/\\n/gi, '\n')
      .replace(/\\,/g, ',')
      .replace(/\\;/g, ';')
      .replace(/\\\\/g, '\\');
  },

  /* Parst kompletten .ics-Text -> Array von external_events-Objekten. */
  parse(icsText) {
    const text = IcsParser._unfold(icsText || '');
    const lines = text.split('\n');
    const events = [];
    let cur = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed === 'BEGIN:VEVENT') {
        cur = { recurring: false };
        continue;
      }
      if (trimmed === 'END:VEVENT') {
        if (cur) {
          // Fallback-Werte sicherstellen.
          if (!cur.id) cur.id = 'ics-' + U.uuid();
          if (!cur.title) cur.title = '(ohne Titel)';
          if (!cur.start) cur.start = U.nowIso();
          if (!cur.end) cur.end = cur.start;
          cur.imported_at = U.nowIso();
          cur.user_note = cur.user_note || '';
          events.push(cur);
        }
        cur = null;
        continue;
      }
      if (!cur) continue;

      // Property "NAME;PARAM=…:WERT"
      const idx = trimmed.indexOf(':');
      if (idx === -1) continue;
      const left = trimmed.slice(0, idx);
      const value = trimmed.slice(idx + 1);
      const semi = left.indexOf(';');
      const name = (semi === -1 ? left : left.slice(0, semi)).toUpperCase();
      const params = semi === -1 ? '' : left.slice(semi + 1);

      switch (name) {
        case 'UID':
          cur.id = value.trim();
          break;
        case 'SUMMARY':
          cur.title = IcsParser._unescape(value);
          break;
        case 'LOCATION':
          cur.location = IcsParser._unescape(value);
          break;
        case 'DESCRIPTION':
          cur.description = IcsParser._unescape(value);
          break;
        case 'DTSTART': {
          const p = IcsParser._parseDate(value.trim(), params);
          cur.start = p.iso;
          cur.allDay = p.allDay;
          break;
        }
        case 'DTEND': {
          const p = IcsParser._parseDate(value.trim(), params);
          cur.end = p.iso;
          break;
        }
        case 'RRULE':
          cur.recurring = true;       // nur Flag — wird einmalig importiert
          break;
        default:
          break;
      }
    }
    return events;
  }
};
/* ========================================================================== *
 *  MODUL: extCal — externe Kalender: Import & Termin-Modal
 * ========================================================================== */
const ExtCal = {
  /* Importiert eine .ics-Datei. Ersetzt ALLE bestehenden external_events.
     onProgress(done,total) optional für die Fortschrittsanzeige. */
  async importFile(file, onProgress) {
    const text = await file.text();
    const events = IcsParser.parse(text);

    await DB.clear('external_events');     // alte Termine ersetzen
    let done = 0;
    for (const e of events) {
      await DB.put('external_events', e);
      done++;
      if (onProgress) onProgress(done, events.length);
    }
    log(`${events.length} externe Termine importiert`);
    return events.length;
  },

  /* Alle externen Termine eines Tages (ymd). */
  async eventsForDay(ymd) {
    const all = await DB.getAll('external_events');
    return all
      .filter((e) => (e.start || '').slice(0, 10) === ymd)
      .sort((a, b) => (a.start || '').localeCompare(b.start || ''));
  },

  /* Prüft, ob bereits eine Aufgabe mit diesem Termin verknüpft ist. */
  async linkedTask(eventId) {
    const days = await DB.getAll('days');
    for (const d of days) {
      for (const t of (d.tasks || [])) {
        if (t.external_event_id === eventId) return { day: d.id, task: t };
      }
    }
    return null;
  },

  /* Erstellt eine Aufgabe, die mit einem externen Termin verknüpft ist.
     prep=true => Vorbereitungsaufgabe einen Tag VOR dem Termin. */
  async createTaskForEvent(event, prep) {
    const eventDay = (event.start || '').slice(0, 10);
    const targetYmd = prep ? U.addDays(eventDay, -1) : eventDay;
    const day = await DB.getDay(targetYmd);
    day.tasks.push({
      id: U.uuid(),
      text: prep ? `Vorbereiten: ${event.title}` : event.title,
      done: false,
      due_date: targetYmd,
      project_id: null,
      person_id: null,
      recurring: null,
      last_completed: null,
      external_event_id: event.id
    });
    await DB.saveDay(day);
    return targetYmd;
  }
};

/* ========================================================================== *
 *  MODUL: exportImp — Export/Import (JSON + AES-256-verschlüsselt)
 * ========================================================================== */
const ExportImport = {
  /* Sammelt alle Stores in ein einziges Objekt. */
  async collect() {
    const data = { _meta: { app: 'BuJo PWA', version: 1, exported_at: U.nowIso() } };
    for (const s of CONFIG.STORES) data[s] = await DB.getAll(s);
    return data;
  },

  /* Browser-Download einer Datei auslösen. */
  _download(filename, content, mime) {
    const blob = new Blob([content], { type: mime || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = U.make('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  /* Unverschlüsselter JSON-Export. */
  async exportJson() {
    const data = await ExportImport.collect();
    const stamp = U.today();
    ExportImport._download(`bujo-backup-${stamp}.json`,
      JSON.stringify(data, null, 2), 'application/json');
    U.toast('JSON-Backup heruntergeladen', 'ok');
  },

  /* Verschlüsselter Export als .bujo-Datei (AES-256 via CryptoJS). */
  async exportEncrypted(password) {
    if (!window.CryptoJS) {
      U.toast('Verschlüsselung nicht verfügbar (offline?)', 'warn');
      return;
    }
    const data = await ExportImport.collect();
    const plain = JSON.stringify(data);
    const cipher = CryptoJS.AES.encrypt(plain, password).toString();
    // Marker voranstellen, damit der Import die Datei sicher erkennt.
    const payload = 'BUJO-ENC-v1\n' + cipher;
    ExportImport._download(`bujo-backup-${U.today()}.bujo`,
      payload, 'application/octet-stream');
    U.toast('Verschlüsseltes Backup (.bujo) heruntergeladen', 'ok');
  },

  /* Entschlüsselt den Inhalt einer .bujo-Datei. */
  _decrypt(content, password) {
    let cipher = content;
    if (content.startsWith('BUJO-ENC-v1\n')) {
      cipher = content.slice('BUJO-ENC-v1\n'.length);
    }
    const bytes = CryptoJS.AES.decrypt(cipher, password);
    const plain = bytes.toString(CryptoJS.enc.Utf8);
    if (!plain) throw new Error('Falsches Passwort oder beschädigte Datei.');
    return JSON.parse(plain);
  },

  /* Import aus Datei. mode: 'overwrite' | 'merge' | 'newids'. */
  async importFile(file, password, mode) {
    const raw = await file.text();
    let data;

    if (file.name.endsWith('.bujo') || raw.startsWith('BUJO-ENC-v1')) {
      if (!window.CryptoJS) throw new Error('CryptoJS nicht geladen.');
      data = ExportImport._decrypt(raw, password || '');
    } else {
      data = JSON.parse(raw);
    }

    // Automatisches Sicherheits-Backup VOR dem Import.
    await ExportImport.autoBackup();

    if (mode === 'overwrite') {
      for (const s of CONFIG.STORES) {
        await DB.clear(s);
        if (Array.isArray(data[s])) await DB.bulkPut(s, data[s]);
      }
    } else if (mode === 'merge') {
      // Nach ID zusammenführen — vorhandene IDs werden überschrieben.
      for (const s of CONFIG.STORES) {
        if (Array.isArray(data[s])) await DB.bulkPut(s, data[s]);
      }
    } else if (mode === 'newids') {
      // Neue IDs vergeben (days behalten ihr Datum als ID).
      for (const s of CONFIG.STORES) {
        if (!Array.isArray(data[s])) continue;
        const items = data[s].map((it) => {
          if (s === 'days') return it;       // Datum bleibt Schlüssel
          return { ...it, id: U.uuid() };
        });
        await DB.bulkPut(s, items);
      }
    }
    log('Import abgeschlossen, Modus:', mode);
  },

  /* Automatisches, verschlüsseltes Backup im localStorage.
     Schlüssel = fest; verwendet ein internes Standardpasswort, da es nur
     der Wiederherstellung auf demselben Gerät dient. */
  async autoBackup() {
    try {
      const data = await ExportImport.collect();
      const plain = JSON.stringify(data);
      let stored;
      if (window.CryptoJS) {
        stored = 'ENC:' + CryptoJS.AES.encrypt(plain, 'bujo-local-autobackup').toString();
      } else {
        stored = 'RAW:' + plain;
      }
      U.lsSet('autobackup', { at: U.nowIso(), payload: stored });
      log('Auto-Backup gespeichert');
    } catch (e) { warn('autoBackup fehlgeschlagen', e); }
  },

  /* Liest das letzte Auto-Backup aus dem localStorage. */
  readAutoBackup() {
    const b = U.lsGet('autobackup');
    if (!b || !b.payload) return null;
    try {
      let plain;
      if (b.payload.startsWith('ENC:') && window.CryptoJS) {
        const bytes = CryptoJS.AES.decrypt(b.payload.slice(4), 'bujo-local-autobackup');
        plain = bytes.toString(CryptoJS.enc.Utf8);
      } else if (b.payload.startsWith('RAW:')) {
        plain = b.payload.slice(4);
      }
      return { at: b.at, data: JSON.parse(plain) };
    } catch (e) { warn('readAutoBackup', e); return null; }
  },

  /* Stellt Daten aus einem Auto-Backup-Objekt wieder her (overwrite). */
  async restoreFromData(data) {
    for (const s of CONFIG.STORES) {
      await DB.clear(s);
      if (Array.isArray(data[s])) await DB.bulkPut(s, data[s]);
    }
    log('Auto-Backup wiederhergestellt');
  }
};

/* ========================================================================== *
 *  MODUL: mobile — Swipe-Gesten, Haptic Feedback, Share Target
 * ========================================================================== */
const Mobile = {
  _touch: { x: 0, y: 0, t: 0 },

  /* Vibrieren beim Erledigen einer Aufgabe (über Einstellung abschaltbar). */
  haptic(ms = 18) {
    const enabled = U.lsGet('haptic', true);
    if (enabled && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) { /* ignorieren */ }
    }
  },

  /* Bindet Swipe-Erkennung an die Tagesansicht. */
  bindSwipe(target) {
    if (!target) return;

    target.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      Mobile._touch = { x: t.clientX, y: t.clientY, t: Date.now() };
    }, { passive: true });

    target.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      const dx = t.clientX - Mobile._touch.x;
      const dy = t.clientY - Mobile._touch.y;
      const dt = Date.now() - Mobile._touch.t;
      // Schnelle, überwiegend horizontale Geste = Swipe.
      if (dt < 600 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) {
        if (dx < 0) {
          // nach links -> nächster Tag
          Calendar.state.day = U.addDays(Calendar.state.day, 1);
          UI.render('day', 'left');
        } else {
          // nach rechts -> vorheriger Tag
          Calendar.state.day = U.addDays(Calendar.state.day, -1);
          UI.render('day', 'right');
        }
      }
    }, { passive: true });
  },

  /* Wertet Share-Target-Parameter aus der URL aus (?title=&text=&url=). */
  handleShareTarget() {
    const p = new URLSearchParams(location.search);
    const parts = [p.get('title'), p.get('text'), p.get('url')]
      .filter(Boolean);
    if (parts.length) {
      const shared = parts.join(' — ');
      // Geteilten Inhalt als Schnellnotiz vorbefüllen.
      setTimeout(() => UI.openQuickNote(shared), 400);
      // URL bereinigen, damit ein Reload nicht erneut auslöst.
      history.replaceState({}, '', location.pathname);
    }
    // ?action=quicknote aus den Manifest-Shortcuts.
    if (p.get('action') === 'quicknote') {
      setTimeout(() => UI.openQuickNote(''), 400);
      history.replaceState({}, '', location.pathname);
    }
  }
};

/* ========================================================================== *
 *  MODUL: keyboard — Tastaturkürzel (Desktop)
 * ========================================================================== */
const Keyboard = {
  init() {
    document.addEventListener('keydown', (e) => {
      // In Eingabefeldern keine Shortcuts (außer Escape).
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select'
        || e.target.isContentEditable;

      if (e.key === 'Escape') {
        UI.closeModal();
        UI.closeHelp();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.key) {
        case 'n': e.preventDefault(); UI.openQuickNote(''); break;
        case 't': e.preventDefault(); UI.openTaskModal(Calendar.state.day); break;
        case 'd':
          e.preventDefault();
          Calendar.state.day = U.today();
          UI.render('day');
          break;
        case 'j':
          e.preventDefault();
          Calendar.state.day = U.addDays(Calendar.state.day, -1);
          UI.render('day', 'right');
          break;
        case 'k':
          e.preventDefault();
          Calendar.state.day = U.addDays(Calendar.state.day, 1);
          UI.render('day', 'left');
          break;
        case 's':
          e.preventDefault();
          UI.render('search');
          setTimeout(() => { const i = U.el('search-input'); if (i) i.focus(); }, 60);
          break;
        case '?':
          e.preventDefault();
          UI.openHelp();
          break;
        default: break;
      }
    });
  }
};

/* ========================================================================== *
 *  MODUL: demo — Demo-Datensatz beim ersten Start
 * ========================================================================== */
const Demo = {
  /* Eingebetteter .ics-String: Arzttermin am 15.12.2025. */
  ICS_SAMPLE: [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//BuJo PWA//Demo//DE',
    'BEGIN:VEVENT',
    'UID:demo-arzttermin-20251215@bujo',
    'DTSTART:20251215T090000Z',
    'DTEND:20251215T093000Z',
    'SUMMARY:Arzttermin Dr. Müller',
    'LOCATION:Praxis Dr. Müller, Hauptstraße 1',
    'DESCRIPTION:Routineuntersuchung. Versichertenkarte mitbringen.',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n'),

  /* Legt den kompletten Demo-Datensatz an. */
  async seed() {
    log('Demo-Datensatz wird angelegt …');

    /* --- Projekte --- */
    const projWork = {
      id: U.uuid(), name: 'Work', farbe: '#3498db',
      status: 'aktiv', description: 'Berufliche Aufgaben und Notizen.',
      created_at: U.nowIso()
    };
    const projPriv = {
      id: U.uuid(), name: 'Privat', farbe: '#2ecc71',
      status: 'aktiv', description: 'Persönliches und Alltag.',
      created_at: U.nowIso()
    };
    await DB.put('projects', projWork);
    await DB.put('projects', projPriv);

    /* --- Personen --- */
    const persAnna = {
      id: U.uuid(), name: 'Anna', email: 'anna@example.com',
      tags: ['Freundin'], created_at: U.nowIso()
    };
    const persMueller = {
      id: U.uuid(), name: 'Dr. Müller', email: '',
      tags: ['Arzt'], created_at: U.nowIso()
    };
    await DB.put('people', persAnna);
    await DB.put('people', persMueller);

    /* --- Wissen --- */
    await DB.put('knowledge', {
      id: U.uuid(), title: 'Weniger ist mehr',
      excerpt: 'Reduktion auf das Wesentliche schafft Klarheit. Wer weniger '
        + 'plant, plant bewusster.',
      source: 'Eigene Notiz', tags: ['Minimalismus', 'Fokus'],
      backlinks: [], created_at: U.nowIso()
    });
    await DB.put('knowledge', {
      id: U.uuid(), title: 'Fokus ist Produktivität',
      excerpt: 'Eine Sache zur Zeit. Tiefe Arbeit entsteht durch ungeteilte '
        + 'Aufmerksamkeit, nicht durch Multitasking.',
      source: 'Eigene Notiz', tags: ['Fokus', 'Produktivität'],
      backlinks: [], created_at: U.nowIso()
    });

    /* --- Demo-Tage der letzten 7 Tage --- */
    const moods = [4, 3, 5, 4, 3, 5, 4];
    const sampleRl = [
      [{ s: '•', c: 'Sprint-Planung vorbereiten' },
       { s: '-', c: 'Idee: Wochenrückblick einführen' },
       { s: '💡', c: 'Routine [[Work]] verschlanken' }],
      [{ s: '○', c: 'Kaffee mit @Anna' },
       { s: '-', c: 'Buch fertig gelesen' }],
      [{ s: '⚡', c: 'Wichtiges Telefonat erledigt' },
       { s: '📞', c: 'Rückruf @Dr.Müller' },
       { s: '◼', c: 'Steuerunterlagen sortiert' }],
      [{ s: '•', c: 'Code-Review für [[Work]]' },
       { s: '👁️', c: 'Recherche zu IndexedDB' }],
      [{ s: '-', c: 'Spaziergang, Kopf frei bekommen' },
       { s: '💡', c: 'Neues Sammlungs-Layout skizziert' }],
      [{ s: '○', c: 'Abendessen mit @Anna [[Privat]]' },
       { s: '•', c: 'Einkauf für die Woche' }],
      [{ s: '⚡', c: 'Deadline-Aufgabe abgeschlossen' },
       { s: '-', c: 'Reflexion: produktive Woche' },
       { s: '💡', c: 'Idee fürs nächste Projekt' }]
    ];

    for (let i = 6; i >= 0; i--) {
      const ymd = U.addDays(U.today(), -i);
      const idx = 6 - i;
      const rl = sampleRl[idx].map((x) => ({
        symbol: x.s,
        content: x.c,
        timestamp: U.nowIso(),
        project_id: x.c.includes('Work') ? projWork.id
                  : x.c.includes('Privat') ? projPriv.id : null,
        person_id: x.c.includes('Anna') ? persAnna.id
                 : x.c.includes('Müller') ? persMueller.id : null
      }));
      const tasks = [{
        id: U.uuid(),
        text: idx % 2 === 0 ? 'Tagesreview schreiben' : 'Inbox auf null bringen',
        done: idx < 4,
        due_date: null,
        project_id: idx % 2 === 0 ? projWork.id : projPriv.id,
        person_id: null,
        recurring: null,
        last_completed: null,
        external_event_id: null
      }];
      if (idx % 3 === 0) {
        tasks.push({
          id: U.uuid(), text: 'Mit @Anna telefonieren',
          done: false, due_date: null,
          project_id: projPriv.id, person_id: persAnna.id,
          recurring: null, last_completed: null, external_event_id: null
        });
      }
      await DB.saveDay({
        id: ymd,
        rapid_logging: rl,
        notes: idx === 6
          ? 'Gute Woche. Fokus auf [[Work]] hat sich gelohnt. @Anna getroffen.'
          : '',
        tasks,
        mood: moods[idx],
        created_at: U.nowIso(),
        updated_at: U.nowIso()
      });
    }

    /* --- Wiederkehrende Aufgabe "Morgenjournal" (daily) ---
       Anker: gestern; last_completed: gestern -> heutige Instanz wird beim
       Start von Recurring.generate() erzeugt. */
    const yesterday = U.addDays(U.today(), -1);
    const anchorDay = await DB.getDay(yesterday);
    anchorDay.tasks.push({
      id: U.uuid(),
      text: 'Morgenjournal',
      done: true,
      due_date: yesterday,
      project_id: projPriv.id,
      person_id: null,
      recurring: 'daily',
      last_completed: yesterday,
      external_event_id: null
    });
    await DB.saveDay(anchorDay);

    /* --- Future Log: ein Beispiel-Eintrag --- */
    await DB.put('future_log', {
      id: U.uuid(),
      title: 'Quartalsplanung',
      date: U.addDays(U.today(), 21),
      description: 'Ziele fürs nächste Quartal festlegen.',
      project_id: projWork.id
    });

    /* --- Benutzerdefinierte Sammlung: Leseliste --- */
    await DB.put('collections', {
      id: U.uuid(),
      type: 'custom',
      name: 'Leseliste',
      linked_id: null,
      custom_fields: [
        { key: 'titel', label: 'Titel', type: 'text' },
        { key: 'autor', label: 'Autor', type: 'text' },
        { key: 'status', label: 'Status', type: 'select',
          options: ['geplant', 'lese gerade', 'gelesen'] },
        { key: 'beendet', label: 'Beendet am', type: 'date' }
      ],
      entries: [
        { id: U.uuid(), titel: 'Die Kunst des klaren Denkens',
          autor: 'R. Dobelli', status: 'gelesen', beendet: U.addDays(U.today(), -30) },
        { id: U.uuid(), titel: 'Deep Work', autor: 'C. Newport',
          status: 'lese gerade', beendet: '' }
      ]
    });

    /* --- Demo-ICS-Termin parsen und einfügen --- */
    const events = IcsParser.parse(Demo.ICS_SAMPLE);
    for (const e of events) await DB.put('external_events', e);

    log('Demo-Datensatz fertig');
  }
};
/* ========================================================================== *
 *  MODUL: ui — DOM-Rendering aller Ansichten
 * ========================================================================== */
const UI = {
  current: 'day',
  _searchState: { results: [], active: 0 },
  _tasksPage: 0,

  /* --- Zentrale Render-Weiche ------------------------------------------- */
  async render(view, swipeDir) {
    // Sub-Ansichten zurücksetzen, wenn die Hauptansicht wechselt.
    if (view !== 'collections' && UI.current !== view) UI._collSub = null;
    UI.current = view;
    const main = U.el('main-view');
    U.el('app').setAttribute('data-view', view);

    // Aktive Navigation hervorheben.
    U.qsa('.nav-link').forEach((b) =>
      b.classList.toggle('active', b.dataset.nav === view));
    U.qsa('.bn-item').forEach((b) =>
      b.classList.toggle('active', b.dataset.nav === view));

    main.scrollTop = 0;
    try {
      switch (view) {
        case 'day':         await UI.renderDay(main); break;
        case 'year':        await UI.renderYear(main); break;
        case 'month':       await UI.renderMonth(main); break;
        case 'week':        await UI.renderWeek(main); break;
        case 'notes':       await UI.renderNotes(main); break;
        case 'collections': await UI.renderCollections(main); break;
        case 'tasks':       await UI.renderTasks(main); break;
        case 'search':      await UI.renderSearch(main); break;
        case 'settings':    await UI.renderSettings(main); break;
        default:            await UI.renderDay(main); break;
      }
    } catch (e) {
      warn('Render-Fehler', e);
      main.innerHTML = '';
      main.appendChild(U.make('div', { class: 'empty',
        text: 'Ein Fehler ist aufgetreten: ' + e.message }));
    }

    // Swipe-Animation der Tagesansicht.
    if (swipeDir) {
      main.classList.remove('swipe-anim-left', 'swipe-anim-right');
      void main.offsetWidth;                       // Reflow erzwingen
      main.classList.add(swipeDir === 'left'
        ? 'swipe-anim-left' : 'swipe-anim-right');
    }

    // Mobile: Sidebar nach Navigation einklappen.
    if (window.matchMedia('(max-width: 640px)').matches) {
      U.el('app').classList.add('sidebar-collapsed');
    }
  },

  /* --- Modal-Steuerung -------------------------------------------------- */
  openModal(title, contentNode) {
    const root = U.el('modal-root');
    const body = U.el('modal-content');
    body.innerHTML = '';
    if (title) body.appendChild(U.make('h2', { text: title }));
    body.appendChild(contentNode);
    root.hidden = false;
  },
  closeModal() { U.el('modal-root').hidden = true; },
  openHelp() { U.el('help-overlay').hidden = false; },
  closeHelp() { U.el('help-overlay').hidden = true; },

  /* --- Schnellnotiz-Modal (FAB / Tastaturkürzel n / Share Target) ------- */
  async openQuickNote(prefill) {
    const ta = U.make('textarea', {
      placeholder: 'Schnellnotiz … (landet im Rapid Log von heute)',
      rows: '4'
    });
    if (prefill) ta.value = prefill;

    const symSelect = U.make('select', {});
    RL_SYMBOLS.forEach((s) =>
      symSelect.appendChild(U.make('option', { value: s.sym },
        `${s.sym}  ${s.name}`)));

    const save = U.make('button', { class: 'btn btn-primary btn-block',
      text: 'In heutigen Rapid Log eintragen' });
    save.addEventListener('click', async () => {
      const text = ta.value.trim();
      if (!text) { U.toast('Bitte etwas eingeben', 'warn'); return; }
      const day = await DB.getDay(U.today());
      day.rapid_logging.push({
        symbol: symSelect.value,
        content: text,
        timestamp: U.nowIso(),
        project_id: null,
        person_id: null
      });
      await DB.saveDay(day);
      UI.closeModal();
      U.toast('Schnellnotiz gespeichert', 'ok');
      if (UI.current === 'day' && Calendar.state.day === U.today()) {
        UI.render('day');
      }
    });

    const box = U.make('div', {}, [
      U.make('div', { class: 'field' }, [
        U.make('label', { text: 'Symbol' }), symSelect
      ]),
      U.make('div', { class: 'field' }, [
        U.make('label', { text: 'Text' }), ta
      ]),
      save
    ]);
    UI.openModal('Schnellnotiz', box);
    setTimeout(() => ta.focus(), 80);
  },

  /* --- Aufgaben-Modal (neue Aufgabe für beliebigen Tag) ----------------- */
  async openTaskModal(targetYmd, eventId) {
    const projects = await DB.getAll('projects');
    const people = await DB.getAll('people');

    const text = U.make('input', { type: 'text',
      placeholder: 'Was ist zu tun?' });
    const due = U.make('input', { type: 'date', value: targetYmd || '' });

    const projSel = U.make('select', {});
    projSel.appendChild(U.make('option', { value: '' }, '— Projekt —'));
    projects.forEach((p) =>
      projSel.appendChild(U.make('option', { value: p.id }, p.name)));

    const persSel = U.make('select', {});
    persSel.appendChild(U.make('option', { value: '' }, '— Person —'));
    people.forEach((p) =>
      persSel.appendChild(U.make('option', { value: p.id }, p.name)));

    const recSel = U.make('select', {});
    [['', 'Nicht wiederkehrend'], ['daily', 'Täglich'],
     ['weekly', 'Wöchentlich'], ['monthly', 'Monatlich']]
      .forEach(([v, l]) => recSel.appendChild(U.make('option', { value: v }, l)));

    const save = U.make('button', { class: 'btn btn-primary btn-block',
      text: 'Aufgabe anlegen' });
    save.addEventListener('click', async () => {
      const txt = text.value.trim();
      if (!txt) { U.toast('Bitte einen Text eingeben', 'warn'); return; }
      const dayId = due.value || targetYmd || U.today();
      const day = await DB.getDay(dayId);
      day.tasks.push({
        id: U.uuid(),
        text: txt,
        done: false,
        due_date: due.value || null,
        project_id: projSel.value || null,
        person_id: persSel.value || null,
        recurring: recSel.value || null,
        last_completed: null,
        external_event_id: eventId || null
      });
      await DB.saveDay(day);
      if (recSel.value) await Recurring.generate();
      UI.closeModal();
      U.toast('Aufgabe angelegt', 'ok');
      UI.render(UI.current);
    });

    const box = U.make('div', {}, [
      U.make('div', { class: 'field' }, [
        U.make('label', { text: 'Aufgabe' }), text]),
      U.make('div', { class: 'field' }, [
        U.make('label', { text: 'Fälligkeitsdatum' }), due]),
      U.make('div', { class: 'inline-fields' }, [
        U.make('div', { class: 'field' }, [
          U.make('label', { text: 'Projekt' }), projSel]),
        U.make('div', { class: 'field' }, [
          U.make('label', { text: 'Person' }), persSel])]),
      U.make('div', { class: 'field' }, [
        U.make('label', { text: 'Wiederholung' }), recSel]),
      save
    ]);
    UI.openModal('Neue Aufgabe', box);
    setTimeout(() => text.focus(), 80);
  },

  /* --- Aufgaben-Bearbeiten-Modal --------------------------------------- */
  async openTaskEditModal(task, day) {
    const projects = await DB.getAll('projects');
    const people = await DB.getAll('people');

    const text = U.make('input', { type: 'text', value: task.text || '',
      placeholder: 'Was ist zu tun?' });
    const due = U.make('input', { type: 'date', value: task.due_date || '' });

    const projSel = U.make('select', {});
    projSel.appendChild(U.make('option', { value: '' }, '— Projekt —'));
    projects.forEach((p) => {
      const opt = U.make('option', { value: p.id }, p.name);
      if (p.id === task.project_id) opt.selected = true;
      projSel.appendChild(opt);
    });

    const persSel = U.make('select', {});
    persSel.appendChild(U.make('option', { value: '' }, '— Person —'));
    people.forEach((p) => {
      const opt = U.make('option', { value: p.id }, p.name);
      if (p.id === task.person_id) opt.selected = true;
      persSel.appendChild(opt);
    });

    const recSel = U.make('select', {});
    [['', 'Nicht wiederkehrend'], ['daily', 'Täglich'],
     ['weekly', 'Wöchentlich'], ['monthly', 'Monatlich']]
      .forEach(([v, l]) => {
        const opt = U.make('option', { value: v }, l);
        if (v === (task.recurring || '')) opt.selected = true;
        recSel.appendChild(opt);
      });

    const doneCb = U.make('input', { type: 'checkbox' });
    doneCb.checked = !!task.done;

    /* Wenn das Datum verändert wird, muss der Task ggf. den Tages-Datensatz
       wechseln — wir holen das beim Speichern nach. */
    const save = U.make('button', { class: 'btn btn-primary btn-block',
      text: 'Änderungen speichern' });
    save.addEventListener('click', async () => {
      const txt = text.value.trim();
      if (!txt) { U.toast('Bitte einen Text eingeben', 'warn'); return; }

      const newDue = due.value || null;
      // Soll die Aufgabe in einen anderen Tag verschoben werden?
      // Regel: wenn ein neues Datum gesetzt wurde und dieses sich von der
      // aktuellen Day-ID unterscheidet, ziehen wir den Eintrag um.
      const moveToDay = (newDue && newDue !== day.id) ? newDue : null;

      task.text = txt;
      task.due_date = newDue;
      task.project_id = projSel.value || null;
      task.person_id = persSel.value || null;
      const oldRecurring = task.recurring;
      task.recurring = recSel.value || null;
      const wasDone = task.done;
      task.done = doneCb.checked;
      if (task.done && !wasDone) {
        Mobile.haptic();
        if (task.recurring) task.last_completed = U.today();
      }
      if (!task.done) task.last_completed = null;

      if (moveToDay) {
        // Aus aktuellem Tag entfernen, in neuen Tag einfügen.
        const i = day.tasks.indexOf(task);
        if (i > -1) day.tasks.splice(i, 1);
        await DB.saveDay(day);
        const target = await DB.getDay(moveToDay);
        target.tasks.push(task);
        await DB.saveDay(target);
      } else {
        await DB.saveDay(day);
      }

      if (task.recurring && task.recurring !== oldRecurring) {
        await Recurring.generate();
      }
      UI.closeModal();
      U.toast('Aufgabe gespeichert', 'ok');
      UI.render(UI.current);
    });

    const del = U.make('button', { class: 'btn btn-danger btn-block',
      style: 'margin-top:.5rem', text: 'Aufgabe löschen' });
    del.addEventListener('click', async () => {
      const i = day.tasks.indexOf(task);
      if (i > -1) day.tasks.splice(i, 1);
      await DB.saveDay(day);
      UI.closeModal();
      U.toast('Aufgabe gelöscht');
      UI.render(UI.current);
    });

    const doneRow = U.make('label', { class: 'check-row',
      style: 'display:flex;align-items:center;gap:.5rem;margin:.4rem 0' },
      [doneCb, document.createTextNode(' Aufgabe ist erledigt')]);

    const box = U.make('div', {}, [
      U.make('div', { class: 'field' }, [
        U.make('label', { text: 'Aufgabe' }), text]),
      doneRow,
      U.make('div', { class: 'field' }, [
        U.make('label', { text: 'Fälligkeitsdatum' }), due]),
      U.make('div', { class: 'inline-fields' }, [
        U.make('div', { class: 'field' }, [
          U.make('label', { text: 'Projekt' }), projSel]),
        U.make('div', { class: 'field' }, [
          U.make('label', { text: 'Person' }), persSel])]),
      U.make('div', { class: 'field' }, [
        U.make('label', { text: 'Wiederholung' }), recSel]),
      save,
      del
    ]);
    UI.openModal('Aufgabe bearbeiten', box);
    setTimeout(() => text.focus(), 80);
  },

  /* ====================================================================== *
   *  TAGESANSICHT (Hauptansicht)
   * ====================================================================== */
  async renderDay(main) {
    const ymd = Calendar.state.day;
    const day = await DB.getDay(ymd);
    const projects = await DB.getAll('projects');
    const people = await DB.getAll('people');
    const extEvents = await ExtCal.eventsForDay(ymd);
    const isToday = ymd === U.today();

    main.innerHTML = '';

    /* --- Kopf mit Datumsnavigation --- */
    const prev = U.make('button', { class: 'nav-arrow', title: 'Vorheriger Tag (j)' }, '‹');
    const next = U.make('button', { class: 'nav-arrow', title: 'Nächster Tag (k)' }, '›');
    const todayBtn = U.make('button', { class: 'btn btn-sm', text: 'Heute' });
    const picker = U.make('input', { type: 'date', class: 'date-pick', value: ymd });
    prev.addEventListener('click', () => {
      Calendar.state.day = U.addDays(ymd, -1); UI.render('day', 'right');
    });
    next.addEventListener('click', () => {
      Calendar.state.day = U.addDays(ymd, 1); UI.render('day', 'left');
    });
    todayBtn.addEventListener('click', () => {
      Calendar.state.day = U.today(); UI.render('day');
    });
    picker.addEventListener('change', () => {
      if (picker.value) { Calendar.state.day = picker.value; UI.render('day'); }
    });
    const printBtn = U.make('button', { class: 'btn btn-sm no-print', text: '🖨 Drucken' });
    printBtn.addEventListener('click', () => window.print());

    main.appendChild(U.make('div', { class: 'view-head' }, [
      U.make('div', {}, [
        U.make('h1', { class: 'view-title',
          text: U.prettyDate(ymd) + (isToday ? '  · heute' : '') }),
        U.make('div', { class: 'view-sub no-print',
          text: 'Tippe links/rechts wischen für Tageswechsel' })
      ]),
      U.make('div', { class: 'date-nav no-print' }, [prev, picker, next, todayBtn, printBtn])
    ]));

    /* --- Externe Termine heute --- */
    if (extEvents.length) {
      const extBox = U.make('div', { class: 'card' });
      extBox.appendChild(U.make('div', { class: 'card-title' }, 'Externe Termine heute'));
      for (const e of extEvents) {
        const card = U.make('div', { class: 'ext-event' }, [
          U.make('div', { class: 'ext-title', text: e.title }),
          U.make('div', { class: 'ext-time',
            text: e.allDay ? 'Ganztägig'
              : `${U.timeOf(e.start)}–${U.timeOf(e.end)}`
                + (e.location ? '  ·  ' + e.location : '') })
        ]);
        card.addEventListener('click', () => UI.openExtEventModal(e));
        extBox.appendChild(card);
      }
      main.appendChild(extBox);
    }

    /* --- Journal: Block-Editor (Rapid Logging + Notizen vereint) --- */
    main.appendChild(UI._journalCard(day, projects, people));

    /* --- Aufgabenliste --- */
    main.appendChild(await UI._tasksCard(day, projects, people));

    /* --- Backlinks dieses Tages --- */
    main.appendChild(UI._dayBacklinksCard(day));
  },

  /* ====================================================================== *
   *  JOURNAL-BLOCK-EDITOR (vereint Rapid Logging & Tagesnotizen)
   * ---------------------------------------------------------------------- *
   *  Jede Zeile ist ein Block mit eigenem Symbol. Enter erzeugt einen neuen
   *  Block, Backspace in einer leeren Zeile löscht sie. [[ und @ öffnen eine
   *  Autovervollständigung, über die sich Projekte/Personen auch direkt
   *  neu anlegen lassen.
   * ====================================================================== */
  _journalCard(day, projects, people) {
    // Lokale, veränderbare Listen — werden bei Inline-Erstellung erweitert.
    const projectList = projects.slice();
    const peopleList = people.slice();

    const card = U.make('div', { class: 'card journal-card' });
    card.appendChild(U.make('div', { class: 'card-title' }, 'Journal'));
    card.appendChild(U.make('div', { class: 'journal-hint no-print', html:
      'Jede Zeile ist ein Block. <kbd>Enter</kbd> = neuer Block, '
      + '<kbd>Shift</kbd>+<kbd>Enter</kbd> = Zeilenumbruch im Block, '
      + '<kbd>⌫</kbd> in leerer Zeile löscht sie. Klick auf das Symbol ändert '
      + 'den Typ. Mit <b>[[</b> Projekte und <b>@</b> Personen verknüpfen — '
      + 'noch nicht vorhandene lassen sich direkt anlegen.' }));

    const listEl = U.make('div', { class: 'block-list' });
    card.appendChild(listEl);

    if (!day.rapid_logging) day.rapid_logging = [];

    /* Debounced Speichern (inkl. Backlink-Aktualisierung). */
    const persist = U.debounce(async () => {
      await DB.saveDay(day);
      await Backlinks.refreshKnowledgeBacklinks();
    }, 600);

    /* Neuen Block-Datensatz erzeugen. */
    const newBlock = (symbol) => ({
      id: U.uuid(), symbol: symbol || '-', content: '',
      timestamp: U.nowIso(), project_id: null, person_id: null
    });

    /* Symbol-Auswahlmenü öffnen. */
    const openSymbolMenu = (anchorBtn, block, glyphEl) => {
      UI._closePopups();
      const menu = U.make('div', { class: 'popmenu symbol-menu' });
      RL_SYMBOLS.forEach((s) => {
        const item = U.make('button', {
          class: 'popmenu-item' + (s.sym === block.symbol ? ' active' : '') }, [
          U.make('span', { class: 'pm-glyph', text: s.sym }),
          U.make('span', { class: 'pm-label', text: s.name })
        ]);
        item.addEventListener('click', () => {
          block.symbol = s.sym;
          glyphEl.textContent = s.sym;
          UI._closePopups();
          persist();
        });
        menu.appendChild(item);
      });
      UI._showPopup(menu, anchorBtn);
    };

    /* Verknüpfungs-Chips eines Blocks rendern. */
    const renderChips = (block, chipEl) => {
      chipEl.innerHTML = '';
      Mentions.projectsIn(block.content, projectList).forEach((p) => {
        const c = U.make('span', { class: 'block-chip',
          style: `border-left:3px solid ${p.farbe}`, text: p.name });
        c.addEventListener('click', () => UI.openReferenceModal(p.name));
        chipEl.appendChild(c);
      });
      Mentions.peopleIn(block.content, peopleList).forEach((p) => {
        const c = U.make('span', { class: 'block-chip', text: '@' + p.name });
        c.addEventListener('click', () => UI.openReferenceModal(p.name));
        chipEl.appendChild(c);
      });
    };

    /* Block in eine echte Aufgabe übernehmen (verknüpft, Block bleibt). */
    const blockToTask = async (block) => {
      const text = (block.content || '').trim();
      if (!text) { U.toast('Block ist leer', 'warn'); return; }
      // Vorhandene Aufgabe mit identischem _fromBlock vermeiden.
      const already = (day.tasks || []).some((t) => t._fromBlock === block.id);
      if (already) {
        U.toast('Aufgabe ist bereits verknüpft', 'warn');
        return;
      }
      day.tasks = day.tasks || [];
      day.tasks.push({
        id: U.uuid(),
        text,
        done: false,
        due_date: null,
        project_id: null,
        person_id: null,
        recurring: null,
        last_completed: null,
        external_event_id: null,
        _fromBlock: block.id
      });
      await DB.saveDay(day);
      U.toast('Aufgabe erstellt', 'ok');
      UI.render('day');
    };

    /* Block in der Reihenfolge verschieben. */
    const moveBlock = async (block, delta) => {
      const arr = day.rapid_logging;
      const i = arr.indexOf(block);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= arr.length) return;
      arr.splice(i, 1);
      arr.splice(j, 0, block);
      await DB.saveDay(day);
      // Nur die Reihenfolge im DOM neu sortieren — keinen kompletten Re-Render.
      const rows = U.qsa('.block-row', listEl);
      const moved = rows[i];
      const ref = delta > 0 ? rows[j].nextElementSibling : rows[j];
      listEl.insertBefore(moved, ref);
      const inp = moved.querySelector('.block-input');
      if (inp) inp.focus();
    };

    /* Eine Block-Zeile bauen. */
    const makeRow = (block) => {
      const row = U.make('div', { class: 'block-row' });

      const glyph = U.make('span', { class: 'bg-glyph', text: block.symbol || '-' });
      const symBtn = U.make('button', { class: 'block-symbol',
        title: 'Block-Typ ändern' }, [glyph]);
      symBtn.addEventListener('click', () => openSymbolMenu(symBtn, block, glyph));

      const input = U.make('textarea', { class: 'block-input', rows: '1',
        placeholder: 'Schreib etwas …' });
      input.value = block.content || '';

      const chipEl = U.make('div', { class: 'block-chips' });
      renderChips(block, chipEl);

      /* Aktions-Knöpfe rechts (rauf/runter/in Aufgabe/löschen). */
      const upBtn = U.make('button', { class: 'block-act no-print',
        title: 'Nach oben' }, '↑');
      upBtn.addEventListener('click', () => moveBlock(block, -1));
      const dnBtn = U.make('button', { class: 'block-act no-print',
        title: 'Nach unten' }, '↓');
      dnBtn.addEventListener('click', () => moveBlock(block, 1));
      const taskBtn = U.make('button', { class: 'block-act no-print',
        title: 'Als Aufgabe übernehmen' }, '→☐');
      taskBtn.addEventListener('click', () => blockToTask(block));

      const del = U.make('button', { class: 'block-del no-print',
        title: 'Block löschen' }, '✕');

      /* Höhe automatisch an den Inhalt anpassen (Zeilenumbruch statt Scrollen). */
      const autoGrow = () => {
        input.style.height = 'auto';
        input.style.height = input.scrollHeight + 'px';
      };

      const onInput = () => {
        block.content = input.value;
        renderChips(block, chipEl);
        autoGrow();
        persist();
      };

      input.addEventListener('input', () => {
        onInput();
        UI._checkAutocomplete(input, {
          projects: projectList, people: peopleList,
          onPick: onInput,
          onCreateProject: (p) => projectList.push(p),
          onCreatePerson: (p) => peopleList.push(p)
        });
      });

      input.addEventListener('keydown', (e) => {
        // Offene Autovervollständigung fängt Navigationstasten zuerst ab.
        if (UI._acVisible() && UI._acHandleKey(e)) return;

        if (e.key === 'Enter' && !e.shiftKey) {
          // Enter = neuer Block. Shift+Enter = Zeilenumbruch im selben Block.
          e.preventDefault();
          const idx = day.rapid_logging.indexOf(block);
          const nb = newBlock(block.symbol);
          day.rapid_logging.splice(idx + 1, 0, nb);
          const nrow = makeRow(nb);
          row.after(nrow);
          nrow.querySelector('.block-input').focus();
          persist();
        } else if (e.key === 'Backspace' && input.value === ''
                   && input.selectionStart === 0) {
          if (day.rapid_logging.length <= 1) return;   // letzten Block behalten
          e.preventDefault();
          const idx = day.rapid_logging.indexOf(block);
          day.rapid_logging.splice(idx, 1);
          const prev = row.previousElementSibling;
          row.remove();
          if (prev) {
            const pin = prev.querySelector('.block-input');
            pin.focus();
            pin.setSelectionRange(pin.value.length, pin.value.length);
          }
          persist();
        } else if (e.key === 'ArrowUp' && input.selectionStart === 0) {
          // Nur am Textanfang in den vorherigen Block springen.
          const prev = row.previousElementSibling;
          if (prev) {
            e.preventDefault();
            const pin = prev.querySelector('.block-input');
            pin.focus();
            pin.setSelectionRange(pin.value.length, pin.value.length);
          }
        } else if (e.key === 'ArrowDown'
                   && input.selectionStart === input.value.length) {
          // Nur am Textende in den nächsten Block springen.
          const nx = row.nextElementSibling;
          if (nx && nx.querySelector('.block-input')) {
            e.preventDefault();
            const nin = nx.querySelector('.block-input');
            nin.focus();
            nin.setSelectionRange(0, 0);
          }
        }
      });

      input.addEventListener('blur', () => {
        // Kurze Verzögerung, damit Klicks im Popup noch ankommen.
        setTimeout(() => { if (!UI._acVisible()) UI._closePopups(); }, 160);
      });

      // Anfangshöhe setzen, sobald die Zeile im DOM hängt.
      requestAnimationFrame(autoGrow);

      del.addEventListener('click', () => {
        const idx = day.rapid_logging.indexOf(block);
        if (idx > -1) day.rapid_logging.splice(idx, 1);
        row.remove();
        if (!day.rapid_logging.length) {
          const nb = newBlock('-');
          day.rapid_logging.push(nb);
          listEl.appendChild(makeRow(nb));
        }
        persist();
      });

      row.appendChild(symBtn);
      row.appendChild(U.make('div', { class: 'block-body' }, [input, chipEl]));
      row.appendChild(U.make('div', { class: 'block-actions no-print' },
        [upBtn, dnBtn, taskBtn, del]));
      return row;
    };

    // Mindestens ein Block, jeder mit ID.
    if (!day.rapid_logging.length) day.rapid_logging.push(newBlock('-'));
    day.rapid_logging.forEach((b) => {
      if (!b.id) b.id = U.uuid();
      listEl.appendChild(makeRow(b));
    });

    /* "+ Neuer Block"-Knopf. */
    const addBtn = U.make('button', { class: 'btn btn-sm no-print',
      style: 'margin-top:.7rem', text: '+ Neuer Block' });
    addBtn.addEventListener('click', () => {
      const nb = newBlock('-');
      day.rapid_logging.push(nb);
      const nrow = makeRow(nb);
      listEl.appendChild(nrow);
      nrow.querySelector('.block-input').focus();
      persist();
    });
    card.appendChild(addBtn);

    return card;
  },

  /* ====================================================================== *
   *  Popup-Infrastruktur (Symbol-Menü & Autovervollständigung)
   * ====================================================================== */
  _popupEl: null,
  _ac: null,

  _ensurePopupHost() {
    if (UI._popupEl) return;
    UI._popupEl = U.make('div', { class: 'popup-host', hidden: true });
    document.body.appendChild(UI._popupEl);
    // Klick außerhalb schließt das Popup.
    document.addEventListener('click', (e) => {
      if (!UI._popupEl || UI._popupEl.hidden) return;
      if (UI._popupEl.contains(e.target)) return;
      if (e.target.closest && e.target.closest('.block-symbol')) return;
      UI._closePopups();
    }, true);
    window.addEventListener('resize', () => UI._closePopups());
  },

  _showPopup(node, anchor) {
    UI._ensurePopupHost();
    UI._popupEl.innerHTML = '';
    UI._popupEl.appendChild(node);
    UI._popupEl.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = 260;
    let left = Math.min(r.left, window.innerWidth - w - 8);
    left = Math.max(8, left);
    UI._popupEl.style.left = left + 'px';
    // Unterhalb des Ankers, oder darüber, falls unten kein Platz ist.
    const below = window.innerHeight - r.bottom;
    if (below < 240) UI._popupEl.style.top = '';
    else UI._popupEl.style.top = (r.bottom + 4) + 'px';
    if (below < 240) {
      UI._popupEl.style.bottom = (window.innerHeight - r.top + 4) + 'px';
    } else {
      UI._popupEl.style.bottom = '';
    }
  },

  _closePopups() {
    if (UI._popupEl) { UI._popupEl.hidden = true; UI._popupEl.innerHTML = ''; }
    UI._ac = null;
  },

  _acVisible() {
    return !!(UI._ac && UI._popupEl && !UI._popupEl.hidden);
  },

  /* Farbe für ein neu angelegtes Projekt. */
  _pickColor() {
    const palette = ['#c8553d', '#3498db', '#2ecc71', '#9b59b6', '#e67e22',
                     '#16a085', '#e74c3c', '#2c7da0', '#8e7cc3', '#d4a017'];
    return palette[Math.floor(Math.random() * palette.length)];
  },

  /* Prüft den Text vor dem Cursor auf einen [[- oder @-Auslöser. */
  _checkAutocomplete(input, ctx) {
    const pos = input.selectionStart;
    const before = input.value.slice(0, pos);
    let type = null, token = '', start = -1, m;

    m = before.match(/\[\[([^\]\[]*)$/);
    if (m) { type = 'wiki'; token = m[1]; start = before.length - m[0].length; }
    else {
      // @ nur am Zeilenanfang oder nach einem Leerzeichen — so löst eine
      // E-Mail-Adresse wie "name@firma" die Personensuche nicht aus.
      m = before.match(/(^|\s)@([A-Za-zÄÖÜäöüß0-9_.\-]{0,30})$/);
      if (m) { type = 'at'; token = m[2]; start = before.length - token.length - 1; }
    }
    if (!type) { UI._closePopups(); return; }

    const ql = token.trim().toLowerCase();
    const pool = type === 'wiki' ? ctx.projects : ctx.people;
    let items = pool
      .filter((p) => p.name && p.name.toLowerCase().includes(ql))
      .slice(0, 8)
      .map((p) => ({
        label: p.name,
        glyph: type === 'wiki' ? '◧' : '@',
        sub: type === 'wiki' ? 'Projekt' : 'Person',
        value: p.name
      }));

    // Option zum direkten Neu-Anlegen.
    const exact = pool.some((p) => (p.name || '').toLowerCase() === ql);
    if (ql && !exact) {
      items.unshift({
        label: token.trim(), glyph: '＋',
        sub: type === 'wiki' ? 'Neues Projekt anlegen' : 'Neue Person anlegen',
        value: token.trim(), create: true
      });
    }
    if (!items.length) { UI._closePopups(); return; }

    UI._ac = { input, type, start, items, active: 0, ctx };
    UI._renderAc();
  },

  /* Zeichnet das Autocomplete-Menü. */
  _renderAc() {
    const ac = UI._ac;
    if (!ac) return;
    const menu = U.make('div', { class: 'popmenu autocomplete-menu' });
    ac.items.forEach((it, i) => {
      const row = U.make('button', {
        class: 'popmenu-item' + (i === ac.active ? ' active' : '')
          + (it.create ? ' is-create' : '') }, [
        U.make('span', { class: 'pm-glyph', text: it.glyph }),
        U.make('span', { class: 'pm-label', text: it.label }),
        U.make('span', { class: 'pm-sub', text: it.sub })
      ]);
      // mousedown statt click: verhindert das Blur des Eingabefeldes.
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        UI._acPick(i);
      });
      menu.appendChild(row);
    });
    UI._showPopup(menu, ac.input);
  },

  /* Übernimmt einen Autocomplete-Vorschlag (legt ggf. neu an). */
  async _acPick(i) {
    const ac = UI._ac;
    if (!ac) return;
    const it = ac.items[i];
    const input = ac.input;

    if (it.create) {
      if (ac.type === 'wiki') {
        const proj = {
          id: U.uuid(), name: it.value, farbe: UI._pickColor(),
          status: 'aktiv', description: '', created_at: U.nowIso()
        };
        await DB.put('projects', proj);
        if (ac.ctx.onCreateProject) ac.ctx.onCreateProject(proj);
        U.toast('Projekt „' + proj.name + '" angelegt', 'ok');
      } else {
        const pers = {
          id: U.uuid(), name: it.value, email: '', tags: [],
          created_at: U.nowIso()
        };
        await DB.put('people', pers);
        if (ac.ctx.onCreatePerson) ac.ctx.onCreatePerson(pers);
        U.toast('Person „' + pers.name + '" angelegt', 'ok');
      }
    }

    // Vollständige Verknüpfung in den Text einsetzen.
    const insert = ac.type === 'wiki' ? `[[${it.value}]] ` : `@${it.value} `;
    const caret = input.selectionStart;
    const v = input.value;
    input.value = v.slice(0, ac.start) + insert + v.slice(caret);
    const np = ac.start + insert.length;
    input.setSelectionRange(np, np);
    input.focus();

    UI._closePopups();
    if (ac.ctx.onPick) ac.ctx.onPick();
  },

  /* Tastatursteuerung im Autocomplete-Menü. */
  _acHandleKey(e) {
    const ac = UI._ac;
    if (!ac) return false;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      ac.active = (ac.active + 1) % ac.items.length;
      UI._renderAc(); return true;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      ac.active = (ac.active - 1 + ac.items.length) % ac.items.length;
      UI._renderAc(); return true;
    }
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      UI._acPick(ac.active); return true;
    }
    if (e.key === 'Escape') { UI._closePopups(); return true; }
    return false;
  },

  /* --- Aufgaben-Karte des Tages --- */
  async _tasksCard(day, projects, people) {
    const card = U.make('div', { class: 'card' });
    const addBtn = U.make('button', { class: 'btn btn-sm btn-primary no-print',
      text: '+ Aufgabe' });
    addBtn.addEventListener('click', () => UI.openTaskModal(day.id));
    card.appendChild(U.make('div', { class: 'card-title' }, [
      document.createTextNode('Aufgaben'), addBtn
    ]));

    if (!day.tasks.length) {
      card.appendChild(U.make('div', { class: 'empty',
        text: 'Keine Aufgaben. Drücke „t“ oder „+ Aufgabe“.' }));
      return card;
    }

    day.tasks.forEach((t) => {
      card.appendChild(UI._taskRow(t, day, projects, people));
    });
    return card;
  },

  /* --- Einzelne Aufgaben-Zeile (wiederverwendbar) --- */
  _taskRow(t, day, projects, people) {
    const proj = projects.find((p) => p.id === t.project_id);
    const pers = people.find((p) => p.id === t.person_id);

    const cb = U.make('input', { type: 'checkbox', class: 'task-check' });
    cb.checked = !!t.done;
    cb.addEventListener('change', async () => {
      t.done = cb.checked;
      if (t.done) {
        Mobile.haptic();                       // Vibration beim Erledigen
        if (t.recurring) t.last_completed = U.today();
      }
      await DB.saveDay(day);
      UI.render(UI.current);
    });

    const info = U.make('div', { class: 'task-info' });
    if (proj) info.appendChild(U.make('span', { class: 'chip',
      style: `border-left:3px solid ${proj.farbe}`, text: proj.name }));
    if (pers) info.appendChild(U.make('span', { class: 'chip', text: '@' + pers.name }));
    if (t.due_date) {
      const over = !t.done && t.due_date < U.today();
      info.appendChild(U.make('span', { class: 'chip' + (over ? ' due-over' : ''),
        text: 'fällig ' + U.shortDate(t.due_date) }));
    }
    if (t.recurring) info.appendChild(U.make('span', { class: 'chip recurring',
      text: '↻ ' + t.recurring }));
    if (t.external_event_id) {
      const chip = U.make('span', { class: 'chip ext-link', text: '📅 Termin' });
      chip.addEventListener('click', async () => {
        const ev = await DB.get('external_events', t.external_event_id);
        if (ev) UI.openExtEventModal(ev);
        else {
          info.appendChild(U.make('span', { class: 'badge-warn',
            text: ' ⚠ Termin gelöscht' }));
          U.toast('Verknüpfter Termin existiert nicht mehr', 'warn');
        }
      });
      info.appendChild(chip);
    }

    const edit = U.make('button', { class: 'rl-del no-print',
      title: 'Bearbeiten' }, '✎');
    edit.addEventListener('click', () => UI.openTaskEditModal(t, day));

    const del = U.make('button', { class: 'rl-del no-print', title: 'Löschen' }, '✕');
    del.addEventListener('click', async () => {
      const i = day.tasks.indexOf(t);
      if (i > -1) day.tasks.splice(i, 1);
      await DB.saveDay(day);
      UI.render(UI.current);
    });

    const text = U.make('div', { class: 'task-text task-text-click',
      text: t.text, title: 'Klicken zum Bearbeiten' });
    text.addEventListener('click', () => UI.openTaskEditModal(t, day));

    return U.make('div', { class: 'task-row' + (t.done ? ' done' : '') }, [
      cb,
      U.make('div', { class: 'task-main' }, [text, info]),
      edit,
      del
    ]);
  },

  /* --- Backlinks-Karte des Tages --- */
  _dayBacklinksCard(day) {
    const card = U.make('div', { class: 'card' });
    card.appendChild(U.make('div', { class: 'card-title' }, 'Backlinks dieses Tages'));
    const text = (day.rapid_logging || []).map((r) => r.content || '').join(' ');
    const wikis = [...new Set(Backlinks.wikiLinks(text))];
    const ats = [...new Set(Backlinks.mentions(text))];

    if (!wikis.length && !ats.length) {
      card.appendChild(U.make('div', { class: 'empty',
        text: 'Keine [[Verknüpfungen]] oder @Erwähnungen an diesem Tag.' }));
      return card;
    }
    const list = U.make('div', { class: 'backlink-list' });
    wikis.forEach((w) => list.appendChild(U.make('div', { class: 'backlink' },
      [U.make('span', { class: 'bl-syntax', text: '[[ ]] ' }),
       document.createTextNode(w)])));
    ats.forEach((a) => list.appendChild(U.make('div', { class: 'backlink' },
      [U.make('span', { class: 'bl-syntax', text: '@ ' }),
       document.createTextNode(a)])));
    card.appendChild(list);
    return card;
  },

  /* Macht [[Wiki-Links]] in einer Vorschau klickbar. */
  _bindWikiLinks(root) {
    U.qsa('.wikilink', root).forEach((a) => {
      a.addEventListener('click', () => {
        const name = a.dataset.link || a.dataset.mention;
        UI.openReferenceModal(name);
      });
    });
  }
};
/* ========================================================================== *
 *  UI (Fortsetzung): Kalenderansichten — Jahr / Monat / Woche
 * ========================================================================== */

/* --- JAHRESKALENDER mit Aktivitäts-Heatmap ----------------------------- */
UI.renderYear = async function (main) {
  const year = Calendar.state.year;
  const heat = await Heatmap.buildYear(year);

  main.innerHTML = '';
  const prev = U.make('button', { class: 'nav-arrow' }, '‹');
  const next = U.make('button', { class: 'nav-arrow' }, '›');
  prev.addEventListener('click', () => { Calendar.state.year--; UI.render('year'); });
  next.addEventListener('click', () => { Calendar.state.year++; UI.render('year'); });

  main.appendChild(U.make('div', { class: 'view-head' }, [
    U.make('h1', { class: 'view-title', text: 'Jahr ' + year }),
    U.make('div', { class: 'date-nav no-print' }, [prev, next])
  ]));

  const grid = U.make('div', { class: 'year-grid' });
  for (let m = 0; m < 12; m++) {
    const card = U.make('div', { class: 'month-card' });
    card.appendChild(U.make('h3', { text: U.MONTHS_SHORT[m] }));

    // 31-Zellen-Heatmap-Zeile pro Monat.
    const hm = U.make('div', { class: 'heatmap' });
    const dim = U.daysInMonth(year, m);
    for (let d = 1; d <= 31; d++) {
      if (d > dim) {
        hm.appendChild(U.make('div', { class: 'heat-cell',
          style: 'visibility:hidden' }));
        continue;
      }
      const ymd = U.ymd(new Date(year, m, d));
      const info = heat[ymd] || { level: 0, hasExt: false };
      const cell = U.make('div', {
        class: 'heat-cell heat-' + info.level + (info.hasExt ? ' has-ext' : ''),
        title: U.shortDate(ymd)
      });
      hm.appendChild(cell);
    }
    card.appendChild(hm);

    // Klick auf Monat -> Monatsansicht.
    card.addEventListener('click', () => {
      Calendar.state.month = { year, m };
      UI.render('month');
    });
    grid.appendChild(card);
  }
  main.appendChild(grid);

  // Legende.
  const legend = U.make('div', { class: 'heat-legend' }, [
    document.createTextNode('weniger ')
  ]);
  for (let l = 0; l <= 4; l++) {
    legend.appendChild(U.make('div', { class: 'heat-cell heat-' + l }));
  }
  legend.appendChild(document.createTextNode(' mehr Aktivität'));
  legend.appendChild(U.make('span', { style: 'margin-left:1rem' },
    [U.make('span', { class: 'ext-dot' }), document.createTextNode(' = externer Termin')]));
  main.appendChild(legend);
};

/* --- MONATSKALENDER ----------------------------------------------------- */
UI.renderMonth = async function (main) {
  const { year, m } = Calendar.state.month;
  const matrix = Calendar.monthMatrix(year, m);
  const days = await DB.getAll('days');
  const ext = await DB.getAll('external_events');
  const dayMap = {};
  days.forEach((d) => { dayMap[d.id] = d; });

  main.innerHTML = '';

  /* Kopf + Navigation */
  const prev = U.make('button', { class: 'nav-arrow' }, '‹');
  const next = U.make('button', { class: 'nav-arrow' }, '›');
  const todayBtn = U.make('button', { class: 'btn btn-sm', text: 'Heute' });
  prev.addEventListener('click', () => {
    Calendar.state.month = m === 0
      ? { year: year - 1, m: 11 } : { year, m: m - 1 };
    UI.render('month');
  });
  next.addEventListener('click', () => {
    Calendar.state.month = m === 11
      ? { year: year + 1, m: 0 } : { year, m: m + 1 };
    UI.render('month');
  });
  todayBtn.addEventListener('click', () => {
    const n = new Date();
    Calendar.state.month = { year: n.getFullYear(), m: n.getMonth() };
    UI.render('month');
  });
  const printBtn = U.make('button', { class: 'btn btn-sm no-print', text: '🖨 Drucken' });
  printBtn.addEventListener('click', () => window.print());

  main.appendChild(U.make('div', { class: 'view-head' }, [
    U.make('h1', { class: 'view-title', text: U.monthLabel(year, m) }),
    U.make('div', { class: 'date-nav no-print' }, [prev, todayBtn, next, printBtn])
  ]));

  /* Aktions-Buttons: Tasks migrieren, Future Log */
  const migrateBtn = U.make('button', { class: 'btn btn-sm', text: '↦ Offene Tasks migrieren' });
  migrateBtn.addEventListener('click', async () => {
    const targetMonth = m === 11 ? { year: year + 1, m: 0 } : { year, m: m + 1 };
    const targetYmd = U.ymd(new Date(targetMonth.year, targetMonth.m, 1));
    const moved = await Calendar.migrateTasks(year, m, targetYmd);
    U.toast(moved
      ? `${moved} Aufgabe(n) in den Folgemonat verschoben`
      : 'Keine offenen Aufgaben ohne Datum gefunden',
      moved ? 'ok' : '');
    UI.render('month');
  });
  const futureBtn = U.make('button', { class: 'btn btn-sm', text: '🔮 Future Log' });
  futureBtn.addEventListener('click', () => UI.openFutureLog());
  main.appendChild(U.make('div', { class: 'btn-row no-print',
    style: 'margin-bottom:1rem' }, [migrateBtn, futureBtn]));

  /* Wochentags-Kopf */
  const grid = U.make('div', { class: 'cal-grid' });
  U.DOW_SHORT.forEach((d) => grid.appendChild(
    U.make('div', { class: 'cal-dow', text: d })));

  /* Tageszellen */
  matrix.forEach((cell) => {
    const data = dayMap[cell.ymd];
    const node = U.make('div', {
      class: 'cal-cell'
        + (cell.inMonth ? '' : ' other-month')
        + (cell.ymd === U.today() ? ' today' : '')
    });

    /* Tagesnummer */
    node.appendChild(U.make('div', { class: 'cal-daynum',
      text: String(cell.day) }));

    /* Task/Block-Indikatoren */
    if (data) {
      const inds = U.make('div', { class: 'cal-indicators' });
      const openTasks = (data.tasks || []).filter((t) => !t.done).length;
      for (let i = 0; i < Math.min(openTasks, 4); i++) {
        inds.appendChild(U.make('span', { class: 'ind-dot ind-task' }));
      }
      const blockCount = (data.rapid_logging || [])
        .filter((b) => (b.content || '').trim()).length;
      if (blockCount) {
        inds.appendChild(U.make('span', { class: 'ind-dot ind-note' }));
      }
      node.appendChild(inds);
      // erste offene Aufgabe als Mini-Text
      const firstTask = (data.tasks || []).find((t) => !t.done);
      if (firstTask) {
        node.appendChild(U.make('div', { class: 'mini-task', text: firstTask.text }));
      }
    }

    /* Externe Termine als gestrichelte Boxen */
    const dayExt = ext.filter((e) => (e.start || '').slice(0, 10) === cell.ymd);
    dayExt.slice(0, 2).forEach((e) => {
      node.appendChild(U.make('div', { class: 'mini-ext', text: e.title }));
    });

    node.addEventListener('click', () => {
      Calendar.state.day = cell.ymd;
      UI.render('day');
    });
    grid.appendChild(node);
  });
  main.appendChild(grid);

  /* Reflexionsfeld am Monatsende — gespeichert als Notiz des letzten Tages */
  const lastYmd = U.ymd(new Date(year, m, U.daysInMonth(year, m)));
  const lastDay = await DB.getDay(lastYmd);
  const reflKey = '__monatsreflexion__';
  const reflBox = U.make('div', { class: 'card', style: 'margin-top:1rem' });
  reflBox.appendChild(U.make('div', { class: 'card-title' }, 'Monatsreflexion'));
  const reflTa = U.make('textarea', {
    rows: '3', placeholder: 'Was lief gut? Was nehme ich mit?'
  });
  // Reflexion separat in den Notizen markiert ablegen.
  const existing = (lastDay.notes || '').split(reflKey);
  reflTa.value = existing.length > 1 ? existing[1].trim() : '';
  reflTa.addEventListener('input', U.debounce(async () => {
    const base = (lastDay.notes || '').split(reflKey)[0].trim();
    lastDay.notes = base + (reflTa.value.trim()
      ? '\n' + reflKey + '\n' + reflTa.value.trim() : '');
    await DB.saveDay(lastDay);
  }, 500));
  reflBox.appendChild(reflTa);
  main.appendChild(reflBox);
};

/* --- WOCHENKALENDER ----------------------------------------------------- */
UI.renderWeek = async function (main) {
  const start = Calendar.state.week;
  const weekDays = Calendar.weekDays(start);
  const days = await DB.getAll('days');
  const ext = await DB.getAll('external_events');
  const dayMap = {};
  days.forEach((d) => { dayMap[d.id] = d; });

  main.innerHTML = '';

  const prev = U.make('button', { class: 'nav-arrow' }, '‹');
  const next = U.make('button', { class: 'nav-arrow' }, '›');
  const todayBtn = U.make('button', { class: 'btn btn-sm', text: 'Heute' });
  prev.addEventListener('click', () => {
    Calendar.state.week = U.addDays(start, -7); UI.render('week');
  });
  next.addEventListener('click', () => {
    Calendar.state.week = U.addDays(start, 7); UI.render('week');
  });
  todayBtn.addEventListener('click', () => {
    Calendar.state.week = U.weekStart(U.today()); UI.render('week');
  });
  const printBtn = U.make('button', { class: 'btn btn-sm no-print', text: '🖨 Drucken' });
  printBtn.addEventListener('click', () => window.print());

  main.appendChild(U.make('div', { class: 'view-head' }, [
    U.make('h1', { class: 'view-title',
      text: `Woche ${U.shortDate(start)} – ${U.shortDate(weekDays[6])}` }),
    U.make('div', { class: 'date-nav no-print' }, [prev, todayBtn, next, printBtn])
  ]));

  const grid = U.make('div', { class: 'week-grid' });
  weekDays.forEach((ymd, i) => {
    const data = dayMap[ymd];
    const col = U.make('div', {
      class: 'week-col' + (ymd === U.today() ? ' today' : '')
    });
    col.dataset.ymd = ymd;

    col.appendChild(U.make('h4', { text: U.DOW_SHORT[i] }));
    col.appendChild(U.make('div', { class: 'wc-date', text: U.shortDate(ymd) }));

    /* Erste 3 Rapid-Logging-Einträge */
    if (data) {
      (data.rapid_logging || []).slice(0, 3).forEach((r) => {
        col.appendChild(U.make('div', { class: 'week-rl',
          text: `${r.symbol} ${r.content}` }));
      });
    }

    /* Externe Termine als Zeitblöcke */
    ext.filter((e) => (e.start || '').slice(0, 10) === ymd)
      .forEach((e) => {
        col.appendChild(U.make('div', { class: 'week-ext',
          text: (e.allDay ? '' : U.timeOf(e.start) + ' ') + e.title }));
      });

    /* Task-Count */
    const openTasks = data ? (data.tasks || []).filter((t) => !t.done).length : 0;
    col.appendChild(U.make('div', { class: 'week-meta',
      text: `${openTasks} offen` }));

    /* Klick öffnet Tagesansicht */
    col.addEventListener('click', (e) => {
      if (e.target.closest('.week-col') === col && !col.classList.contains('drop')) {
        Calendar.state.day = ymd;
        UI.render('day');
      }
    });

    /* --- Drag & Drop von Aufgaben (optional) --- */
    col.addEventListener('dragover', (e) => {
      e.preventDefault();
      col.classList.add('drop-target');
    });
    col.addEventListener('dragleave', () => col.classList.remove('drop-target'));
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      col.classList.remove('drop-target');
      const payload = e.dataTransfer.getData('text/plain');
      if (!payload) return;
      const { fromYmd, taskId } = JSON.parse(payload);
      if (fromYmd === ymd) return;
      const src = await DB.getDay(fromYmd);
      const idx = (src.tasks || []).findIndex((t) => t.id === taskId);
      if (idx === -1) return;
      const [task] = src.tasks.splice(idx, 1);
      await DB.saveDay(src);
      const dst = await DB.getDay(ymd);
      if (task.due_date) task.due_date = ymd;
      dst.tasks.push(task);
      await DB.saveDay(dst);
      U.toast('Aufgabe verschoben', 'ok');
      UI.render('week');
    });

    /* Ziehbare Aufgaben-Chips */
    if (data) {
      (data.tasks || []).filter((t) => !t.done).slice(0, 4).forEach((t) => {
        const chip = U.make('div', {
          class: 'week-rl', draggable: 'true',
          style: 'cursor:grab;color:var(--accent)'
        }, '⠿ ' + t.text);
        chip.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain',
            JSON.stringify({ fromYmd: ymd, taskId: t.id }));
        });
        col.appendChild(chip);
      });
    }

    grid.appendChild(col);
  });
  main.appendChild(grid);
  main.appendChild(U.make('div', { class: 'view-sub no-print',
    text: 'Tipp: Offene Aufgaben (⠿) lassen sich auf andere Tage ziehen.' }));
};

/* ========================================================================== *
 *  UI: NOTIZEN-SEITE — zwei Reiter: Journal-Einträge und eigenständige Notizen
 * ========================================================================== */
UI._notesTab = 'standalone';

UI.renderNotes = async function (main) {
  main.innerHTML = '';
  main.appendChild(U.make('div', { class: 'view-head' }, [
    U.make('h1', { class: 'view-title', text: 'Notizen' })
  ]));

  /* Reiter-Umschalter */
  const tabStandalone = U.make('button', { class: 'tab-btn' }, 'Eigenständig');
  const tabJournal = U.make('button', { class: 'tab-btn' }, 'Aus dem Journal');
  const refreshTabs = () => {
    tabStandalone.classList.toggle('active', UI._notesTab === 'standalone');
    tabJournal.classList.toggle('active', UI._notesTab === 'journal');
  };
  tabStandalone.addEventListener('click', () => {
    UI._notesTab = 'standalone'; UI.renderNotes(main);
  });
  tabJournal.addEventListener('click', () => {
    UI._notesTab = 'journal'; UI.renderNotes(main);
  });
  refreshTabs();
  main.appendChild(U.make('div', { class: 'tab-bar no-print' },
    [tabStandalone, tabJournal]));

  if (UI._notesTab === 'standalone') {
    await UI._renderStandaloneNotes(main);
  } else {
    await UI._renderJournalNotes(main);
  }
};

/* --- Eigenständige Notizen (Store "notes") ---------------------------- */
UI._renderStandaloneNotes = async function (main) {
  const notes = await DB.getAll('notes');
  const projects = await DB.getAll('projects');
  const people = await DB.getAll('people');
  notes.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''));

  /* "+ Neue Notiz"-Knopf */
  const newBtn = U.make('button', { class: 'btn btn-primary',
    text: '+ Neue Notiz' });
  newBtn.addEventListener('click', () => UI.openStandaloneNote(null));
  main.appendChild(U.make('div', { class: 'btn-row no-print',
    style: 'margin-bottom:.8rem' }, [newBtn]));

  /* Filterleiste */
  const fText = U.make('input', { type: 'text',
    placeholder: 'Text durchsuchen …' });
  const fTag = U.make('input', { type: 'text', placeholder: 'Tag' });
  main.appendChild(U.make('div', { class: 'filter-bar no-print' },
    [fText, fTag]));

  const listHost = U.make('div', {});
  main.appendChild(listHost);

  const apply = () => {
    const q = fText.value.trim().toLowerCase();
    const tag = fTag.value.trim().toLowerCase();
    let rows = notes.filter((n) => {
      if (q && !((n.title || '') + ' ' + (n.content || '')).toLowerCase().includes(q))
        return false;
      if (tag && !(n.tags || []).map((t) => t.toLowerCase()).includes(tag))
        return false;
      return true;
    });
    listHost.innerHTML = '';
    listHost.appendChild(U.make('div', { class: 'muted',
      style: 'margin:.2rem 0 .6rem', text: rows.length + ' Notiz(en)' }));
    if (!rows.length) {
      listHost.appendChild(U.make('div', { class: 'empty',
        text: notes.length
          ? 'Keine Treffer.'
          : 'Noch keine eigenständigen Notizen. Klick auf „+ Neue Notiz".' }));
      return;
    }
    rows.forEach((n) => {
      const chips = [];
      Mentions.projectsIn(n.content, projects).forEach((p) =>
        chips.push(U.make('span', { class: 'block-chip',
          style: `border-left:3px solid ${p.farbe}`, text: p.name })));
      Mentions.peopleIn(n.content, people).forEach((p) =>
        chips.push(U.make('span', { class: 'block-chip', text: '@' + p.name })));
      (n.tags || []).forEach((t) =>
        chips.push(U.make('span', { class: 'block-chip', text: '#' + t })));

      const item = U.make('div', { class: 'note-item' }, [
        U.make('span', { class: 'note-sym', text: '≣' }),
        U.make('div', { class: 'note-body' }, [
          U.make('div', { class: 'note-text',
            html: '<strong>' + U.esc(n.title || '(ohne Titel)') + '</strong><br>'
              + U.esc((n.content || '').slice(0, 220))
              + ((n.content || '').length > 220 ? '…' : '') }),
          chips.length ? U.make('div', { class: 'block-chips' }, chips) : null,
          U.make('div', { class: 'muted', style: 'font-size:.72rem;margin-top:.3rem',
            text: 'Bearbeitet ' + (n.updated_at
              ? new Date(n.updated_at).toLocaleString('de-DE') : '—') })
        ])
      ]);
      item.addEventListener('click', () => UI.openStandaloneNote(n));
      listHost.appendChild(item);
    });
  };
  fText.addEventListener('input', U.debounce(apply, 200));
  fTag.addEventListener('input', U.debounce(apply, 200));
  apply();
};

/* --- Modal/Seite zum Bearbeiten einer eigenständigen Notiz ------------- */
UI.openStandaloneNote = async function (existing) {
  const isNew = !existing;
  const note = existing || {
    id: U.uuid(), title: '', content: '', tags: [],
    created_at: U.nowIso(), updated_at: U.nowIso()
  };

  const title = U.make('input', { type: 'text', placeholder: 'Titel' });
  title.value = note.title || '';
  const content = U.make('textarea', { rows: '12',
    placeholder: 'Notizinhalt … [[Projekt]] und @Person verknüpfen.' });
  content.value = note.content || '';
  const tagsIn = U.make('input', { type: 'text',
    placeholder: 'Tags, durch Komma getrennt' });
  tagsIn.value = (note.tags || []).join(', ');

  const save = U.make('button', { class: 'btn btn-primary btn-block',
    text: isNew ? 'Notiz anlegen' : 'Änderungen speichern' });
  save.addEventListener('click', async () => {
    note.title = title.value.trim();
    note.content = content.value;
    note.tags = tagsIn.value.split(',').map((s) => s.trim()).filter(Boolean);
    note.updated_at = U.nowIso();
    await DB.put('notes', note);
    UI.closeModal();
    U.toast(isNew ? 'Notiz angelegt' : 'Gespeichert', 'ok');
    UI.renderNotes(U.el('main-view'));
  });

  const box = U.make('div', {}, [
    U.make('div', { class: 'field' }, [
      U.make('label', { text: 'Titel' }), title]),
    U.make('div', { class: 'field' }, [
      U.make('label', { text: 'Inhalt' }), content]),
    U.make('div', { class: 'field' }, [
      U.make('label', { text: 'Tags' }), tagsIn]),
    save
  ]);

  if (!isNew) {
    const del = U.make('button', { class: 'btn btn-danger btn-block',
      style: 'margin-top:.5rem', text: 'Notiz löschen' });
    del.addEventListener('click', async () => {
      await DB.del('notes', note.id);
      UI.closeModal();
      U.toast('Notiz gelöscht');
      UI.renderNotes(U.el('main-view'));
    });
    box.appendChild(del);
  }

  UI.openModal(isNew ? 'Neue Notiz' : 'Notiz bearbeiten', box);
  setTimeout(() => title.focus(), 80);
};

/* --- Journal-Blöcke als filterbare Liste (bisherige Logik) ------------- */
UI._renderJournalNotes = async function (main) {
  const days = await DB.getAll('days');
  const projects = await DB.getAll('projects');
  const people = await DB.getAll('people');

  const blocks = [];
  days.forEach((d) => {
    (d.rapid_logging || []).forEach((b) => {
      if ((b.content || '').trim()) blocks.push({ ymd: d.id, block: b });
    });
  });
  blocks.sort((a, b) => b.ymd.localeCompare(a.ymd));

  const fText = U.make('input', { type: 'text',
    placeholder: 'Text durchsuchen …' });
  const fSym = U.make('select', {});
  fSym.appendChild(U.make('option', { value: '' }, 'Alle Typen'));
  RL_SYMBOLS.forEach((s) =>
    fSym.appendChild(U.make('option', { value: s.sym }, `${s.sym}  ${s.name}`)));
  const fProj = U.make('select', {});
  fProj.appendChild(U.make('option', { value: '' }, 'Alle Projekte'));
  projects.forEach((p) => fProj.appendChild(U.make('option', { value: p.id }, p.name)));
  const fPers = U.make('select', {});
  fPers.appendChild(U.make('option', { value: '' }, 'Alle Personen'));
  people.forEach((p) => fPers.appendChild(U.make('option', { value: p.id }, p.name)));
  const fFrom = U.make('input', { type: 'date' });
  const fTo = U.make('input', { type: 'date' });
  main.appendChild(U.make('div', { class: 'filter-bar no-print' },
    [fText, fSym, fProj, fPers, fFrom, fTo]));

  const listHost = U.make('div', {});
  main.appendChild(listHost);

  const apply = () => {
    const q = fText.value.trim().toLowerCase();
    let rows = blocks.filter(({ ymd, block }) => {
      if (q && !(block.content || '').toLowerCase().includes(q)) return false;
      if (fSym.value && block.symbol !== fSym.value) return false;
      if (fFrom.value && ymd < fFrom.value) return false;
      if (fTo.value && ymd > fTo.value) return false;
      if (fProj.value &&
          !Mentions.blockProjectIds(block, projects).includes(fProj.value)) return false;
      if (fPers.value &&
          !Mentions.blockPersonIds(block, people).includes(fPers.value)) return false;
      return true;
    });

    listHost.innerHTML = '';
    listHost.appendChild(U.make('div', { class: 'muted',
      style: 'margin:.2rem 0 .6rem', text: rows.length + ' Treffer' }));

    if (!rows.length) {
      listHost.appendChild(U.make('div', { class: 'empty',
        text: 'Keine Journal-Einträge für diese Filter.' }));
      return;
    }
    let lastYmd = null;
    rows.forEach(({ ymd, block }) => {
      if (ymd !== lastYmd) {
        lastYmd = ymd;
        const head = U.make('div', { class: 'notes-day-head', text: U.prettyDate(ymd) });
        head.addEventListener('click', () => {
          Calendar.state.day = ymd;
          UI.render('day');
        });
        listHost.appendChild(head);
      }
      const symName = (RL_SYMBOLS.find((s) => s.sym === block.symbol) || {}).name || '';
      const chips = [];
      Mentions.projectsIn(block.content, projects).forEach((p) =>
        chips.push(U.make('span', { class: 'block-chip',
          style: `border-left:3px solid ${p.farbe}`, text: p.name })));
      Mentions.peopleIn(block.content, people).forEach((p) =>
        chips.push(U.make('span', { class: 'block-chip', text: '@' + p.name })));
      const item = U.make('div', { class: 'note-item' }, [
        U.make('span', { class: 'note-sym', title: symName, text: block.symbol }),
        U.make('div', { class: 'note-body' }, [
          U.make('div', { class: 'note-text', text: block.content }),
          chips.length ? U.make('div', { class: 'block-chips' }, chips) : null
        ])
      ]);
      item.addEventListener('click', () => {
        Calendar.state.day = ymd;
        UI.render('day');
      });
      listHost.appendChild(item);
    });
  };
  fText.addEventListener('input', U.debounce(apply, 200));
  [fSym, fProj, fPers, fFrom, fTo].forEach((e) =>
    e.addEventListener('change', apply));
  apply();
};

/* ========================================================================== *
 *  UI (Fortsetzung): Externe-Termin-Modal & Referenz-Modal
 * ========================================================================== */

/* --- Modal für einen externen Termin ----------------------------------- */
UI.openExtEventModal = async function (event) {
  const linked = await ExtCal.linkedTask(event.id);

  const note = U.make('textarea', { rows: '3',
    placeholder: 'Notiz zu diesem Termin …' });
  note.value = event.user_note || '';

  const info = U.make('div', { class: 'md-preview' }, [
    U.make('div', { html: '<strong>Zeit:</strong> ' + (event.allDay
      ? 'Ganztägig'
      : `${U.prettyDate((event.start || '').slice(0, 10))}, `
        + `${U.timeOf(event.start)}–${U.timeOf(event.end)}`) }),
    event.location
      ? U.make('div', { html: '<strong>Ort:</strong> ' + U.esc(event.location) })
      : null,
    event.description
      ? U.make('div', { html: '<strong>Beschreibung:</strong> ' + U.esc(event.description) })
      : null,
    event.recurring
      ? U.make('div', { class: 'muted',
          text: '↻ Serientermin — wurde nur einmalig importiert.' })
      : null
  ]);

  /* Status: bereits verknüpfte Aufgabe? */
  const status = U.make('div', { class: linked ? 'chip ext-link' : 'muted',
    style: 'margin:.6rem 0;display:inline-block',
    text: linked
      ? `✓ Aufgabe verknüpft (${U.shortDate(linked.day)})`
      : 'Noch keine Aufgabe verknüpft' });

  /* Aktions-Buttons */
  const addTaskBtn = U.make('button', { class: 'btn btn-primary btn-block',
    text: 'Aufgabe zu diesem Termin erstellen' });
  addTaskBtn.addEventListener('click', () => {
    UI.openTaskModal((event.start || '').slice(0, 10), event.id);
  });

  const dupBtn = U.make('button', { class: 'btn btn-block',
    text: 'Termin als Vorbereitungsaufgabe (1 Tag vorher)' });
  dupBtn.addEventListener('click', async () => {
    const ymd = await ExtCal.createTaskForEvent(event, true);
    U.toast('Vorbereitungsaufgabe am ' + U.shortDate(ymd) + ' angelegt', 'ok');
    UI.closeModal();
    UI.render(UI.current);
  });

  const saveNote = U.make('button', { class: 'btn btn-block',
    text: 'Notiz speichern' });
  saveNote.addEventListener('click', async () => {
    event.user_note = note.value;
    await DB.put('external_events', event);
    U.toast('Notiz gespeichert', 'ok');
    UI.closeModal();
  });

  const box = U.make('div', {}, [
    info,
    status,
    U.make('div', { class: 'field' }, [
      U.make('label', { text: 'Notiz zu diesem Termin' }), note]),
    saveNote,
    U.make('div', { class: 'divider' }),
    addTaskBtn,
    U.make('div', { style: 'height:.5rem' }),
    dupBtn
  ]);
  UI.openModal('📅 ' + event.title, box);
};

/* --- Referenz-Modal: alle Tage, die [[Name]] oder @Name erwähnen -------- */
UI.openReferenceModal = async function (name) {
  const refs = await Backlinks.findReferences(name);
  const list = U.make('div', { class: 'backlink-list' });

  if (!refs.length) {
    list.appendChild(U.make('div', { class: 'empty',
      text: 'Keine Tage mit dieser Verknüpfung gefunden.' }));
  }
  refs.forEach((r) => {
    const snippets = r.snippets || (r.snippet ? [r.snippet] : []);
    const snippetNodes = snippets.map((s) =>
      U.make('div', { class: 'backlink-snippet', text: s }));
    const item = U.make('div', { class: 'backlink' }, [
      U.make('div', { class: 'backlink-date', text: U.prettyDate(r.ymd) }),
      ...snippetNodes
    ]);
    item.addEventListener('click', () => {
      Calendar.state.day = r.ymd;
      UI.closeModal();
      UI.render('day');
    });
    list.appendChild(item);
  });

  UI.openModal('Verknüpfungen: ' + name, list);
};

/* --- Future-Log-Modal --------------------------------------------------- */
UI.openFutureLog = async function () {
  const entries = await DB.getAll('future_log');
  const projects = await DB.getAll('projects');
  entries.sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const list = U.make('div', {});
  if (!entries.length) {
    list.appendChild(U.make('div', { class: 'empty',
      text: 'Noch keine Einträge im Future Log.' }));
  }
  entries.forEach((e) => {
    const proj = projects.find((p) => p.id === e.project_id);
    const del = U.make('button', { class: 'rl-del', title: 'Löschen' }, '✕');
    del.addEventListener('click', async () => {
      await DB.del('future_log', e.id);
      UI.openFutureLog();
    });
    list.appendChild(U.make('div', { class: 'list-item' }, [
      U.make('div', { class: 'li-main' }, [
        U.make('div', { class: 'li-title', text: e.title }),
        U.make('div', { class: 'li-sub',
          text: [U.prettyDate(e.date), proj ? proj.name : null,
                 e.description].filter(Boolean).join('  ·  ') })
      ]),
      del
    ]));
  });

  /* Neuer Eintrag */
  const t = U.make('input', { type: 'text', placeholder: 'Titel' });
  const d = U.make('input', { type: 'date', value: U.today() });
  const desc = U.make('input', { type: 'text', placeholder: 'Beschreibung (optional)' });
  const projSel = U.make('select', {});
  projSel.appendChild(U.make('option', { value: '' }, '— Projekt —'));
  projects.forEach((p) => projSel.appendChild(
    U.make('option', { value: p.id }, p.name)));
  const addBtn = U.make('button', { class: 'btn btn-primary btn-block',
    text: '+ Eintrag hinzufügen' });
  addBtn.addEventListener('click', async () => {
    if (!t.value.trim()) { U.toast('Titel fehlt', 'warn'); return; }
    await DB.put('future_log', {
      id: U.uuid(), title: t.value.trim(), date: d.value || U.today(),
      description: desc.value.trim(), project_id: projSel.value || null
    });
    UI.openFutureLog();
  });

  const box = U.make('div', {}, [
    list,
    U.make('div', { class: 'divider' }),
    U.make('h3', { text: 'Neuer Eintrag' }),
    U.make('div', { class: 'field' }, [t]),
    U.make('div', { class: 'inline-fields' }, [d, projSel]),
    U.make('div', { class: 'field', style: 'margin-top:.5rem' }, [desc]),
    addBtn
  ]);
  UI.openModal('🔮 Future Log', box);
};
/* ========================================================================== *
 *  UI (Fortsetzung): Sammlungen, Aufgaben-Manager, Suche, Einstellungen
 * ========================================================================== */

/* --- SAMMLUNGEN-ÜBERSICHT ---------------------------------------------- */
UI.renderCollections = async function (main) {
  /* Sub-Routing innerhalb der Sammlungen-Ansicht. */
  if (UI._collSub) {
    return UI._renderCollectionDetail(main, UI._collSub);
  }

  const projects = await DB.getAll('projects');
  const people = await DB.getAll('people');
  const knowledge = await DB.getAll('knowledge');
  const custom = (await DB.getAll('collections'))
    .filter((c) => c.type === 'custom');
  const days = await DB.getAll('days');

  main.innerHTML = '';
  main.appendChild(U.make('div', { class: 'view-head' }, [
    U.make('h1', { class: 'view-title', text: 'Sammlungen' })
  ]));

  /* Schnellzugriff-Buttons */
  const newProj = U.make('button', { class: 'btn btn-sm', text: '+ Projekt' });
  newProj.addEventListener('click', () => UI.openProjectModal());
  const newPers = U.make('button', { class: 'btn btn-sm', text: '+ Person' });
  newPers.addEventListener('click', () => UI.openPersonModal());
  const newKnow = U.make('button', { class: 'btn btn-sm', text: '+ Wissen' });
  newKnow.addEventListener('click', () => UI.openKnowledgeModal());
  const newColl = U.make('button', { class: 'btn btn-sm btn-primary', text: '+ Neue Sammlung' });
  newColl.addEventListener('click', () => UI.openCustomCollectionModal());
  main.appendChild(U.make('div', { class: 'btn-row no-print',
    style: 'margin-bottom:1rem' }, [newProj, newPers, newKnow, newColl]));

  /* Hilfsfunktion: Anzahl offener/erledigter Aufgaben für ein Projekt. */
  const projectStats = (pid) => {
    let open = 0, done = 0;
    days.forEach((d) => (d.tasks || []).forEach((t) => {
      if (t.project_id === pid) { t.done ? done++ : open++; }
    }));
    return { open, done };
  };

  /* Eine Listenzeile bauen. */
  const makeRow = (icon, name, meta, onClick, accentColor) => {
    const row = U.make('div', { class: 'list-row' }, [
      U.make('span', { class: 'lr-icon' + (accentColor ? ' lr-icon-color' : ''),
        style: accentColor ? `background:${accentColor}` : '', text: icon }),
      U.make('div', { class: 'lr-body' }, [
        U.make('div', { class: 'lr-title', text: name }),
        meta ? U.make('div', { class: 'lr-meta', text: meta }) : null
      ]),
      U.make('span', { class: 'lr-arrow', text: '›' })
    ]);
    row.addEventListener('click', onClick);
    return row;
  };

  /* --- Projekte --- */
  main.appendChild(U.make('div', { class: 'section-label', text: 'Projekte' }));
  const projList = U.make('div', { class: 'list-group' });
  if (!projects.length) {
    projList.appendChild(U.make('div', { class: 'empty', text: 'Keine Projekte.' }));
  }
  projects.forEach((p) => {
    const s = projectStats(p.id);
    const meta = [p.status, `${s.open} offen`, `${s.done} erledigt`,
      p.description].filter(Boolean).join(' · ');
    projList.appendChild(makeRow('◧', p.name, meta,
      () => { UI._collSub = { kind: 'project', id: p.id };
              UI.render('collections'); },
      p.farbe));
  });
  main.appendChild(projList);

  /* --- Personen --- */
  main.appendChild(U.make('div', { class: 'section-label',
    style: 'margin-top:1.2rem', text: 'Personen' }));
  const persList = U.make('div', { class: 'list-group' });
  if (!people.length) {
    persList.appendChild(U.make('div', { class: 'empty', text: 'Keine Personen.' }));
  }
  people.forEach((p) => {
    const meta = [(p.tags || []).join(', '), p.email]
      .filter(Boolean).join(' · ') || '—';
    persList.appendChild(makeRow('@', p.name, meta,
      () => { UI._collSub = { kind: 'person', id: p.id };
              UI.render('collections'); }));
  });
  main.appendChild(persList);

  /* --- Wissen --- */
  main.appendChild(U.make('div', { class: 'section-label',
    style: 'margin-top:1.2rem', text: 'Wissensbasis' }));
  const knowList = U.make('div', { class: 'list-group' });
  if (!knowledge.length) {
    knowList.appendChild(U.make('div', { class: 'empty', text: 'Keine Wissens-Einträge.' }));
  }
  knowledge.forEach((k) => {
    const meta = (k.excerpt || '').slice(0, 110)
      + ((k.excerpt || '').length > 110 ? '…' : '');
    knowList.appendChild(makeRow('✦', k.title, meta,
      () => { UI._collSub = { kind: 'knowledge', id: k.id };
              UI.render('collections'); }));
  });
  main.appendChild(knowList);

  /* --- Benutzerdefinierte Sammlungen --- */
  main.appendChild(U.make('div', { class: 'section-label',
    style: 'margin-top:1.2rem', text: 'Eigene Sammlungen' }));
  const customList = U.make('div', { class: 'list-group' });
  if (!custom.length) {
    customList.appendChild(U.make('div', { class: 'empty',
      text: 'Noch keine eigenen Sammlungen.' }));
  }
  custom.forEach((c) => {
    const meta = `${(c.entries || []).length} Einträge · `
      + `${(c.custom_fields || []).length} Felder`;
    customList.appendChild(makeRow('❑', c.name, meta,
      () => { UI._collSub = { kind: 'custom', id: c.id };
              UI.render('collections'); }));
  });
  main.appendChild(customList);
};

/* --- Detail-Unterseite einer Sammlung (Zurück-Pfeil oben) ------------- */
UI._renderCollectionDetail = async function (main, sub) {
  main.innerHTML = '';
  const back = U.make('button', { class: 'btn-back no-print',
    title: 'Zurück zur Übersicht' }, '← Zurück');
  back.addEventListener('click', () => { UI._collSub = null; UI.render('collections'); });
  main.appendChild(back);

  if (sub.kind === 'project') {
    const p = await DB.get('projects', sub.id);
    if (!p) { UI._collSub = null; return UI.render('collections'); }
    return UI._renderProjectDetail(main, p);
  }
  if (sub.kind === 'person') {
    const p = await DB.get('people', sub.id);
    if (!p) { UI._collSub = null; return UI.render('collections'); }
    return UI._renderPersonDetail(main, p);
  }
  if (sub.kind === 'knowledge') {
    const k = await DB.get('knowledge', sub.id);
    if (!k) { UI._collSub = null; return UI.render('collections'); }
    return UI._renderKnowledgeDetail(main, k);
  }
  if (sub.kind === 'custom') {
    const c = await DB.get('collections', sub.id);
    if (!c) { UI._collSub = null; return UI.render('collections'); }
    return UI._renderCustomCollDetail(main, c);
  }
};

/* ====================================================================== *
 *  Hilfsfunktion: Eintrags-Liste verknüpfter Tage (gemeinsam für Detail)
 * ====================================================================== */
UI._renderRefList = function (host, refs, emptyText) {
  const list = U.make('div', { class: 'backlink-list' });
  if (!refs.length) {
    list.appendChild(U.make('div', { class: 'empty', text: emptyText }));
  }
  refs.forEach((r) => {
    const snippets = r.snippets || (r.snippet ? [r.snippet] : []);
    const snippetNodes = snippets.map((s) =>
      U.make('div', { class: 'backlink-snippet', text: s }));

    const item = U.make('div', { class: 'backlink' }, [
      U.make('div', { class: 'backlink-date', text: U.prettyDate(r.ymd) }),
      ...snippetNodes
    ]);
    item.addEventListener('click', () => {
      Calendar.state.day = r.ymd;
      UI._collSub = null;
      UI.render('day');
    });
    list.appendChild(item);
  });
  host.appendChild(list);
};

/* ====================================================================== *
 *  Projekt-Detailseite
 * ====================================================================== */
UI._renderProjectDetail = async function (main, p) {
  const refs = await Backlinks.findReferences(p.name);
  const days = await DB.getAll('days');
  let open = 0, doneN = 0;
  days.forEach((d) => (d.tasks || []).forEach((t) => {
    if (t.project_id === p.id) { t.done ? doneN++ : open++; }
  }));

  main.appendChild(U.make('div', { class: 'view-head' }, [
    U.make('div', { class: 'detail-title-row' }, [
      U.make('span', { class: 'detail-swatch', style: `background:${p.farbe}` }),
      U.make('h1', { class: 'view-title', text: p.name })
    ])
  ]));

  /* --- Status-Pills --- */
  main.appendChild(U.make('div', { class: 'tag-pills' }, [
    U.make('span', { class: 'pill', text: p.status }),
    U.make('span', { class: 'pill', text: `${open} offen` }),
    U.make('span', { class: 'pill', text: `${doneN} erledigt` })
  ]));
  if (p.description) {
    main.appendChild(U.make('p', { class: 'muted', style: 'margin:.7rem 0',
      text: p.description }));
  }

  /* --- Bearbeiten-Karte --- */
  const card = U.make('div', { class: 'card', style: 'margin-top:1rem' });
  card.appendChild(U.make('div', { class: 'card-title' }, 'Bearbeiten'));

  const nameInp = U.make('input', { type: 'text', value: p.name });
  const colorInp = U.make('input', { type: 'color', value: p.farbe || '#c8553d' });
  const statusInp = U.make('select', {});
  ['aktiv', 'archiviert'].forEach((s) => statusInp.appendChild(
    U.make('option', { value: s, selected: s === p.status ? '' : null }, s)));
  const descInp = U.make('input', { type: 'text', value: p.description || '',
    placeholder: 'Beschreibung' });

  const saveBtn = U.make('button', { class: 'btn btn-primary',
    text: 'Speichern' });
  saveBtn.addEventListener('click', async () => {
    if (!nameInp.value.trim()) { U.toast('Name fehlt', 'warn'); return; }
    p.name = nameInp.value.trim();
    p.farbe = colorInp.value;
    p.status = statusInp.value;
    p.description = descInp.value.trim();
    await DB.put('projects', p);
    await Backlinks.refreshKnowledgeBacklinks();
    U.toast('Gespeichert', 'ok');
    UI.render('collections');
  });

  card.appendChild(U.make('div', { class: 'field' }, [
    U.make('label', { text: 'Name' }), nameInp]));
  card.appendChild(U.make('div', { class: 'inline-fields' }, [
    U.make('div', { class: 'field' }, [U.make('label', { text: 'Farbe' }), colorInp]),
    U.make('div', { class: 'field' }, [U.make('label', { text: 'Status' }), statusInp])
  ]));
  card.appendChild(U.make('div', { class: 'field' }, [
    U.make('label', { text: 'Beschreibung' }), descInp]));
  card.appendChild(saveBtn);
  main.appendChild(card);

  /* --- Verknüpfte Tage --- */
  const refCard = U.make('div', { class: 'card' });
  refCard.appendChild(U.make('div', { class: 'card-title' }, 'Verknüpfte Tage'));
  refCard.appendChild(U.make('div', { class: 'muted', style: 'margin-bottom:.4rem',
    text: 'Tage, die [[' + p.name + ']] in Journal-Blöcken nennen.' }));
  UI._renderRefList(refCard, refs, 'Noch keine verknüpften Tage.');
  main.appendChild(refCard);

  /* --- Aufgaben dieses Projekts --- */
  const taskCard = U.make('div', { class: 'card' });
  taskCard.appendChild(U.make('div', { class: 'card-title' }, 'Aufgaben'));
  const projTasks = [];
  days.forEach((d) => (d.tasks || []).forEach((t) => {
    if (t.project_id === p.id) projTasks.push({ ymd: d.id, task: t });
  }));
  projTasks.sort((a, b) => (a.task.done - b.task.done)
    || a.ymd.localeCompare(b.ymd));
  if (!projTasks.length) {
    taskCard.appendChild(U.make('div', { class: 'empty',
      text: 'Keine Aufgaben mit diesem Projekt verknüpft.' }));
  }
  projTasks.forEach(({ ymd, task }) => {
    const row = U.make('div', { class: 'list-row clickable' }, [
      U.make('span', { class: 'lr-icon', text: task.done ? '☑' : '☐' }),
      U.make('div', { class: 'lr-body' }, [
        U.make('div', { class: 'lr-title',
          style: task.done ? 'text-decoration:line-through;color:var(--muted)' : '',
          text: task.text }),
        U.make('div', { class: 'lr-meta', text: U.shortDate(ymd) })
      ]),
      U.make('span', { class: 'lr-arrow', text: '›' })
    ]);
    row.addEventListener('click', () => {
      Calendar.state.day = ymd;
      UI._collSub = null;
      UI.render('day');
    });
    taskCard.appendChild(row);
  });
  main.appendChild(taskCard);

  /* --- Löschen --- */
  const danger = U.make('div', { class: 'card' });
  danger.appendChild(U.make('div', { class: 'card-title' }, 'Aktionen'));
  const delBtn = U.make('button', { class: 'btn btn-danger',
    text: 'Projekt löschen' });
  delBtn.addEventListener('click', async () => {
    if (!confirm(`Projekt „${p.name}" wirklich löschen?`)) return;
    await DB.del('projects', p.id);
    U.toast('Projekt gelöscht');
    UI._collSub = null;
    UI.render('collections');
  });
  danger.appendChild(delBtn);
  main.appendChild(danger);
};

/* ====================================================================== *
 *  Personen-Detailseite
 * ====================================================================== */
UI._renderPersonDetail = async function (main, p) {
  const refs = await Backlinks.findReferences(p.name);

  main.appendChild(U.make('div', { class: 'view-head' }, [
    U.make('h1', { class: 'view-title', text: '@' + p.name })
  ]));

  if ((p.tags || []).length) {
    main.appendChild(U.make('div', { class: 'tag-pills' },
      p.tags.map((t) => U.make('span', { class: 'pill', text: t }))));
  }

  /* --- Bearbeiten --- */
  const card = U.make('div', { class: 'card', style: 'margin-top:1rem' });
  card.appendChild(U.make('div', { class: 'card-title' }, 'Bearbeiten'));
  const nameInp = U.make('input', { type: 'text', value: p.name });
  const emailInp = U.make('input', { type: 'email', value: p.email || '',
    placeholder: 'E-Mail (optional)' });
  const tagsInp = U.make('input', { type: 'text',
    value: (p.tags || []).join(', '),
    placeholder: 'Tags, durch Komma getrennt' });
  const saveBtn = U.make('button', { class: 'btn btn-primary', text: 'Speichern' });
  saveBtn.addEventListener('click', async () => {
    if (!nameInp.value.trim()) { U.toast('Name fehlt', 'warn'); return; }
    p.name = nameInp.value.trim();
    p.email = emailInp.value.trim();
    p.tags = tagsInp.value.split(',').map((s) => s.trim()).filter(Boolean);
    await DB.put('people', p);
    U.toast('Gespeichert', 'ok');
    UI.render('collections');
  });
  card.appendChild(U.make('div', { class: 'field' }, [
    U.make('label', { text: 'Name' }), nameInp]));
  card.appendChild(U.make('div', { class: 'field' }, [
    U.make('label', { text: 'E-Mail' }), emailInp]));
  card.appendChild(U.make('div', { class: 'field' }, [
    U.make('label', { text: 'Tags' }), tagsInp]));
  card.appendChild(saveBtn);
  main.appendChild(card);

  /* --- Verknüpfte Tage --- */
  const refCard = U.make('div', { class: 'card' });
  refCard.appendChild(U.make('div', { class: 'card-title' }, 'Verknüpfte Tage'));
  refCard.appendChild(U.make('div', { class: 'muted', style: 'margin-bottom:.4rem',
    text: 'Tage, die @' + p.name + ' in Journal-Blöcken erwähnen.' }));
  UI._renderRefList(refCard, refs, 'Noch keine verknüpften Tage.');
  main.appendChild(refCard);

  /* --- Löschen --- */
  const danger = U.make('div', { class: 'card' });
  danger.appendChild(U.make('div', { class: 'card-title' }, 'Aktionen'));
  const delBtn = U.make('button', { class: 'btn btn-danger',
    text: 'Person löschen' });
  delBtn.addEventListener('click', async () => {
    if (!confirm(`Person „${p.name}" wirklich löschen?`)) return;
    await DB.del('people', p.id);
    U.toast('Person gelöscht');
    UI._collSub = null;
    UI.render('collections');
  });
  danger.appendChild(delBtn);
  main.appendChild(danger);
};

/* ====================================================================== *
 *  Wissens-Detailseite
 * ====================================================================== */
UI._renderKnowledgeDetail = async function (main, k) {
  await Backlinks.refreshKnowledgeBacklinks();
  const fresh = await DB.get('knowledge', k.id) || k;

  main.appendChild(U.make('div', { class: 'view-head' }, [
    U.make('h1', { class: 'view-title', text: fresh.title })
  ]));

  /* --- Bearbeiten --- */
  const card = U.make('div', { class: 'card' });
  card.appendChild(U.make('div', { class: 'card-title' }, 'Bearbeiten'));
  const titleInp = U.make('input', { type: 'text', value: fresh.title });
  const excerptInp = U.make('textarea', { rows: '5',
    placeholder: 'Zusammenfassung / Zitat' });
  excerptInp.value = fresh.excerpt || '';
  const sourceInp = U.make('input', { type: 'text',
    value: fresh.source || '', placeholder: 'Quelle' });
  const tagsInp = U.make('input', { type: 'text',
    value: (fresh.tags || []).join(', '), placeholder: 'Tags, durch Komma' });
  const saveBtn = U.make('button', { class: 'btn btn-primary', text: 'Speichern' });
  saveBtn.addEventListener('click', async () => {
    if (!titleInp.value.trim()) { U.toast('Titel fehlt', 'warn'); return; }
    fresh.title = titleInp.value.trim();
    fresh.excerpt = excerptInp.value.trim();
    fresh.source = sourceInp.value.trim();
    fresh.tags = tagsInp.value.split(',').map((s) => s.trim()).filter(Boolean);
    await DB.put('knowledge', fresh);
    await Backlinks.refreshKnowledgeBacklinks();
    U.toast('Gespeichert', 'ok');
    UI.render('collections');
  });
  card.appendChild(U.make('div', { class: 'field' }, [
    U.make('label', { text: 'Titel' }), titleInp]));
  card.appendChild(U.make('div', { class: 'field' }, [
    U.make('label', { text: 'Inhalt' }), excerptInp]));
  card.appendChild(U.make('div', { class: 'field' }, [
    U.make('label', { text: 'Quelle' }), sourceInp]));
  card.appendChild(U.make('div', { class: 'field' }, [
    U.make('label', { text: 'Tags' }), tagsInp]));
  card.appendChild(saveBtn);
  main.appendChild(card);

  /* --- Zitierende Tage --- */
  const refCard = U.make('div', { class: 'card' });
  refCard.appendChild(U.make('div', { class: 'card-title' }, 'Zitiert in'));
  refCard.appendChild(U.make('div', { class: 'muted', style: 'margin-bottom:.4rem',
    text: 'Tage, die [[' + fresh.title + ']] in Journal-Blöcken zitieren.' }));
  const refs = (fresh.backlinks || []).map((ymd) => ({ ymd, snippet: '' }));
  UI._renderRefList(refCard, refs, 'Noch nicht zitiert.');
  main.appendChild(refCard);

  /* --- Löschen --- */
  const danger = U.make('div', { class: 'card' });
  danger.appendChild(U.make('div', { class: 'card-title' }, 'Aktionen'));
  const delBtn = U.make('button', { class: 'btn btn-danger',
    text: 'Eintrag löschen' });
  delBtn.addEventListener('click', async () => {
    if (!confirm(`„${fresh.title}" wirklich löschen?`)) return;
    await DB.del('knowledge', fresh.id);
    U.toast('Wissen gelöscht');
    UI._collSub = null;
    UI.render('collections');
  });
  danger.appendChild(delBtn);
  main.appendChild(danger);
};

/* ====================================================================== *
 *  Benutzerdefinierte-Sammlung-Detailseite
 * ====================================================================== */
UI._renderCustomCollDetail = async function (main, coll) {
  const fields = coll.custom_fields || [];

  main.appendChild(U.make('div', { class: 'view-head' }, [
    U.make('h1', { class: 'view-title', text: coll.name }),
    U.make('div', { class: 'view-sub',
      text: `${(coll.entries || []).length} Einträge · ${fields.length} Felder` })
  ]));

  /* --- Tabelle vorhandener Einträge --- */
  const tableCard = U.make('div', { class: 'card' });
  tableCard.appendChild(U.make('div', { class: 'card-title' }, 'Einträge'));

  if (!(coll.entries || []).length) {
    tableCard.appendChild(U.make('div', { class: 'empty',
      text: 'Noch keine Einträge.' }));
  } else {
    const table = U.make('table', { class: 'data-table' });
    const thead = U.make('tr', {});
    fields.forEach((f) => thead.appendChild(U.make('th', { text: f.label })));
    thead.appendChild(U.make('th', { text: '' }));
    table.appendChild(thead);

    (coll.entries || []).forEach((entry) => {
      const tr = U.make('tr', {});
      fields.forEach((f) => tr.appendChild(
        U.make('td', { text: entry[f.key] || '—' })));
      const del = U.make('button', { class: 'rl-del', title: 'Löschen' }, '✕');
      del.addEventListener('click', async () => {
        coll.entries = coll.entries.filter((e) => e.id !== entry.id);
        await DB.put('collections', coll);
        UI.render('collections');
      });
      tr.appendChild(U.make('td', {}, del));
      table.appendChild(tr);
    });
    tableCard.appendChild(U.make('div', { class: 'table-scroll' }, [table]));
  }
  main.appendChild(tableCard);

  /* --- Neuer Eintrag --- */
  const newCard = U.make('div', { class: 'card' });
  newCard.appendChild(U.make('div', { class: 'card-title' }, 'Neuer Eintrag'));
  const inputs = {};
  fields.forEach((f) => {
    let inp;
    if (f.type === 'select') {
      inp = U.make('select', {});
      inp.appendChild(U.make('option', { value: '' }, '—'));
      (f.options || []).forEach((o) =>
        inp.appendChild(U.make('option', { value: o }, o)));
    } else {
      inp = U.make('input', { type: f.type === 'date' ? 'date' : 'text',
        placeholder: f.label });
    }
    inputs[f.key] = inp;
    newCard.appendChild(U.make('div', { class: 'field' }, [
      U.make('label', { text: f.label }), inp]));
  });
  const addBtn = U.make('button', { class: 'btn btn-primary',
    text: '+ Eintrag hinzufügen' });
  addBtn.addEventListener('click', async () => {
    const entry = { id: U.uuid() };
    fields.forEach((f) => { entry[f.key] = inputs[f.key].value; });
    coll.entries = coll.entries || [];
    coll.entries.push(entry);
    await DB.put('collections', coll);
    UI.render('collections');
  });
  newCard.appendChild(addBtn);
  main.appendChild(newCard);

  /* --- Löschen --- */
  const danger = U.make('div', { class: 'card' });
  danger.appendChild(U.make('div', { class: 'card-title' }, 'Aktionen'));
  const delBtn = U.make('button', { class: 'btn btn-danger',
    text: 'Sammlung löschen' });
  delBtn.addEventListener('click', async () => {
    if (!confirm(`Sammlung „${coll.name}" wirklich löschen?`)) return;
    await DB.del('collections', coll.id);
    U.toast('Sammlung gelöscht');
    UI._collSub = null;
    UI.render('collections');
  });
  danger.appendChild(delBtn);
  main.appendChild(danger);
};

/* --- Projekt-Modal (neu) ----------------------------------------------- */
UI.openProjectModal = function () {
  const name = U.make('input', { type: 'text', placeholder: 'Projektname' });
  const color = U.make('input', { type: 'color', value: '#c8553d' });
  const desc = U.make('input', { type: 'text', placeholder: 'Beschreibung' });
  const status = U.make('select', {});
  ['aktiv', 'archiviert'].forEach((s) =>
    status.appendChild(U.make('option', { value: s }, s)));
  const save = U.make('button', { class: 'btn btn-primary btn-block', text: 'Projekt anlegen' });
  save.addEventListener('click', async () => {
    if (!name.value.trim()) { U.toast('Name fehlt', 'warn'); return; }
    await DB.put('projects', {
      id: U.uuid(), name: name.value.trim(), farbe: color.value,
      status: status.value, description: desc.value.trim(),
      created_at: U.nowIso()
    });
    UI.closeModal();
    U.toast('Projekt angelegt', 'ok');
    UI.render('collections');
  });
  UI.openModal('Neues Projekt', U.make('div', {}, [
    U.make('div', { class: 'field' }, [U.make('label', { text: 'Name' }), name]),
    U.make('div', { class: 'inline-fields' }, [
      U.make('div', { class: 'field' }, [U.make('label', { text: 'Farbe' }), color]),
      U.make('div', { class: 'field' }, [U.make('label', { text: 'Status' }), status])]),
    U.make('div', { class: 'field' }, [U.make('label', { text: 'Beschreibung' }), desc]),
    save
  ]));
};

/* --- Person-Modal (neu) ------------------------------------------------- */
UI.openPersonModal = function () {
  const name = U.make('input', { type: 'text', placeholder: 'Name' });
  const email = U.make('input', { type: 'email', placeholder: 'E-Mail (optional)' });
  const tags = U.make('input', { type: 'text', placeholder: 'Tags, durch Komma getrennt' });
  const save = U.make('button', { class: 'btn btn-primary btn-block', text: 'Person anlegen' });
  save.addEventListener('click', async () => {
    if (!name.value.trim()) { U.toast('Name fehlt', 'warn'); return; }
    await DB.put('people', {
      id: U.uuid(), name: name.value.trim(), email: email.value.trim(),
      tags: tags.value.split(',').map((s) => s.trim()).filter(Boolean),
      created_at: U.nowIso()
    });
    UI.closeModal();
    U.toast('Person angelegt', 'ok');
    UI.render('collections');
  });
  UI.openModal('Neue Person', U.make('div', {}, [
    U.make('div', { class: 'field' }, [U.make('label', { text: 'Name' }), name]),
    U.make('div', { class: 'field' }, [U.make('label', { text: 'E-Mail' }), email]),
    U.make('div', { class: 'field' }, [U.make('label', { text: 'Tags' }), tags]),
    save
  ]));
};

/* --- Wissen-Modal (neu) ------------------------------------------------- */
UI.openKnowledgeModal = function () {
  const title = U.make('input', { type: 'text', placeholder: 'Titel' });
  const excerpt = U.make('textarea', { rows: '4', placeholder: 'Zusammenfassung / Zitat' });
  const source = U.make('input', { type: 'text', placeholder: 'Quelle' });
  const tags = U.make('input', { type: 'text', placeholder: 'Tags, durch Komma' });
  const save = U.make('button', { class: 'btn btn-primary btn-block', text: 'Wissen speichern' });
  save.addEventListener('click', async () => {
    if (!title.value.trim()) { U.toast('Titel fehlt', 'warn'); return; }
    await DB.put('knowledge', {
      id: U.uuid(), title: title.value.trim(), excerpt: excerpt.value.trim(),
      source: source.value.trim(),
      tags: tags.value.split(',').map((s) => s.trim()).filter(Boolean),
      backlinks: [], created_at: U.nowIso()
    });
    await Backlinks.refreshKnowledgeBacklinks();
    UI.closeModal();
    U.toast('Wissen gespeichert', 'ok');
    UI.render('collections');
  });
  UI.openModal('Neuer Wissens-Eintrag', U.make('div', {}, [
    U.make('div', { class: 'field' }, [U.make('label', { text: 'Titel' }), title]),
    U.make('div', { class: 'field' }, [U.make('label', { text: 'Inhalt' }), excerpt]),
    U.make('div', { class: 'field' }, [U.make('label', { text: 'Quelle' }), source]),
    U.make('div', { class: 'field' }, [U.make('label', { text: 'Tags' }), tags]),
    save
  ]));
};

/* --- Projekt-Detail (mit Backlinks) ------------------------------------ */
UI.openProjectDetail = async function (p) {
  const refs = await Backlinks.findReferences(p.name);
  const days = await DB.getAll('days');
  // alle Aufgaben dieses Projekts zählen
  let open = 0, doneN = 0;
  days.forEach((d) => (d.tasks || []).forEach((t) => {
    if (t.project_id === p.id) { t.done ? doneN++ : open++; }
  }));

  const refList = U.make('div', { class: 'backlink-list' });
  if (!refs.length) refList.appendChild(U.make('div', { class: 'empty',
    text: 'Keine verknüpften Tage. Nutze [[' + p.name + ']] in Notizen.' }));
  refs.forEach((r) => {
    const item = U.make('div', { class: 'backlink' }, [
      U.make('div', { style: 'font-weight:600', text: U.prettyDate(r.ymd) }),
      U.make('div', { class: 'muted', style: 'font-size:.76rem', text: r.snippet })
    ]);
    item.addEventListener('click', () => {
      Calendar.state.day = r.ymd; UI.closeModal(); UI.render('day');
    });
    refList.appendChild(item);
  });

  const delBtn = U.make('button', { class: 'btn btn-danger btn-block',
    text: 'Projekt löschen' });
  delBtn.addEventListener('click', async () => {
    await DB.del('projects', p.id);
    UI.closeModal(); U.toast('Projekt gelöscht'); UI.render('collections');
  });

  UI.openModal(p.name, U.make('div', {}, [
    U.make('div', { class: 'tag-pills' }, [
      U.make('span', { class: 'pill',
        html: `<span class="swatch" style="background:${p.farbe}"></span> ${U.esc(p.status)}` }),
      U.make('span', { class: 'pill', text: `${open} offen` }),
      U.make('span', { class: 'pill', text: `${doneN} erledigt` })
    ]),
    p.description ? U.make('p', { class: 'muted', style: 'margin:.6rem 0',
      text: p.description }) : null,
    U.make('h3', { text: 'Verknüpfte Tage' }),
    refList,
    U.make('div', { class: 'divider' }),
    delBtn
  ]));
};

/* --- Person-Detail ------------------------------------------------------ */
UI.openPersonDetail = async function (p) {
  const refs = await Backlinks.findReferences(p.name);
  const refList = U.make('div', { class: 'backlink-list' });
  if (!refs.length) refList.appendChild(U.make('div', { class: 'empty',
    text: 'Keine verknüpften Tage. Nutze @' + p.name + ' in Notizen.' }));
  refs.forEach((r) => {
    const item = U.make('div', { class: 'backlink' }, [
      U.make('div', { style: 'font-weight:600', text: U.prettyDate(r.ymd) }),
      U.make('div', { class: 'muted', style: 'font-size:.76rem', text: r.snippet })
    ]);
    item.addEventListener('click', () => {
      Calendar.state.day = r.ymd; UI.closeModal(); UI.render('day');
    });
    refList.appendChild(item);
  });
  const delBtn = U.make('button', { class: 'btn btn-danger btn-block',
    text: 'Person löschen' });
  delBtn.addEventListener('click', async () => {
    await DB.del('people', p.id);
    UI.closeModal(); U.toast('Person gelöscht'); UI.render('collections');
  });
  UI.openModal(p.name, U.make('div', {}, [
    U.make('div', { class: 'tag-pills' },
      (p.tags || []).map((t) => U.make('span', { class: 'pill', text: t }))),
    p.email ? U.make('p', { class: 'muted', style: 'margin:.6rem 0', text: p.email }) : null,
    U.make('h3', { text: 'Verknüpfte Tage' }),
    refList,
    U.make('div', { class: 'divider' }),
    delBtn
  ]));
};

/* --- Wissen-Detail (Backlinks mit Zitat) ------------------------------- */
UI.openKnowledgeDetail = async function (k) {
  await Backlinks.refreshKnowledgeBacklinks();
  const fresh = await DB.get('knowledge', k.id) || k;
  const list = U.make('div', { class: 'backlink-list' });
  if (!(fresh.backlinks || []).length) {
    list.appendChild(U.make('div', { class: 'empty',
      text: 'Keine Tage zitieren diesen Eintrag. Nutze [[' + k.title + ']].' }));
  }
  for (const ymd of (fresh.backlinks || [])) {
    const item = U.make('div', { class: 'backlink',
      text: U.prettyDate(ymd) });
    item.addEventListener('click', () => {
      Calendar.state.day = ymd; UI.closeModal(); UI.render('day');
    });
    list.appendChild(item);
  }
  const delBtn = U.make('button', { class: 'btn btn-danger btn-block',
    text: 'Eintrag löschen' });
  delBtn.addEventListener('click', async () => {
    await DB.del('knowledge', k.id);
    UI.closeModal(); U.toast('Wissen gelöscht'); UI.render('collections');
  });
  UI.openModal(k.title, U.make('div', {}, [
    U.make('p', { style: 'margin-bottom:.5rem', text: k.excerpt }),
    k.source ? U.make('div', { class: 'muted', style: 'font-size:.8rem',
      text: 'Quelle: ' + k.source }) : null,
    U.make('div', { class: 'tag-pills', style: 'margin-top:.5rem' },
      (k.tags || []).map((t) => U.make('span', { class: 'pill', text: t }))),
    U.make('h3', { text: 'Zitiert in' }),
    list,
    U.make('div', { class: 'divider' }),
    delBtn
  ]));
};

/* --- Benutzerdefinierte Sammlung anlegen ------------------------------- */
UI.openCustomCollectionModal = function () {
  const name = U.make('input', { type: 'text', placeholder: 'Name der Sammlung' });
  const fieldsBox = U.make('div', {});
  const fieldDefs = [];

  const addFieldRow = () => {
    const label = U.make('input', { type: 'text', placeholder: 'Feldname' });
    const type = U.make('select', {});
    [['text', 'Text'], ['date', 'Datum'], ['select', 'Auswahlliste']]
      .forEach(([v, l]) => type.appendChild(U.make('option', { value: v }, l)));
    const opts = U.make('input', { type: 'text',
      placeholder: 'Optionen (Komma) — nur Auswahlliste' });
    const row = U.make('div', { class: 'inline-fields',
      style: 'margin-bottom:.4rem' }, [label, type, opts]);
    fieldsBox.appendChild(row);
    fieldDefs.push({ label, type, opts });
  };
  addFieldRow();

  const addBtn = U.make('button', { class: 'btn btn-sm', text: '+ Feld' });
  addBtn.addEventListener('click', addFieldRow);

  const save = U.make('button', { class: 'btn btn-primary btn-block',
    text: 'Sammlung erstellen' });
  save.addEventListener('click', async () => {
    if (!name.value.trim()) { U.toast('Name fehlt', 'warn'); return; }
    const fields = fieldDefs
      .filter((f) => f.label.value.trim())
      .map((f) => ({
        key: f.label.value.trim().toLowerCase().replace(/\s+/g, '_'),
        label: f.label.value.trim(),
        type: f.type.value,
        options: f.type.value === 'select'
          ? f.opts.value.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined
      }));
    await DB.put('collections', {
      id: U.uuid(), type: 'custom', name: name.value.trim(),
      linked_id: null, custom_fields: fields, entries: []
    });
    UI.closeModal();
    U.toast('Sammlung erstellt', 'ok');
    UI.render('collections');
  });

  UI.openModal('Neue Sammlung', U.make('div', {}, [
    U.make('div', { class: 'field' }, [U.make('label', { text: 'Name' }), name]),
    U.make('div', { class: 'section-label', text: 'Felder' }),
    fieldsBox, addBtn,
    U.make('div', { class: 'divider' }),
    save
  ]));
};

/* --- Benutzerdefinierte Sammlung anzeigen / bearbeiten ----------------- */
UI.openCustomCollectionDetail = async function (coll) {
  const fresh = await DB.get('collections', coll.id) || coll;
  const fields = fresh.custom_fields || [];

  /* Tabelle bestehender Einträge */
  const table = U.make('table', { class: 'data-table' });
  const thead = U.make('tr', {});
  fields.forEach((f) => thead.appendChild(U.make('th', { text: f.label })));
  thead.appendChild(U.make('th', { text: '' }));
  table.appendChild(thead);

  (fresh.entries || []).forEach((entry) => {
    const tr = U.make('tr', {});
    fields.forEach((f) => tr.appendChild(
      U.make('td', { text: entry[f.key] || '—' })));
    const del = U.make('button', { class: 'rl-del', title: 'Löschen' }, '✕');
    del.addEventListener('click', async () => {
      fresh.entries = fresh.entries.filter((e) => e.id !== entry.id);
      await DB.put('collections', fresh);
      UI.openCustomCollectionDetail(fresh);
    });
    tr.appendChild(U.make('td', {}, del));
    table.appendChild(tr);
  });

  /* Eingabezeile für neuen Eintrag */
  const inputs = {};
  const inputRow = U.make('div', {});
  fields.forEach((f) => {
    let inp;
    if (f.type === 'select') {
      inp = U.make('select', {});
      inp.appendChild(U.make('option', { value: '' }, '—'));
      (f.options || []).forEach((o) =>
        inp.appendChild(U.make('option', { value: o }, o)));
    } else {
      inp = U.make('input', { type: f.type === 'date' ? 'date' : 'text',
        placeholder: f.label });
    }
    inputs[f.key] = inp;
    inputRow.appendChild(U.make('div', { class: 'field' }, [
      U.make('label', { text: f.label }), inp]));
  });

  const addBtn = U.make('button', { class: 'btn btn-primary btn-block',
    text: '+ Eintrag hinzufügen' });
  addBtn.addEventListener('click', async () => {
    const entry = { id: U.uuid() };
    fields.forEach((f) => { entry[f.key] = inputs[f.key].value; });
    fresh.entries = fresh.entries || [];
    fresh.entries.push(entry);
    await DB.put('collections', fresh);
    UI.openCustomCollectionDetail(fresh);
  });

  const delColl = U.make('button', { class: 'btn btn-danger btn-block',
    text: 'Sammlung löschen' });
  delColl.addEventListener('click', async () => {
    await DB.del('collections', fresh.id);
    UI.closeModal(); U.toast('Sammlung gelöscht'); UI.render('collections');
  });

  UI.openModal(fresh.name, U.make('div', {}, [
    U.make('div', { class: 'table-scroll' }, [table]),
    U.make('div', { class: 'divider' }),
    U.make('h3', { text: 'Neuer Eintrag' }),
    inputRow, addBtn,
    U.make('div', { class: 'divider' }),
    delColl
  ]));
};

/* ========================================================================== *
 *  UI: AUFGABEN-MANAGER (zentraler Task-Manager mit Filter & Paginierung)
 * ========================================================================== */
UI.renderTasks = async function (main) {
  const days = await DB.getAll('days');
  const projects = await DB.getAll('projects');
  const people = await DB.getAll('people');

  /* Alle Aufgaben mit Tagesbezug einsammeln. */
  let all = [];
  days.forEach((d) => (d.tasks || []).forEach((t) => {
    all.push({ ...t, _ymd: d.id });
  }));

  main.innerHTML = '';
  main.appendChild(U.make('div', { class: 'view-head' }, [
    U.make('h1', { class: 'view-title', text: 'Aufgaben' }),
    U.make('div', { class: 'view-sub', text: all.length + ' Aufgaben gesamt' })
  ]));

  /* --- Filter- & Sortierleiste --- */
  const fStatus = U.make('select', {});
  [['all', 'Alle offenen'], ['today', 'Heute fällig'],
   ['week', 'Diese Woche'], ['overdue', 'Überfällig'],
   ['done', 'Erledigte'], ['withlink', 'Mit Terminverknüpfung'],
   ['nolink', 'Ohne Terminverknüpfung']]
    .forEach(([v, l]) => fStatus.appendChild(U.make('option', { value: v }, l)));

  const fProj = U.make('select', {});
  fProj.appendChild(U.make('option', { value: '' }, 'Alle Projekte'));
  projects.forEach((p) => fProj.appendChild(U.make('option', { value: p.id }, p.name)));

  const fPers = U.make('select', {});
  fPers.appendChild(U.make('option', { value: '' }, 'Alle Personen'));
  people.forEach((p) => fPers.appendChild(U.make('option', { value: p.id }, p.name)));

  const fSort = U.make('select', {});
  [['date', 'Sortieren: Datum'], ['project', 'Sortieren: Projekt'],
   ['person', 'Sortieren: Person']]
    .forEach(([v, l]) => fSort.appendChild(U.make('option', { value: v }, l)));

  const filterBar = U.make('div', { class: 'filter-bar no-print' },
    [fStatus, fProj, fPers, fSort]);
  main.appendChild(filterBar);

  const tableHost = U.make('div', {});
  main.appendChild(tableHost);

  /* --- Filter anwenden + Tabelle rendern --- */
  const applyAndRender = () => {
    const weekEnd = U.addDays(U.today(), 7);
    let rows = all.filter((t) => {
      switch (fStatus.value) {
        case 'all':      return !t.done;
        case 'done':     return t.done;
        case 'today':    return !t.done && t.due_date === U.today();
        case 'week':     return !t.done && t.due_date
                                && t.due_date >= U.today() && t.due_date <= weekEnd;
        case 'overdue':  return !t.done && t.due_date && t.due_date < U.today();
        case 'withlink': return !t.done && !!t.external_event_id;
        case 'nolink':   return !t.done && !t.external_event_id;
        default:         return !t.done;
      }
    });
    if (fProj.value) rows = rows.filter((t) => t.project_id === fProj.value);
    if (fPers.value) rows = rows.filter((t) => t.person_id === fPers.value);

    rows.sort((a, b) => {
      if (fSort.value === 'project') {
        const pa = (projects.find((p) => p.id === a.project_id) || {}).name || 'zzz';
        const pb = (projects.find((p) => p.id === b.project_id) || {}).name || 'zzz';
        return pa.localeCompare(pb);
      }
      if (fSort.value === 'person') {
        const pa = (people.find((p) => p.id === a.person_id) || {}).name || 'zzz';
        const pb = (people.find((p) => p.id === b.person_id) || {}).name || 'zzz';
        return pa.localeCompare(pb);
      }
      return (a.due_date || a._ymd).localeCompare(b.due_date || b._ymd);
    });

    /* Paginierung (50 pro Seite). */
    const totalPages = Math.max(1, Math.ceil(rows.length / CONFIG.TASKS_PER_PAGE));
    if (UI._tasksPage >= totalPages) UI._tasksPage = 0;
    const slice = rows.slice(
      UI._tasksPage * CONFIG.TASKS_PER_PAGE,
      (UI._tasksPage + 1) * CONFIG.TASKS_PER_PAGE);

    tableHost.innerHTML = '';

    /* Bulk-Erledigen */
    const bulkBtn = U.make('button', { class: 'btn btn-sm no-print',
      text: '✓ Sichtbare erledigen' });
    bulkBtn.addEventListener('click', async () => {
      for (const t of slice) {
        const day = await DB.getDay(t._ymd);
        const real = day.tasks.find((x) => x.id === t.id);
        if (real && !real.done) {
          real.done = true;
          if (real.recurring) real.last_completed = U.today();
        }
        await DB.saveDay(day);
      }
      U.toast(slice.length + ' Aufgaben erledigt', 'ok');
      UI.render('tasks');
    });
    tableHost.appendChild(U.make('div', { class: 'row-between',
      style: 'margin-bottom:.6rem' }, [
      U.make('div', { class: 'muted', text: rows.length + ' Treffer' }),
      bulkBtn
    ]));

    if (!slice.length) {
      tableHost.appendChild(U.make('div', { class: 'empty',
        text: 'Keine Aufgaben für diesen Filter.' }));
      return;
    }

    /* Tabelle */
    const table = U.make('table', { class: 'data-table' });
    const head = U.make('tr', {}, ['', 'Aufgabe', 'Tag', 'Projekt',
      'Person', 'Verknüpfter Termin'].map((h) => U.make('th', { text: h })));
    table.appendChild(head);

    slice.forEach((t) => {
      const proj = projects.find((p) => p.id === t.project_id);
      const pers = people.find((p) => p.id === t.person_id);
      const cb = U.make('input', { type: 'checkbox', class: 'task-check' });
      cb.checked = !!t.done;
      cb.addEventListener('change', async () => {
        const day = await DB.getDay(t._ymd);
        const real = day.tasks.find((x) => x.id === t.id);
        if (real) {
          real.done = cb.checked;
          if (real.done) { Mobile.haptic();
            if (real.recurring) real.last_completed = U.today(); }
        }
        await DB.saveDay(day);
        UI.render('tasks');
      });

      const linkCell = U.make('td', {});
      if (t.external_event_id) {
        const link = U.make('span', { class: 'chip ext-link', text: '📅 öffnen' });
        link.addEventListener('click', async () => {
          const ev = await DB.get('external_events', t.external_event_id);
          if (ev) UI.openExtEventModal(ev);
          else U.toast('Verknüpfter Termin wurde gelöscht', 'warn');
        });
        linkCell.appendChild(link);
      } else {
        linkCell.appendChild(document.createTextNode('—'));
      }

      const over = !t.done && t.due_date && t.due_date < U.today();
      const tr = U.make('tr', { class: 'clickable-row' }, [
        U.make('td', {}, cb),
        U.make('td', {}, [
          U.make('span', { style: t.done ? 'text-decoration:line-through;color:var(--muted)' : '',
            text: t.text }),
          t.recurring ? U.make('span', { class: 'chip recurring',
            style: 'margin-left:.3rem', text: '↻' }) : null
        ]),
        U.make('td', {}, [U.make('span', {
          class: over ? 'chip due-over' : '',
          text: U.shortDate(t.due_date || t._ymd) })]),
        U.make('td', { text: proj ? proj.name : '—' }),
        U.make('td', { text: pers ? pers.name : '—' }),
        linkCell
      ]);
      // Klick auf den Aufgabentext öffnet das Bearbeiten-Modal.
      // Checkbox, Chips und Verknüpfungs-Chip behalten ihre eigene Funktion.
      tr.addEventListener('click', async (e) => {
        if (e.target.closest('input,.chip')) return;
        const day = await DB.getDay(t._ymd);
        const real = (day.tasks || []).find((x) => x.id === t.id);
        if (real) UI.openTaskEditModal(real, day);
      });
      table.appendChild(tr);
    });
    tableHost.appendChild(U.make('div', { class: 'table-scroll' }, [table]));

    /* Pager */
    if (totalPages > 1) {
      const prev = U.make('button', { class: 'btn btn-sm', text: '‹ Zurück' });
      const next = U.make('button', { class: 'btn btn-sm', text: 'Weiter ›' });
      prev.disabled = UI._tasksPage === 0;
      next.disabled = UI._tasksPage >= totalPages - 1;
      prev.addEventListener('click', () => { UI._tasksPage--; applyAndRender(); });
      next.addEventListener('click', () => { UI._tasksPage++; applyAndRender(); });
      tableHost.appendChild(U.make('div', { class: 'pager no-print' }, [
        prev,
        U.make('span', { class: 'muted',
          text: `Seite ${UI._tasksPage + 1} / ${totalPages}` }),
        next
      ]));
    }
  };

  [fStatus, fProj, fPers, fSort].forEach((s) =>
    s.addEventListener('change', () => { UI._tasksPage = 0; applyAndRender(); }));
  applyAndRender();
};

/* ========================================================================== *
 *  UI: VOLLTEXTSUCHE
 * ========================================================================== */
UI.renderSearch = async function (main) {
  const projects = await DB.getAll('projects');
  const people = await DB.getAll('people');

  main.innerHTML = '';
  main.appendChild(U.make('div', { class: 'view-head' }, [
    U.make('h1', { class: 'view-title', text: 'Suche' })
  ]));

  const input = U.make('input', { type: 'text', id: 'search-input',
    placeholder: 'Suchbegriff … (Enter öffnet ersten Treffer, Esc schließt)' });
  main.appendChild(U.make('div', { class: 'search-box' }, [input]));

  /* Filterzeile */
  const from = U.make('input', { type: 'date' });
  const to = U.make('input', { type: 'date' });
  const fProj = U.make('select', {});
  fProj.appendChild(U.make('option', { value: '' }, 'Alle Projekte'));
  projects.forEach((p) => fProj.appendChild(U.make('option', { value: p.id }, p.name)));
  const fPers = U.make('select', {});
  fPers.appendChild(U.make('option', { value: '' }, 'Alle Personen'));
  people.forEach((p) => fPers.appendChild(U.make('option', { value: p.id }, p.name)));
  const fTag = U.make('input', { type: 'text', placeholder: 'Tag (Wissen)' });
  main.appendChild(U.make('div', { class: 'filter-bar no-print' },
    [from, to, fProj, fPers, fTag]));

  const resultsHost = U.make('div', {});
  main.appendChild(resultsHost);

  const doSearch = async () => {
    const results = await Search.run(input.value, {
      from: from.value || null, to: to.value || null,
      projectId: fProj.value || null, personId: fPers.value || null,
      tag: fTag.value.trim() || null
    });
    UI._searchState = { results, active: 0 };
    resultsHost.innerHTML = '';
    if (!results.length) {
      resultsHost.appendChild(U.make('div', { class: 'empty',
        text: input.value ? 'Keine Treffer.' : 'Begriff eingeben oder filtern …' }));
      return;
    }
    resultsHost.appendChild(U.make('div', { class: 'muted',
      style: 'margin-bottom:.5rem', text: results.length + ' Treffer' }));
    results.forEach((r, i) => {
      const node = U.make('div', {
        class: 'search-result' + (i === 0 ? ' active-result' : '') }, [
        U.make('div', { class: 'sr-type', text: r.type }),
        U.make('div', { class: 'sr-title',
          html: Search.highlight(r.title, input.value) }),
        U.make('div', { class: 'sr-preview',
          html: Search.highlight(r.preview, input.value) })
      ]);
      node.addEventListener('click', () => UI._openSearchResult(r));
      resultsHost.appendChild(node);
    });
  };

  input.addEventListener('input', U.debounce(doSearch, 220));
  [from, to, fProj, fPers].forEach((e) => e.addEventListener('change', doSearch));
  fTag.addEventListener('input', U.debounce(doSearch, 250));

  /* Enter öffnet ersten Treffer, Escape verlässt die Suche. */
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && UI._searchState.results.length) {
      UI._openSearchResult(UI._searchState.results[0]);
    } else if (e.key === 'Escape') {
      UI.render('day');
    }
  });

  setTimeout(() => input.focus(), 80);
  doSearch();
};

/* Öffnet einen Suchtreffer in der passenden Ansicht. */
UI._openSearchResult = function (r) {
  if (r.nav === 'day' && r.ymd) {
    Calendar.state.day = r.ymd;
    UI.render('day');
  } else if (r.knowledgeId) {
    UI.render('collections').then(async () => {
      const k = await DB.get('knowledge', r.knowledgeId);
      if (k) UI.openKnowledgeDetail(k);
    });
  } else {
    UI.render('collections');
  }
};

/* ========================================================================== *
 *  UI: EINSTELLUNGEN
 * ========================================================================== */
UI.renderSettings = async function (main) {
  main.innerHTML = '';
  main.appendChild(U.make('div', { class: 'view-head' }, [
    U.make('h1', { class: 'view-title', text: 'Einstellungen' })
  ]));

  /* --- Darstellung --- */
  const themeCard = U.make('div', { class: 'card' });
  themeCard.appendChild(U.make('div', { class: 'card-title' }, 'Darstellung'));

  const themeSel = U.make('select', {});
  [['system', 'System folgen'], ['light', 'Hell'], ['dark', 'Dunkel'],
   ['mono', 'Schwarz-Weiß']]
    .forEach(([v, l]) => themeSel.appendChild(U.make('option', { value: v }, l)));
  themeSel.value = U.lsGet('theme', 'system');
  themeSel.addEventListener('change', () => {
    App.applyTheme(themeSel.value);
    U.lsSet('theme', themeSel.value);
  });
  themeCard.appendChild(UI._settingRow('Farbschema',
    'Hell, dunkel, schwarz-weiß oder der Systemvorgabe folgen.', themeSel));

  const hapticSw = UI._switch(U.lsGet('haptic', true));
  hapticSw.input.addEventListener('change', () => {
    U.lsSet('haptic', hapticSw.input.checked);
  });
  themeCard.appendChild(UI._settingRow('Haptisches Feedback',
    'Kurze Vibration beim Erledigen einer Aufgabe (Mobilgeräte).', hapticSw.el));

  const debugSw = UI._switch(CONFIG.DEBUG);
  debugSw.input.addEventListener('change', () => {
    CONFIG.DEBUG = debugSw.input.checked;
    U.lsSet('debug', CONFIG.DEBUG);
  });
  themeCard.appendChild(UI._settingRow('Debug-Logs',
    'Konsolen-Ausgaben für die Entwicklung aktivieren.', debugSw.el));
  main.appendChild(themeCard);

  /* --- Externer Kalender (.ics) --- */
  const icsCard = U.make('div', { class: 'card' });
  icsCard.appendChild(U.make('div', { class: 'card-title' }, 'Externer Kalender'));
  icsCard.appendChild(U.make('p', { class: 'muted', style: 'margin-bottom:.6rem',
    text: 'Importiere eine .ics-Datei. Der Import ersetzt alle bisherigen '
      + 'externen Termine. Serientermine werden nur einmalig übernommen.' }));

  const icsInput = U.make('input', { type: 'file', accept: '.ics,text/calendar' });
  const icsBtn = U.make('button', { class: 'btn btn-primary',
    text: '📅 Kalender importieren (.ics)' });
  const icsProgress = U.make('div', { class: 'progress-track hidden',
    style: 'margin-top:.6rem' }, [U.make('div', { class: 'progress-fill',
      style: 'width:0%' })]);
  icsBtn.addEventListener('click', () => icsInput.click());
  icsInput.addEventListener('change', async () => {
    const file = icsInput.files[0];
    if (!file) return;
    icsProgress.classList.remove('hidden');
    const fill = U.qs('.progress-fill', icsProgress);
    try {
      const n = await ExtCal.importFile(file, (done, total) => {
        fill.style.width = (total ? (done / total * 100) : 100) + '%';
      });
      U.toast(`${n} Termine importiert`, 'ok');
    } catch (e) {
      U.toast('Import fehlgeschlagen: ' + e.message, 'warn');
    }
    setTimeout(() => icsProgress.classList.add('hidden'), 800);
    icsInput.value = '';
  });
  icsCard.appendChild(U.make('div', { class: 'btn-row' }, [icsBtn]));
  icsCard.appendChild(icsProgress);

  const extCount = (await DB.getAll('external_events')).length;
  icsCard.appendChild(U.make('div', { class: 'muted',
    style: 'margin-top:.5rem', text: `Aktuell ${extCount} externe Termine gespeichert.` }));
  main.appendChild(icsCard);

  /* --- Export / Import --- */
  const dataCard = U.make('div', { class: 'card' });
  dataCard.appendChild(U.make('div', { class: 'card-title' }, 'Daten · Export & Import'));

  const expEnc = U.make('button', { class: 'btn', text: '🔒 Verschlüsselt (.bujo)' });
  expEnc.addEventListener('click', () => {
    const pw = U.make('input', { type: 'password', placeholder: 'Passwort' });
    const go = U.make('button', { class: 'btn btn-primary btn-block',
      text: 'Verschlüsselt exportieren' });
    go.addEventListener('click', async () => {
      if (!pw.value) { U.toast('Passwort fehlt', 'warn'); return; }
      await ExportImport.exportEncrypted(pw.value);
      UI.closeModal();
    });
    UI.openModal('Verschlüsselter Export', U.make('div', {}, [
      U.make('p', { class: 'muted', style: 'margin-bottom:.6rem',
        text: 'Die .bujo-Datei wird mit AES-256 verschlüsselt. '
          + 'Ohne Passwort ist sie nicht lesbar.' }),
      U.make('div', { class: 'field' }, [
        U.make('label', { text: 'Passwort' }), pw]),
      go
    ]));
  });

  const expJson = U.make('button', { class: 'btn', text: '📄 Unverschlüsselt (.json)' });
  expJson.addEventListener('click', () => ExportImport.exportJson());

  dataCard.appendChild(U.make('div', { class: 'section-label', text: 'Export' }));
  dataCard.appendChild(U.make('div', { class: 'btn-row' }, [expEnc, expJson]));

  /* Import */
  const impInput = U.make('input', { type: 'file', accept: '.bujo,.json' });
  const impBtn = U.make('button', { class: 'btn btn-primary',
    text: '📥 Datei importieren' });
  impBtn.addEventListener('click', () => impInput.click());
  impInput.addEventListener('change', () => {
    const file = impInput.files[0];
    if (!file) return;
    UI._openImportModal(file);
    impInput.value = '';
  });
  dataCard.appendChild(U.make('div', { class: 'section-label',
    style: 'margin-top:1rem', text: 'Import' }));
  dataCard.appendChild(U.make('div', { class: 'btn-row' }, [impBtn]));
  dataCard.appendChild(U.make('div', { class: 'muted', style: 'margin-top:.5rem',
    text: 'Vor jedem Import wird automatisch ein Sicherheits-Backup angelegt.' }));
  main.appendChild(dataCard);

  /* --- Datenschutz --- */
  const privCard = U.make('div', { class: 'card' });
  privCard.appendChild(U.make('div', { class: 'card-title' }, 'Datenschutz & Sicherheit'));
  privCard.appendChild(U.make('div', { class: 'privacy-box', html:
    'Alle Journal-Daten bleiben <strong>ausschließlich lokal</strong> auf '
    + 'diesem Gerät (IndexedDB im Browser).'
    + '<ul>'
    + '<li>Keine Cloud, kein Server, keine Konten.</li>'
    + '<li>Kein Tracking, keine Analytics, keine Cookies.</li>'
    + '<li>Export auf Wunsch AES-256-verschlüsselt.</li>'
    + '<li>Der .ics-Import läuft rein lokal — es wird keine Kalender-API '
    + 'kontaktiert.</li>'
    + '<li>Einzige externe Ressource: die CryptoJS-Bibliothek vom CDN '
    + '(nur für die Verschlüsselung).</li>'
    + '</ul>' }));
  main.appendChild(privCard);

  /* --- Gefahrenzone --- */
  const dangerCard = U.make('div', { class: 'card' });
  dangerCard.appendChild(U.make('div', { class: 'card-title' }, 'Zurücksetzen'));
  const resetBtn = U.make('button', { class: 'btn btn-danger',
    text: '⚠ Alle Daten löschen' });
  resetBtn.addEventListener('click', () => {
    const confirmBtn = U.make('button', { class: 'btn btn-danger btn-block',
      text: 'Ja, unwiderruflich alles löschen' });
    confirmBtn.addEventListener('click', async () => {
      for (const s of CONFIG.STORES) await DB.clear(s);
      U.lsDel('autobackup');
      UI.closeModal();
      U.toast('Alle Daten gelöscht', 'warn');
      UI.render('day');
    });
    UI.openModal('Wirklich alles löschen?', U.make('div', {}, [
      U.make('p', { class: 'muted', style: 'margin-bottom:.8rem',
        text: 'Dieser Schritt entfernt sämtliche Tage, Projekte, Personen, '
          + 'Aufgaben und Termine. Exportiere vorher ein Backup!' }),
      confirmBtn
    ]));
  });
  dangerCard.appendChild(resetBtn);
  main.appendChild(dangerCard);

  /* --- Über --- */
  main.appendChild(U.make('div', { class: 'card' }, [
    U.make('div', { class: 'card-title' }, 'Über'),
    U.make('p', { class: 'muted',
      text: 'Digitales Bullet Journal · PWA · Version 1. '
        + 'Vanilla HTML/CSS/JS, offline-fähig, GitHub-Pages-tauglich. '
        + 'Drücke „?“ für alle Tastaturkürzel.' })
  ]));
};

/* Hilfs-Renderer für eine Einstellungs-Zeile. */
UI._settingRow = function (label, desc, control) {
  return U.make('div', { class: 'setting-row' }, [
    U.make('div', {}, [
      U.make('div', { class: 'sr-label', text: label }),
      U.make('div', { class: 'sr-desc', text: desc })
    ]),
    control
  ]);
};

/* Hilfs-Renderer für einen Schalter. */
UI._switch = function (checked) {
  const input = U.make('input', { type: 'checkbox' });
  input.checked = !!checked;
  const el = U.make('label', { class: 'switch' }, [
    input, U.make('span', { class: 'slider' })
  ]);
  return { el, input };
};

/* Import-Modal mit Modus-Wahl und ggf. Passwort. */
UI._openImportModal = function (file) {
  const isEnc = file.name.endsWith('.bujo');
  const pw = U.make('input', { type: 'password', placeholder: 'Passwort der .bujo-Datei' });
  const mode = U.make('select', {});
  [['overwrite', 'Überschreiben — alle vorhandenen Daten ersetzen'],
   ['merge', 'Zusammenführen nach ID'],
   ['newids', 'Neue IDs vergeben (Duplikate möglich)']]
    .forEach(([v, l]) => mode.appendChild(U.make('option', { value: v }, l)));

  const go = U.make('button', { class: 'btn btn-primary btn-block', text: 'Importieren' });
  go.addEventListener('click', async () => {
    try {
      await ExportImport.importFile(file, pw.value, mode.value);
      UI.closeModal();
      U.toast('Import erfolgreich', 'ok');
      UI.render('day');
    } catch (e) {
      U.toast('Import fehlgeschlagen: ' + e.message, 'warn');
    }
  });

  UI.openModal('Daten importieren', U.make('div', {}, [
    U.make('p', { class: 'muted', style: 'margin-bottom:.6rem',
      text: 'Datei: ' + file.name }),
    isEnc ? U.make('div', { class: 'field' }, [
      U.make('label', { text: 'Passwort' }), pw]) : null,
    U.make('div', { class: 'field' }, [
      U.make('label', { text: 'Import-Modus' }), mode]),
    go
  ]));
};

/* ========================================================================== *
 *  MODUL: migration — Datenmodell aktuell halten
 * ----------------------------------------------------------------------------
 *  Wandelt frühere Tagesnotizen (Feld "notes") einmalig in Journal-Blöcke um
 *  und stellt sicher, dass jeder Block eine ID besitzt. Idempotent: der
 *  Marker _notesMigrated verhindert mehrfaches Ausführen.
 * ========================================================================== */
const Migration = {
  REFL_MARKER: '__monatsreflexion__',

  async run() {
    const days = await DB.getAll('days');
    let touched = 0;

    for (const d of days) {
      let changed = false;
      if (!Array.isArray(d.rapid_logging)) { d.rapid_logging = []; changed = true; }

      // Jeder Block braucht eine eindeutige ID.
      for (const b of d.rapid_logging) {
        if (!b.id) { b.id = U.uuid(); changed = true; }
        if (b.symbol == null) { b.symbol = '-'; changed = true; }
      }

      // Einmalige Übernahme alter Tagesnotizen in Blöcke.
      if (!d._notesMigrated) {
        const raw = d.notes || '';
        const parts = raw.split(Migration.REFL_MARKER);
        const plain = (parts[0] || '').trim();
        const refl = parts.length > 1 ? (parts[1] || '').trim() : '';

        if (plain) {
          // Jede nicht-leere Zeile wird zu einem Notiz-Block.
          plain.split('\n').map((s) => s.trim()).filter(Boolean)
            .forEach((line) => {
              d.rapid_logging.push({
                id: U.uuid(), symbol: '-', content: line,
                timestamp: d.updated_at || d.created_at || U.nowIso(),
                project_id: null, person_id: null
              });
            });
        }
        // Monatsreflexion bleibt im notes-Feld erhalten.
        d.notes = refl ? (Migration.REFL_MARKER + '\n' + refl) : '';
        d._notesMigrated = true;
        changed = true;
      }

      if (changed) { await DB.put('days', d); touched++; }
    }
    if (touched) log(`Migration: ${touched} Tag(e) aktualisiert`);
  }
};

/* ========================================================================== *
 *  MODUL: app — Bootstrap / Initialisierung
 * ========================================================================== */
const App = {
  deferredPrompt: null,

  /* Theme anwenden (system | light | dark | mono). */
  applyTheme(mode) {
    const root = document.documentElement;
    if (mode === 'light' || mode === 'dark' || mode === 'mono') {
      root.setAttribute('data-theme', mode);
    } else {
      root.removeAttribute('data-theme');     // System-Präferenz greift
    }
  },

  /* Globale Event-Listener verdrahten. */
  bindGlobalEvents() {
    /* Navigation (Sidebar + Bottom-Nav). */
    U.qsa('[data-nav]').forEach((btn) => {
      btn.addEventListener('click', () => {
        // Beim erneuten Klick auf "Sammlungen" zur Übersicht zurück.
        if (btn.dataset.nav === 'collections') UI._collSub = null;
        UI.render(btn.dataset.nav);
      });
    });

    /* Sidebar ein-/ausklappen. */
    U.el('sidebar-toggle').addEventListener('click', () => {
      U.el('app').classList.toggle('sidebar-collapsed');
    });

    /* Theme-Toggle in der Topbar (zyklisch: system → light → dark → mono). */
    U.el('theme-toggle').addEventListener('click', () => {
      const cycle = ['system', 'light', 'dark', 'mono'];
      const cur = U.lsGet('theme', 'system');
      const next = cycle[(cycle.indexOf(cur) + 1) % cycle.length];
      App.applyTheme(next);
      U.lsSet('theme', next);
      const label = { system: 'System', light: 'Hell',
        dark: 'Dunkel', mono: 'Schwarz-Weiß' }[next];
      U.toast('Theme: ' + label);
    });

    /* Hilfe-Overlay. */
    U.el('help-btn').addEventListener('click', () => UI.openHelp());

    /* FAB -> Schnellnotiz (Touch + Klick für schnelles Feedback). */
    const fab = U.el('fab');
    fab.addEventListener('click', () => UI.openQuickNote(''));
    fab.addEventListener('touchstart', (e) => {
      e.preventDefault();
      UI.openQuickNote('');
    }, { passive: false });

    /* Modal- und Hilfe-Schließen (Backdrop / X-Button). */
    document.querySelectorAll('[data-close]').forEach((el) => {
      el.addEventListener('click', () => {
        UI.closeModal();
        UI.closeHelp();
      });
    });

    /* Install-Prompt (Android / Desktop). */
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      App.deferredPrompt = e;
      const btn = U.el('install-btn');
      btn.hidden = false;
      btn.addEventListener('click', async () => {
        btn.hidden = true;
        App.deferredPrompt.prompt();
        await App.deferredPrompt.userChoice;
        App.deferredPrompt = null;
      });
    });

    /* Auto-Backup beim Schließen der App. */
    window.addEventListener('beforeunload', () => {
      ExportImport.autoBackup();
    });

    /* Swipe-Gesten auf dem Hauptbereich. */
    Mobile.bindSwipe(U.el('main-view'));
  },

  /* Service Worker registrieren — RELATIVE Pfade (GitHub-Pages-tauglich). */
  registerSW() {
    if ('serviceWorker' in navigator) {
      window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { scope: './' })
          .then((reg) => log('Service Worker registriert:', reg.scope))
          .catch((err) => warn('SW-Registrierung fehlgeschlagen', err));
      });
    }
  },

  /* App-Start. */
  async init() {
    log('App startet …');

    // Persistierte Einstellungen anwenden.
    App.applyTheme(U.lsGet('theme', 'system'));
    CONFIG.DEBUG = U.lsGet('debug', CONFIG.DEBUG);

    // IndexedDB öffnen.
    try {
      await DB.open();
    } catch (e) {
      U.el('main-view').innerHTML =
        '<div class="empty">IndexedDB konnte nicht geöffnet werden. '
        + 'Bitte privaten Modus deaktivieren oder einen anderen Browser nutzen.</div>';
      return;
    }

    // Erststart-Logik: Demo-Daten oder Auto-Backup-Wiederherstellung.
    if (await DB.isEmpty()) {
      const backup = ExportImport.readAutoBackup();
      if (backup) {
        // Bei leerer DB + vorhandenem Backup: Wiederherstellung anbieten.
        await App._offerRestore(backup);
      } else {
        await Demo.seed();
      }
    }

    // Datenmodell migrieren (alte Notizen -> Journal-Blöcke).
    await Migration.run();

    // Wiederkehrende Aufgaben bis heute generieren.
    await Recurring.generate();

    // Wissens-Backlinks initial aufbauen.
    await Backlinks.refreshKnowledgeBacklinks();

    // Globale Events + Tastatur.
    App.bindGlobalEvents();
    Keyboard.init();

    // Share-Target / Shortcut-Parameter auswerten.
    Mobile.handleShareTarget();

    // Startansicht — ggf. ?view=day aus dem Manifest-Shortcut.
    const startView = new URLSearchParams(location.search).get('view') || 'day';
    await UI.render(startView);

    // Service Worker.
    App.registerSW();

    log('App bereit.');
  },

  /* Fragt bei leerer DB, ob ein Auto-Backup wiederhergestellt werden soll. */
  async _offerRestore(backup) {
    return new Promise((resolve) => {
      const yes = U.make('button', { class: 'btn btn-primary btn-block',
        text: 'Backup wiederherstellen' });
      const no = U.make('button', { class: 'btn btn-block',
        text: 'Neu starten (Demo-Daten)' });
      yes.addEventListener('click', async () => {
        await ExportImport.restoreFromData(backup.data);
        UI.closeModal();
        U.toast('Backup wiederhergestellt', 'ok');
        resolve();
      });
      no.addEventListener('click', async () => {
        await Demo.seed();
        UI.closeModal();
        resolve();
      });
      UI.openModal('Wiederherstellung', U.make('div', {}, [
        U.make('p', { class: 'muted', style: 'margin-bottom:.8rem',
          text: `Es wurde ein automatisches Backup vom `
            + `${new Date(backup.at).toLocaleString('de-DE')} gefunden. `
            + `Möchtest du es wiederherstellen?` }),
        yes,
        U.make('div', { style: 'height:.5rem' }),
        no
      ]));
    });
  }
};

/* App starten, sobald das DOM bereit ist. */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}
