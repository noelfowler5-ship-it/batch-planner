/* ai-client.js — the only file that talks to the network.

   Every call goes to a Netlify Function proxy, never straight to Google. The
   Gemini API key lives in a server environment variable and is never present
   in the browser.

   Every result is cached against fingerprint + prompt version + model, so the
   same clip is never analysed twice. That is what keeps this inside a free
   tier — see CF.aiCache below. */

(function (CF) {
  'use strict';

  var U = CF.util;
  var client = {};
  CF.ai = client;

  var ENDPOINTS = {
    analyze: '/api/gemini/analyze',
    generate: '/api/gemini/generate',
    models: '/api/gemini/models'
  };

  /* Bump when a prompt changes meaningfully — it invalidates cached results
     without touching anything else. Must match the functions' PROMPT_VERSION. */
  client.PROMPT_VERSION = 1;

  var TIMEOUT_MS = 90000;

  client.available = function () {
    return typeof location !== 'undefined' && /^https?:$/.test(location.protocol);
  };

  client.online = function () {
    return typeof navigator === 'undefined' || navigator.onLine !== false;
  };

  /* A single, honest reason why AI cannot run right now — or null if it can. */
  client.blockedReason = function () {
    if (!client.available()) {
      return 'AI needs the app to be served over http:// or https://. Opening the file directly cannot reach the server.';
    }
    if (!client.online()) {
      return 'You are offline. Editing still works — AI analysis needs a connection.';
    }
    return null;
  };

  function request(url, options) {
    var opts = options || {};
    var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (controller) controller.abort();
    }, opts.timeout || TIMEOUT_MS);

    var init = {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json' }
    };
    if (opts.body) init.body = JSON.stringify(opts.body);
    if (controller) init.signal = controller.signal;

    return fetch(url, init).then(function (res) {
      clearTimeout(timer);
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }

        if (!res.ok) {
          var message = (data && data.error) || describeHttp(res.status);
          var err = new Error(message);
          err.status = res.status;
          err.code = data && data.code;
          err.detail = data && data.detail;
          throw err;
        }
        if (!data) throw new Error('The server returned an empty response.');
        return data;
      });
    }).catch(function (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') {
        throw new Error('The AI request took too long and was cancelled. Try again, or use a shorter clip.');
      }
      if (err && err.message === 'Failed to fetch') {
        throw new Error('Could not reach the server. Check your connection.');
      }
      throw err;
    });
  }

  function describeHttp(status) {
    if (status === 404) {
      return 'The AI endpoint is not deployed. The Netlify functions need to be published for this site.';
    }
    if (status === 413) return 'That request was too large. Try a shorter clip.';
    if (status === 503) return 'The server has no Gemini API key configured yet.';
    return 'The server returned an error (' + status + ').';
  }

  /* ------------------------------------------------------------------ cache */

  var cache = {};
  CF.aiCache = cache;

  cache.key = function (parts) {
    return [
      parts.kind,
      parts.fingerprint || 'nofp',
      'p' + client.PROMPT_VERSION,
      parts.model || 'default',
      parts.language || '-'
    ].join('|');
  };

  cache.get = function (parts) {
    return CF.db.getAi(cache.key(parts)).catch(function () { return null; });
  };

  cache.put = function (parts, value) {
    return CF.db.putAi({
      key: cache.key(parts),
      kind: parts.kind,
      fingerprint: parts.fingerprint,
      promptVersion: client.PROMPT_VERSION,
      model: parts.model || 'default',
      language: parts.language || null,
      value: value
    }).catch(function () { return null; });
  };

  cache.drop = function (parts) {
    return CF.db.deleteAi(cache.key(parts)).catch(function () { return null; });
  };

  /* --------------------------------------------------------------- analysis */

  /* opts: { frames, duration, fingerprint, timeBudget, faceFree, model, force } */
  client.analyzeVideo = function (opts) {
    var blocked = client.blockedReason();
    if (blocked) return Promise.reject(new Error(blocked));

    var cacheParts = { kind: 'analyze', fingerprint: opts.fingerprint, model: opts.model };

    var lookup = opts.force ? Promise.resolve(null) : cache.get(cacheParts);

    return lookup.then(function (hit) {
      if (hit && hit.value) {
        return { analysis: hit.value, cached: true, model: hit.model };
      }
      if (!opts.frames || !opts.frames.length) {
        throw new Error('This project has no extracted frames to analyse.');
      }

      return request(ENDPOINTS.analyze, {
        method: 'POST',
        body: {
          frames: opts.frames,
          duration: opts.duration,
          timeBudget: opts.timeBudget,
          faceFree: opts.faceFree !== false,
          model: opts.model || undefined
        }
      }).then(function (data) {
        var checked = CF.aiSchema.validateAnalysis(data.analysis, opts.duration);
        if (!checked.ok) {
          var err = new Error(checked.errors[0] || 'The AI returned an unusable analysis.');
          err.code = 'bad_json';
          throw err;
        }
        return cache.put({ kind: 'analyze', fingerprint: opts.fingerprint, model: data.model }, checked.value)
          .then(function () {
            return { analysis: checked.value, cached: false, model: data.model, repairs: checked.repairs };
          });
      });
    });
  };

  /* ------------------------------------------------------------- generation */

  /* opts: { analysis, duration, fingerprint, language, timeBudget, model, force } */
  client.generateContent = function (opts) {
    var blocked = client.blockedReason();
    if (blocked) return Promise.reject(new Error(blocked));

    var cacheParts = {
      kind: 'generate',
      fingerprint: opts.fingerprint,
      model: opts.model,
      language: opts.language
    };

    var lookup = opts.force ? Promise.resolve(null) : cache.get(cacheParts);

    return lookup.then(function (hit) {
      if (hit && hit.value) {
        return { content: hit.value, cached: true, model: hit.model };
      }
      if (!opts.analysis) throw new Error('Analyse the clip before generating content.');

      return request(ENDPOINTS.generate, {
        method: 'POST',
        body: {
          analysis: opts.analysis,
          duration: opts.duration,
          language: opts.language,
          timeBudget: opts.timeBudget,
          model: opts.model || undefined
        }
      }).then(function (data) {
        var checked = CF.aiSchema.validateGeneration(data.content, opts.duration, data.language || opts.language);
        if (!checked.ok) {
          var err = new Error(checked.errors[0] || 'The AI returned unusable content.');
          err.code = 'bad_json';
          throw err;
        }
        return cache.put({
          kind: 'generate',
          fingerprint: opts.fingerprint,
          model: data.model,
          language: opts.language
        }, checked.value).then(function () {
          return { content: checked.value, cached: false, model: data.model, repairs: checked.repairs };
        });
      });
    });
  };

  /* ----------------------------------------------------------------- models */

  client.listModels = function () {
    var blocked = client.blockedReason();
    if (blocked) return Promise.reject(new Error(blocked));
    return request(ENDPOINTS.models, { timeout: 20000 });
  };

})(window.CF);
