/* ui.js — shared chrome: toasts, the single modal, tab switching, and the
   small markup builders every screen reuses. No screen-specific logic here. */

(function (CF) {
  'use strict';

  var U = CF.util;
  var ui = {};
  CF.ui = ui;

  ui.$ = function (sel) { return document.querySelector(sel); };

  /* ---------------------------------------------------------------- toasts */

  ui.toast = function (message, kind) {
    var host = ui.$('#toasts');
    if (!host) return;
    var el = document.createElement('div');
    el.className = 'toast' + (kind ? ' ' + kind : '');
    el.textContent = message;
    host.appendChild(el);
    setTimeout(function () {
      if (el && el.remove) el.remove();
    }, kind === 'err' ? 5200 : 3200);
  };

  /* ----------------------------------------------------------------- modal */

  ui.openModal = function (innerHtml) {
    var root = ui.$('#modalRoot');
    if (!root) return;
    root.innerHTML =
      '<div class="modal-back" data-action="modal-backdrop">' +
        '<div class="modal-box" data-modal-box>' + innerHtml + '</div>' +
      '</div>';
    document.body.style.overflow = 'hidden';
  };

  ui.closeModal = function () {
    var root = ui.$('#modalRoot');
    if (root) root.innerHTML = '';
    document.body.style.overflow = '';
  };

  ui.isModalOpen = function () {
    var root = ui.$('#modalRoot');
    return !!(root && root.innerHTML);
  };

  /* ------------------------------------------------------------------ tabs */

  ui.TABS = ['create', 'projects', 'queue', 'settings'];

  ui.showTab = function (tab) {
    ui.TABS.forEach(function (t) {
      var view = ui.$('#view-' + t);
      if (view) view.classList.toggle('hidden', t !== tab);
    });
    var btns = document.querySelectorAll('.navbtn');
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle('on', btns[i].dataset.tab === tab);
    }
    try { window.scrollTo({ top: 0 }); } catch (e) { /* not in every environment */ }
  };

  ui.setHtml = function (tab, html) {
    var view = ui.$('#view-' + tab);
    if (view) view.innerHTML = html;
  };

  /* ------------------------------------------------------- markup builders */

  ui.statusTag = function (status) {
    var s = CF.STATUSES.indexOf(status) >= 0 ? status : 'RAW';
    return '<span class="tag tag-' + s + '">' + U.esc(CF.STATUS_LABEL[s]) + '</span>';
  };

  ui.thumbImg = function (dataUrl, alt) {
    if (dataUrl) {
      return '<img class="thumb" src="' + U.esc(dataUrl) + '" alt="' + U.esc(alt || '') + '">';
    }
    return '<div class="thumb thumb-empty" aria-hidden="true">🎬</div>';
  };

  ui.chipRow = function (action, options, current) {
    return '<div class="chips">' + options.map(function (opt) {
      var value = opt[0], label = opt[1];
      var on = String(value) === String(current) ? ' on' : '';
      return '<button class="chip' + on + '" data-action="' + U.esc(action) + '" ' +
             'data-value="' + U.esc(value) + '">' + U.esc(label) + '</button>';
    }).join('') + '</div>';
  };

  ui.filmstrip = function (frames) {
    if (!frames || !frames.length) return '';
    return '<div class="filmstrip">' + frames.map(function (f) {
      return '<figure>' +
        '<img src="' + U.esc(f.dataUrl) + '" alt="frame at ' + U.esc(U.clock(f.t)) + '" loading="lazy">' +
        '<figcaption>' + U.esc(U.clock(f.t)) + '</figcaption>' +
      '</figure>';
    }).join('') + '</div>';
  };

  ui.note = function (text, kind) {
    return '<div class="note' + (kind ? ' note-' + kind : '') + '">' + text + '</div>';
  };

  ui.empty = function (icon, title, sub) {
    return '<div class="empty">' +
      '<div class="big">' + U.esc(icon) + '</div>' +
      '<div class="bold">' + U.esc(title) + '</div>' +
      (sub ? '<div class="small" style="margin-top:6px">' + U.esc(sub) + '</div>' : '') +
    '</div>';
  };

  /* An honest placeholder. The spec forbids buttons that pretend to work, so
     unbuilt features say plainly which phase they arrive in. */
  ui.comingSoon = function (title, phase, detail) {
    return '<div class="card">' +
      '<div class="row-between">' +
        '<div class="bold">' + U.esc(title) + '</div>' +
        '<span class="tag">Phase ' + U.esc(phase) + '</span>' +
      '</div>' +
      '<div class="small muted" style="margin-top:6px">' + U.esc(detail) + '</div>' +
    '</div>';
  };

  ui.confirm = function (title, body, confirmLabel, action, dataAttrs) {
    var attrs = '';
    var d = dataAttrs || {};
    Object.keys(d).forEach(function (k) {
      attrs += ' data-' + k + '="' + U.esc(d[k]) + '"';
    });
    ui.openModal(
      '<div class="modal-title">' + U.esc(title) + '</div>' +
      '<div class="small muted" style="margin-bottom:16px">' + U.esc(body) + '</div>' +
      '<div class="row" style="gap:8px">' +
        '<button class="btn-ghost" style="flex:1" data-action="close-modal">Cancel</button>' +
        '<button class="btn-danger" style="flex:1" data-action="' + U.esc(action) + '"' + attrs + '>' +
          U.esc(confirmLabel) + '</button>' +
      '</div>'
    );
  };

  /* ------------------------------------------------------- network pill */

  ui.renderNetwork = function () {
    var pill = ui.$('#netPill');
    if (!pill) return;
    var online = typeof navigator !== 'undefined' && navigator.onLine !== false;
    pill.className = 'net-pill ' + (online ? 'online' : 'offline');
    pill.textContent = online ? '● Online' : '● Offline';
    pill.title = online
      ? 'AI features can reach the network.'
      : 'Editing works offline. AI analysis needs a connection.';
  };

})(window.CF);
