/* db.js — storage layer.

   Two backends behind one API:
     • IndexedDB  — the real one. Holds project records AND video blobs/frames.
     • Fallback   — used when IndexedDB is unavailable (Chrome blocks it on
                    file://, and private windows can refuse it). Project records
                    go to localStorage so they still survive a reload; video
                    blobs go to memory and are lost when the tab closes.

   Callers never branch on which backend is live — they check CF.db.degraded
   only to decide whether to show the user a warning. */

(function (CF) {
  'use strict';

  var DB_NAME = 'clipforge';
  var DB_VERSION = 2;
  var STORE_PROJECTS = 'projects';
  var STORE_VIDEOS = 'videos';
  var STORE_AI = 'aicache';
  var LS_PROJECTS = 'cf_projects';
  var LS_SETTINGS = 'cf_settings';

  var idb = null;            /* live IDBDatabase, or null when degraded */
  var memVideos = {};        /* fallback video store: id -> record */
  var memProjects = null;    /* fallback project cache, mirrored to localStorage */
  var memAi = {};            /* fallback AI cache: key -> record */

  var db = {
    ready: false,
    degraded: false,
    reason: ''
  };
  CF.db = db;

  /* ------------------------------------------------------------- settings */

  var SETTINGS_DEFAULTS = {
    language: CF.DEFAULT_LANGUAGE,
    timeBudget: CF.DEFAULT_TIME_BUDGET,
    faceFree: true,
    aiModel: '',              /* empty = whatever the server defaults to */
    lastTab: 'create',
    projectSort: 'recent'     /* 'recent' | 'score' */
  };

  db.loadSettings = function () {
    var out = {};
    for (var k in SETTINGS_DEFAULTS) out[k] = SETTINGS_DEFAULTS[k];
    try {
      var raw = localStorage.getItem(LS_SETTINGS);
      if (raw) {
        var saved = JSON.parse(raw);
        for (var j in saved) {
          if (Object.prototype.hasOwnProperty.call(SETTINGS_DEFAULTS, j)) out[j] = saved[j];
        }
      }
    } catch (e) { /* corrupt or unavailable — defaults are fine */ }
    return out;
  };

  db.saveSettings = function (settings) {
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(settings));
      return true;
    } catch (e) {
      return false;
    }
  };

  /* ------------------------------------------------------------ IndexedDB */

  function openIndexedDB() {
    return new Promise(function (resolve) {
      var idbFactory = null;
      try { idbFactory = window.indexedDB; } catch (e) { idbFactory = null; }
      if (!idbFactory) { resolve({ ok: false, reason: 'IndexedDB not available in this browser context' }); return; }

      var req;
      try { req = idbFactory.open(DB_NAME, DB_VERSION); }
      catch (e) { resolve({ ok: false, reason: e.message || 'IndexedDB open threw' }); return; }

      /* Some browsers never fire any event on a blocked open (file:// especially),
         so a timeout is the only reliable way out. */
      var settled = false;
      var finish = function (result) {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      setTimeout(function () { finish({ ok: false, reason: 'IndexedDB did not respond' }); }, 4000);

      req.onupgradeneeded = function (ev) {
        var d = ev.target.result;
        if (!d.objectStoreNames.contains(STORE_PROJECTS)) d.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(STORE_VIDEOS)) d.createObjectStore(STORE_VIDEOS, { keyPath: 'id' });
        if (!d.objectStoreNames.contains(STORE_AI)) d.createObjectStore(STORE_AI, { keyPath: 'key' });
      };
      req.onsuccess = function () { finish({ ok: true, db: req.result }); };
      req.onerror = function () {
        finish({ ok: false, reason: (req.error && req.error.message) || 'IndexedDB was refused' });
      };
      req.onblocked = function () { finish({ ok: false, reason: 'IndexedDB is blocked by another tab' }); };
    });
  }

  function tx(storeName, mode) {
    return idb.transaction(storeName, mode).objectStore(storeName);
  }

  function wrap(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error || new Error('storage request failed')); };
    });
  }

  /* --------------------------------------------------------------- fallback */

  function lsProjectsRead() {
    if (memProjects) return memProjects;
    memProjects = {};
    try {
      var raw = localStorage.getItem(LS_PROJECTS);
      if (raw) {
        var arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          arr.forEach(function (p) { if (p && p.id) memProjects[p.id] = p; });
        }
      }
    } catch (e) { /* start empty rather than throw */ }
    return memProjects;
  }

  function lsProjectsWrite() {
    var all = lsProjectsRead();
    var arr = Object.keys(all).map(function (k) { return all[k]; });
    try {
      localStorage.setItem(LS_PROJECTS, JSON.stringify(arr));
      return true;
    } catch (e) {
      return false;
    }
  }

  /* ------------------------------------------------------------------ init */

  db.init = function () {
    return openIndexedDB().then(function (res) {
      if (res.ok) {
        idb = res.db;
        db.degraded = false;
        db.reason = '';
      } else {
        idb = null;
        db.degraded = true;
        db.reason = res.reason;
        lsProjectsRead();
      }
      db.ready = true;
      return db;
    });
  };

  /* -------------------------------------------------------------- projects */

  db.putProject = function (project) {
    project.updatedAt = new Date().toISOString();
    if (idb) return wrap(tx(STORE_PROJECTS, 'readwrite').put(project)).then(function () { return project; });
    var all = lsProjectsRead();
    all[project.id] = project;
    lsProjectsWrite();
    return Promise.resolve(project);
  };

  db.getProject = function (id) {
    if (idb) return wrap(tx(STORE_PROJECTS, 'readonly').get(id)).then(function (r) { return r || null; });
    return Promise.resolve(lsProjectsRead()[id] || null);
  };

  db.allProjects = function () {
    if (idb) {
      return wrap(tx(STORE_PROJECTS, 'readonly').getAll()).then(function (list) {
        return sortNewestFirst(list || []);
      });
    }
    var all = lsProjectsRead();
    return Promise.resolve(sortNewestFirst(Object.keys(all).map(function (k) { return all[k]; })));
  };

  function sortNewestFirst(list) {
    return list.slice().sort(function (a, b) {
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }

  db.deleteProject = function (id) {
    if (idb) return wrap(tx(STORE_PROJECTS, 'readwrite').delete(id));
    var all = lsProjectsRead();
    delete all[id];
    lsProjectsWrite();
    return Promise.resolve();
  };

  /* ---------------------------------------------------------------- videos */

  /* A video record: { id, blob, thumb, frames:[{t,dataUrl}], name, type, size } */

  db.putVideo = function (record) {
    if (idb) return wrap(tx(STORE_VIDEOS, 'readwrite').put(record)).then(function () { return true; });
    memVideos[record.id] = record;
    return Promise.resolve(false); /* false = not durable across a reload */
  };

  db.getVideo = function (id) {
    if (idb) return wrap(tx(STORE_VIDEOS, 'readonly').get(id)).then(function (r) { return r || null; });
    return Promise.resolve(memVideos[id] || null);
  };

  db.deleteVideo = function (id) {
    if (idb) return wrap(tx(STORE_VIDEOS, 'readwrite').delete(id));
    delete memVideos[id];
    return Promise.resolve();
  };

  /* Everything except the blob — used by list screens so we never pull a
     50 MB Blob into memory just to draw a thumbnail. */
  db.getVideoMeta = function (id) {
    return db.getVideo(id).then(function (rec) {
      if (!rec) return null;
      return {
        id: rec.id,
        thumb: rec.thumb || null,
        frames: rec.frames || [],
        name: rec.name,
        type: rec.type,
        size: rec.size,
        hasBlob: !!rec.blob
      };
    });
  };

  /* -------------------------------------------------------------- AI cache */

  /* Keyed on fingerprint + prompt version + model + kind, so the same clip is
     never sent to Gemini twice for the same question. This is what keeps the
     app inside a free-tier quota. */

  db.getAi = function (key) {
    if (idb) return wrap(tx(STORE_AI, 'readonly').get(key)).then(function (r) { return r || null; });
    return Promise.resolve(memAi[key] || null);
  };

  db.putAi = function (record) {
    record.storedAt = new Date().toISOString();
    if (idb) return wrap(tx(STORE_AI, 'readwrite').put(record)).then(function () { return record; });
    memAi[record.key] = record;
    return Promise.resolve(record);
  };

  db.deleteAi = function (key) {
    if (idb) return wrap(tx(STORE_AI, 'readwrite').delete(key));
    delete memAi[key];
    return Promise.resolve();
  };

  db.countAi = function () {
    if (idb) return wrap(tx(STORE_AI, 'readonly').getAllKeys()).then(function (k) { return (k || []).length; });
    return Promise.resolve(Object.keys(memAi).length);
  };

  /* ----------------------------------------------------------------- misc */

  db.estimate = function () {
    if (navigator.storage && navigator.storage.estimate) {
      return navigator.storage.estimate().then(function (e) {
        return { usage: e.usage || 0, quota: e.quota || 0 };
      }).catch(function () { return null; });
    }
    return Promise.resolve(null);
  };

  db.clearAll = function () {
    var work = [];
    if (idb) {
      work.push(wrap(tx(STORE_PROJECTS, 'readwrite').clear()));
      work.push(wrap(tx(STORE_VIDEOS, 'readwrite').clear()));
      work.push(wrap(tx(STORE_AI, 'readwrite').clear()));
    } else {
      memVideos = {};
      memProjects = {};
      memAi = {};
      try { localStorage.removeItem(LS_PROJECTS); } catch (e) {}
    }
    return Promise.all(work);
  };

})(window.CF);
