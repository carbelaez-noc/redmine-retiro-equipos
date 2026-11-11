/* globals document, fetch */
(function() {
  'use strict';

  var state = { fields: null, rules: [], teams: [], entries: [], userTeam: '', trackerOpeningScope: false, requests: {}, bindTimer: null };
  var cache = window.__issueReasonCatalogCache || (window.__issueReasonCatalogCache = {
    config: null,
    configAt: 0,
    configKey: '',
    configPromise: null,
    options: {},
    optionPromises: {}
  });
  var CONFIG_TTL_MS = 5 * 60 * 1000;

  function idFor(fieldId) {
    return fieldId ? document.getElementById('issue_custom_field_values_' + fieldId) : null;
  }

  function metaInt(name) {
    var meta = document.querySelector('meta[name="' + name + '"]');
    return meta ? parseInt(meta.getAttribute('content') || '0', 10) : 0;
  }

  function currentStatusId() {
    var status = document.getElementById('issue_status_id');
    return status ? parseInt(status.value || '0', 10) : metaInt('issue-reason-status-id');
  }

  function currentTrackerId() {
    var tracker = document.getElementById('issue_tracker_id');
    return tracker ? parseInt(tracker.value || '0', 10) : (metaInt('issue-reason-tracker-id') || metaInt('fibrazo-issue-tracker-id'));
  }

  function currentProjectId() {
    var project = document.getElementById('issue_project_id');
    if (project) return parseInt(project.value || '0', 10);
    var reasonMeta = document.querySelector('meta[name="issue-reason-project-id"]');
    if (reasonMeta) return parseInt(reasonMeta.getAttribute('content') || '0', 10);
    var meta = document.querySelector('meta[name="issue-tabs-project-id"]');
    return meta ? parseInt(meta.getAttribute('content') || '0', 10) : 0;
  }

  function isFormWorkflowContext() {
    if (document.body.classList.contains('action-new') ||
        document.body.classList.contains('action-create') ||
        document.body.classList.contains('action-edit') ||
        document.body.classList.contains('action-update')) {
      return true;
    }
    return !!(document.querySelector('#update #attributes, form.edit_issue #attributes, form#issue-form #attributes'));
  }

  function isShowReadOnlyPage() {
    return document.body.classList.contains('action-show');
  }

  function isVisibleElement(element) {
    if (!element) return false;
    if (element.hidden) return false;
    var style = window.getComputedStyle ? window.getComputedStyle(element) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return !!(element.offsetWidth || element.offsetHeight || element.getClientRects().length);
  }

  function showIssueFormActivated() {
    return window.__fibrazoIssueFormActivated === true;
  }

  function activateIssueFormPlugins() {
    window.__fibrazoIssueFormActivated = true;
  }

  function hasActiveIssueForm() {
    if (document.body.classList.contains('action-new') ||
        document.body.classList.contains('action-create') ||
        document.body.classList.contains('action-edit') ||
        document.body.classList.contains('action-update')) {
      return true;
    }
    if (document.body.classList.contains('action-show') && !showIssueFormActivated()) return false;
    var update = document.querySelector('#update');
    if (update && isVisibleElement(update) && update.querySelector('#attributes')) return true;
    var form = document.querySelector('form#issue-form, form.edit_issue');
    return !!(form && isVisibleElement(form) && form.querySelector('#attributes'));
  }

  function ruleForCurrentIssue() {
    var statusId = currentStatusId();
    var trackerId = currentTrackerId();
    var projectId = currentProjectId();
    var candidates = (state.rules || []).filter(function(rule) {
      return parseInt(rule.status_id, 10) === statusId &&
        (!rule.tracker_id || parseInt(rule.tracker_id, 10) === trackerId) &&
        (!rule.project_id || parseInt(rule.project_id, 10) === projectId);
    });
    candidates.sort(function(a, b) {
      function score(rule) { return (rule.project_id ? 0 : 2) + (rule.tracker_id ? 0 : 1); }
      return score(a) - score(b);
    });
    return candidates[0] || null;
  }

  function fieldWrapper(select) {
    return select ? select.closest('p, .attribute, .splitcontentleft > *, .splitcontentright > *') : null;
  }

  function setNodeVisible(node, visible) {
    if (!node) return;
    node.hidden = !visible;
    node.classList.toggle('reason-catalog-hidden', !visible);
    node.style.display = visible ? '' : 'none';
  }

  function catalogFieldNodes(select) {
    var nodes = [];
    if (!select) return nodes;
    var wrapper = fieldWrapper(select);
    if (wrapper) nodes.push(wrapper);
    var cfId = String(select.id || '').replace('issue_custom_field_values_', '');
    if (cfId) {
      document.querySelectorAll('.attribute.cf_' + cfId).forEach(function(node) {
        if (nodes.indexOf(node) < 0) nodes.push(node);
      });
    }
    return nodes;
  }

  function setVisible(select, visible) {
    catalogFieldNodes(select).forEach(function(node) {
      setNodeVisible(node, visible);
    });
  }

  function setShowFieldVisible(fieldId, visible) {
    if (!fieldId) return;
    document.querySelectorAll('.attribute.cf_' + fieldId).forEach(function(node) {
      setNodeVisible(node, visible);
    });
  }

  function setRequired(select, required) {
    if (!select) return;
    if (required && !isElementFocusable(select)) required = false;
    select.required = !!required;
    select.setAttribute('aria-required', required ? 'true' : 'false');
    var wrapper = fieldWrapper(select);
    if (!wrapper) return;
    wrapper.classList.toggle('required', !!required);
    var label = wrapper.querySelector('label');
    if (!label) return;
    var textHost = label.querySelector(':scope > span:not(.required)') || label;
    Array.prototype.slice.call(label.querySelectorAll('.required, abbr.required')).forEach(function(m) {
      if (m.parentNode !== textHost) m.remove();
    });
    var mark = textHost.querySelector('.required, abbr.required');
    if (required) {
      if (!mark) {
        mark = document.createElement('abbr');
        mark.className = 'required';
        mark.title = 'Obligatorio';
        mark.textContent = '*';
        textHost.appendChild(document.createTextNode('\u00a0'));
        textHost.appendChild(mark);
      }
    } else if (mark) {
      var prev = mark.previousSibling;
      if (prev && prev.nodeType === 3 && !String(prev.textContent || '').trim()) prev.remove();
      mark.remove();
    }
  }

  function isElementFocusable(el) {
    if (!el) return false;
    if (el.hidden || el.disabled) return false;
    if (el.closest('[hidden], .reason-catalog-hidden')) return false;
    var style = window.getComputedStyle ? window.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    var wrapper = fieldWrapper(el);
    if (wrapper) {
      var wrapperStyle = window.getComputedStyle ? window.getComputedStyle(wrapper) : null;
      if (wrapper.hidden || wrapper.closest('[hidden]')) return false;
      if (wrapperStyle && (wrapperStyle.display === 'none' || wrapperStyle.visibility === 'hidden')) return false;
    }
    return true;
  }

  function neutralizeHiddenRequiredFields() {
    var ids = fieldIds();
    [
      ids.opening_team || ids.team,
      ids.closing_team || ids.team,
      ids.opening_category,
      ids.closing_category,
      ids.opening_subcategory,
      ids.closing_subcategory,
      ids.opening_reason,
      ids.closing_reason
    ].forEach(function(fieldId) {
      var select = idFor(fieldId);
      if (select && select.required && !isElementFocusable(select)) {
        setRequired(select, false);
        select.setCustomValidity('');
      }
    });
  }

  function replaceOptions(select, values, keepValue) {
    if (!select) return;
    // No reconstruir el select con foco: colapsa el dropdown nativo abierto.
    // Se difiere al blur (una sola vez); la cascada de los demas sigue.
    try {
      if (document.activeElement === select && !select._ircDeferArmed) {
        select._ircDeferArmed = true;
        var pendingArgs = arguments;
        select.addEventListener('blur', function onIrcBlur() {
          select.removeEventListener('blur', onIrcBlur);
          select._ircDeferArmed = false;
          replaceOptions.apply(null, pendingArgs);
        });
        return;
      }
    } catch (e) {}
    var list = (values || []).slice();
    var selected = keepValue ? (select.value || '') : '';
    // Conservar huérfano solo si keep=true y el select aún lo tiene (carga inicial legacy).
    // En cascada, el change de subcategoría/categoría vacía el motivo antes del refresh.
    if (keepValue && selected && list.indexOf(selected) < 0) list = list.concat([selected]);
    select.innerHTML = '';
    var blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '';
    select.appendChild(blank);
    list.forEach(function(value) {
      var opt = document.createElement('option');
      opt.value = value;
      opt.textContent = value;
      select.appendChild(opt);
    });
    select.value = (selected && list.indexOf(selected) >= 0) ? selected : '';
  }

  function issueIdFromForm() {
    var m = window.location.pathname.match(/\/issues\/(\d+)(?:\/|$)/);
    if (m) return m[1];
    var hid = document.querySelector('input[name="id"], input#issue_id');
    return hid ? String(hid.value || '').trim() : '';
  }

  function fetchOptions(params) {
    params = params || {};
    params.tracker_id = currentTrackerId();
    var query = Object.keys(params).map(function(key) {
      return encodeURIComponent(key) + '=' + encodeURIComponent(params[key] || '');
    }).join('&');
    var issueId = issueIdFromForm();
    if (issueId) query += '&issue_id=' + encodeURIComponent(issueId);
    var key = query;
    if (cache.options[key]) return Promise.resolve(cache.options[key]);
    if (!cache.optionPromises[key]) {
      cache.optionPromises[key] = fetch('/issue_reason_catalog/options?' + query, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' }
      }).then(function(response) {
        if (!response.ok) throw new Error('reason catalog options failed');
        return response.json();
      }).then(function(data) {
        cache.options[key] = data || {};
        return cache.options[key];
      }).catch(function(error) {
        cache.optionPromises[key] = null;
        throw error;
      });
    }
    return cache.optionPromises[key];
  }

  function fieldIds() {
    return state.fields || {};
  }

  // Correct hierarchy selectors:
  // Equipo → Categoría → Subcategoría → Motivo
  function fields() {
    var ids = fieldIds();
    if (!ids.opening_team && !ids.team) return null;
    return {
      openingTeam: idFor(ids.opening_team || ids.team),
      closingTeam: idFor(ids.closing_team || ids.team),
      openingCategory: idFor(ids.opening_category),
      closingCategory: idFor(ids.closing_category),
      openingSubcategory: idFor(ids.opening_subcategory),
      closingSubcategory: idFor(ids.closing_subcategory),
      openingReason: idFor(ids.opening_reason),
      closingReason: idFor(ids.closing_reason)
    };
  }

  function requireApplies() {
    try {
      var from = (state.requireFrom || '2026-09-17');
      var created = state.issueCreatedOn;
      if (!created) return true;
      return String(created).slice(0, 10) >= String(from).slice(0, 10);
    } catch (e) { return true; }
  }

  function applyKindVisibility(kind, rule) {
    var f = fields();
    var ids = fieldIds();
    var team = kind === 'opening' ? f && f.openingTeam : f && f.closingTeam;
    var category = kind === 'opening' ? f && f.openingCategory : f && f.closingCategory;
    var sub = kind === 'opening' ? f && f.openingSubcategory : f && f.closingSubcategory;
    var motivo = kind === 'opening' ? f && f.openingReason : f && f.closingReason;
    var teamId = kind === 'opening' ? (ids.opening_team || ids.team) : (ids.closing_team || ids.team);
    var catId = kind === 'opening' ? ids.opening_category : ids.closing_category;
    var subId = kind === 'opening' ? ids.opening_subcategory : ids.closing_subcategory;
    var motivoId = kind === 'opening' ? ids.opening_reason : ids.closing_reason;

    if (!isFormWorkflowContext()) {
      setShowFieldVisible(teamId, true);
      setShowFieldVisible(catId, true);
      setShowFieldVisible(subId, true);
      setShowFieldVisible(motivoId, true);
      return;
    }

    var groupVisible = !!(rule && rule[kind + '_visible']);
    // Casos migrados (creados antes del corte) cierran sin obligatoriedad.
    var groupRequired = !!(rule && rule[kind + '_required']) && requireApplies();
    var teamVal = team && String(team.value || '').trim();
    var catVal = category && String(category.value || '').trim();
    var subVal = sub && String(sub.value || '').trim();

    if (!groupVisible) {
      // En formulario de edición: si el caso ya trae valores guardados, se
      // mantienen visibles (integridad visual). Ocultarlas haría "desaparecer"
      // la apertura al pasar a Resuelto aun sin guardar.
      var motivoEl = motivo;
      var motivoVal = motivoEl && String(motivoEl.value || '').trim();
      if (isFormWorkflowContext() && (teamVal || catVal || subVal || motivoVal)) {
        setVisible(team, true);
        setVisible(category, true);
        setVisible(sub, true);
        setVisible(motivo, true);
        setRequired(team, false);
        setRequired(category, false);
        setRequired(sub, false);
        setRequired(motivo, false);
        neutralizeHiddenRequiredFields();
        return;
      }
      setVisible(team, false);
      setVisible(category, false);
      setVisible(sub, false);
      setVisible(motivo, false);
      [teamId, catId, subId, motivoId].forEach(function(fid) {
        if (fid) setShowFieldVisible(fid, false);
      });
      setRequired(team, false);
      setRequired(category, false);
      setRequired(sub, false);
      setRequired(motivo, false);
      neutralizeHiddenRequiredFields();
      return;
    }

    // Cascada progresiva: Equipo → Categoría → Subcategoría → Motivo
    setVisible(team, groupVisible);
    setVisible(category, groupVisible && !!teamVal);
    setVisible(sub, groupVisible && !!teamVal && !!catVal);
    setVisible(motivo, groupVisible && !!teamVal && !!catVal && !!subVal);

    // Si no hay categoría, vaciar opciones hijas (evita listas independientes).
    if (!catVal) {
      if (sub && !subVal) replaceOptions(sub, [], false);
      if (motivo) replaceOptions(motivo, [], false);
    } else if (!subVal && motivo) {
      replaceOptions(motivo, [], false);
    }

    setRequired(team, groupVisible && groupRequired);
    setRequired(category, groupVisible && groupRequired && !!teamVal);
    setRequired(sub, groupVisible && groupRequired && !!teamVal && !!catVal);
    setRequired(motivo, groupVisible && groupRequired && !!teamVal && !!catVal && !!subVal);
    neutralizeHiddenRequiredFields();
  }

  function applyRule() {
    var rule = ruleForCurrentIssue();
    applyKindVisibility('opening', rule);
    applyKindVisibility('closing', rule);
    if (window.IssueTabsNative && typeof window.IssueTabsNative.rebalanceFormFields === 'function') {
      var active = document.activeElement;
      window.requestAnimationFrame(function() {
        window.IssueTabsNative.rebalanceFormFields(null, active);
      });
    }
    neutralizeHiddenRequiredFields();
  }

  // Cascada: Equipo → Categoría → Subcategoría → Motivo
  function refreshKind(kind, keep) {
    var requestKey = (state.requests[kind] || 0) + 1;
    state.requests[kind] = requestKey;
    var f = fields();
    if (!f) return Promise.resolve();
    if (isShowReadOnlyPage() && !document.querySelector('#update:not([style*="display: none"]) #attributes')) {
      applyKindVisibility(kind, ruleForCurrentIssue());
      return Promise.resolve();
    }
    if (!isFormWorkflowContext()) {
      applyKindVisibility(kind, ruleForCurrentIssue());
      return Promise.resolve();
    }

    var team = kind === 'opening' ? f.openingTeam : f.closingTeam;
    var category = kind === 'opening' ? f.openingCategory : f.closingCategory;
    var sub = kind === 'opening' ? f.openingSubcategory : f.closingSubcategory;
    var motivo = kind === 'opening' ? f.openingReason : f.closingReason;
    var rule = ruleForCurrentIssue();
    var visible = !!(rule && rule[kind + '_visible']);

    if (!visible || !team) {
      applyKindVisibility(kind, rule);
      return Promise.resolve();
    }

    if (!team.value) {
      replaceOptions(category, [], keep);
      replaceOptions(sub, [], keep);
      replaceOptions(motivo, [], keep);
      applyKindVisibility(kind, rule);
      notifyUpdated();
      return Promise.resolve();
    }

    return fetchOptions({ team: team.value, kind: kind }).then(function(data) {
      if (state.requests[kind] !== requestKey) return null;
      replaceOptions(category, data.categorias || [], keep);
      // Subcategoría depende OBLIGATORIAMENTE de Categoría.
      if (!category || !String(category.value || '').trim()) {
        replaceOptions(sub, [], false);
        replaceOptions(motivo, [], false);
        applyKindVisibility(kind, rule);
        return null;
      }
      return fetchOptions({
        team: team.value,
        kind: kind,
        category: category.value
      });
    }).then(function(data) {
      if (!data || state.requests[kind] !== requestKey) {
        applyKindVisibility(kind, rule);
        return null;
      }
      if (data.subcategorias) replaceOptions(sub, data.subcategorias, keep);
      if (!sub || !String(sub.value || '').trim()) {
        replaceOptions(motivo, [], false);
        applyKindVisibility(kind, rule);
        return null;
      }
      // Motivo depende de Categoría + Subcategoría.
      if (!category || !String(category.value || '').trim()) {
        replaceOptions(motivo, [], false);
        applyKindVisibility(kind, rule);
        return null;
      }
      return fetchOptions({
        team: team.value,
        kind: kind,
        category: category.value,
        subcategory: sub.value
      });
    }).then(function(data) {
      if (!data || state.requests[kind] !== requestKey) {
        applyKindVisibility(kind, rule);
        return;
      }
      replaceOptions(motivo, data.motivos || [], keep);
      applyKindVisibility(kind, rule);
    }).catch(function() {
      applyKindVisibility(kind, rule);
    });
  }

  function notifyUpdated() {
    // Re-evaluar equipos (p. ej. cierre limitado a CX según categoría elegida).
    try { refreshTeamOptions(true); } catch (e) {}
    try { maybeAutoSwitchTracker(); } catch (eSw) {}
    document.dispatchEvent(new CustomEvent('issue-reason-catalog-updated', {
      detail: { rule: ruleForCurrentIssue(), statusId: currentStatusId(), edit: isFormWorkflowContext() }
    }));
  }

  function refreshAll(keep) {
    applyRule();
    Promise.all([refreshKind('opening', keep), refreshKind('closing', keep)]).then(notifyUpdated);
  }

  function reconcileClosingWithOpening() {
    var f = fields();
    if (!f || !f.openingTeam || !f.closingTeam) return Promise.resolve();
    var rule = ruleForCurrentIssue();
    if (!rule || !rule.closing_visible) return Promise.resolve();

    var opening = String(f.openingTeam.value || '').trim();
    if (!opening) return Promise.resolve();

    var closing = String(f.closingTeam.value || '').trim();
    var cat = f.closingCategory ? String(f.closingCategory.value || '').trim() : '';

    if (!closing) {
      f.closingTeam.value = opening;
      try { f.closingTeam.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      return Promise.resolve();
    }

    if (!cat) {
      if (closing !== opening) {
        f.closingTeam.value = opening;
        try { f.closingTeam.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      }
      return Promise.resolve();
    }

    return fetchOptions({ team: closing, kind: 'closing' }).then(function(data) {
      var cats = data.categorias || [];
      if (cats.indexOf(cat) >= 0) return;
      f.closingTeam.value = opening;
      [f.closingCategory, f.closingSubcategory, f.closingReason].forEach(function(el) {
        if (el) el.value = '';
      });
      try { f.closingTeam.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    }).catch(function() {});
  }

  function uniqueValues(values) {
    var seen = {};
    var out = [];
    (values || []).forEach(function(value) {
      var v = String(value || '').trim();
      if (!v || seen[v]) return;
      seen[v] = true;
      out.push(v);
    });
    return out;
  }

  function teamsFromEntries(kind) {
    return uniqueValues((state.entries || []).filter(function(entry) {
      return String(entry.kind || '').trim() === kind;
    }).map(function(entry) {
      return entry.team;
    })).sort();
  }

  function refreshTeamOptions(keep) {
    var f = fields();
    if (!f) return;
    var teams = (state.teams || []).slice();
    if (!state.trackerOpeningScope) {
      [f.openingTeam, f.closingTeam].forEach(function(team) {
        if (!team) return;
        var v = String(team.value || '').trim();
        if (v && teams.indexOf(v) < 0) teams.push(v);
      });
    } else if (f.closingTeam) {
      var closingValue = String(f.closingTeam.value || '').trim();
      if (closingValue && teams.indexOf(closingValue) < 0) teams.push(closingValue);
    }
    var openingTeams = state.trackerOpeningScope ? teamsFromEntries('opening') : teams;
    if (!openingTeams.length) openingTeams = teams;
    // Cierre con scope: si hay categoría de cierre elegida, limitar el equipo
    // a los que ofrecen esa categoría (devolución/titular -> CX; transferencia
    // conserva todos sus equipos). Sin categoría, todos.
    var closingTeams = teams;
    var autoClosingTeam = null;
    if (state.trackerOpeningScope && f.closingCategory) {
      var closingCat = String(f.closingCategory.value || '').trim();
      if (closingCat) {
        var ct = uniqueValues((state.entries || []).filter(function(entry) {
          return String(entry.kind || '').trim() === 'closing' &&
            String(entry.category || '').trim() === closingCat;
        }).map(function(entry) { return entry.team; })).sort();
        if (ct.length) {
          closingTeams = ct;
          if (ct.length === 1) autoClosingTeam = ct[0];
        }
      }
    }
    [f.openingTeam, f.closingTeam].forEach(function(team) {
      if (!team) return;
      var scopedOpening = state.trackerOpeningScope && team === f.openingTeam;
      var teamOptions = scopedOpening ? openingTeams : (team === f.closingTeam && state.trackerOpeningScope ? closingTeams : teams);
      var prev = team.value;
      replaceOptions(team, teamOptions, keep && (!scopedOpening || teamOptions.indexOf(prev) >= 0));
      if (team.value) return;
      if (team === f.closingTeam && autoClosingTeam) {
        team.value = autoClosingTeam;
      }
      var userTeam = (state.userTeam || '').trim();
      if (userTeam === 'Todos') userTeam = '';
      if (scopedOpening && teamOptions.length === 1) {
        team.value = teamOptions[0];
      }
      // Default solo desde perfil de usuario (CF Equipo), nunca CX por asignación ni auto-único.
      if (!team.value && userTeam && teamOptions.indexOf(userTeam) >= 0) {
        team.value = userTeam;
      }
      if (team.value && team.value !== prev) {
        try { team.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      }
    });
  }

  function isNewIssueSurface() {
    if (typeof window.isNewIssueSurface === 'function' && window.isNewIssueSurface !== isNewIssueSurface) {
      try { return window.isNewIssueSurface(); } catch (e) {}
    }
    if (!document.body) return false;
    if (document.body.classList.contains('action-new') || document.body.classList.contains('action-create')) return true;
    var path = window.location.pathname || '';
    return /\/issues\/new(?:\/|$|\?)/.test(path) || /\/projects\/[^\/]+\/issues\/new(?:\/|$|\?)/.test(path);
  }

  // Group id → catalog team. Also aliases for short labels (CX, I&M, PE, PI, Netops).
  var GROUP_TO_TEAM = {
    '5': 'NOC',
    '27': 'Customer Experience (CX)',
    '36': 'Instalaciones y Mantenimiento',
    '29': 'Planta externa',
    '30': 'Planta Interna',
    '187': 'Planta Interna',
    '67': 'NET Operations',
    '22': 'Marketing'
  };
  var TEAM_ALIASES = {
    'cx': 'Customer Experience (CX)',
    'customer experience (cx)': 'Customer Experience (CX)',
    'customer experience': 'Customer Experience (CX)',
    'i&m': 'Instalaciones y Mantenimiento',
    'im': 'Instalaciones y Mantenimiento',
    'instalaciones y mantenimiento': 'Instalaciones y Mantenimiento',
    'pe': 'Planta externa',
    'planta externa': 'Planta externa',
    'pi': 'Planta Interna',
    'planta interna': 'Planta Interna',
    'netops': 'NET Operations',
    'net operations': 'NET Operations',
    'noc': 'NOC',
    'marketing': 'Marketing',
    'pqrs': 'PQRS'
  };

  function normalizeTeamLabel(label) {
    var raw = String(label || '').replace(/^\s+/, '').replace(/^<<\s*|\s*>>$/g, '').trim();
    if (!raw || raw === '<< yo mismo >>') return '';
    var key = raw.toLowerCase();
    if (TEAM_ALIASES[key]) return TEAM_ALIASES[key];
    // Match against known catalog teams (case-insensitive)
    var teams = (state.teams || []).concat([
      'Customer Experience (CX)', 'Instalaciones y Mantenimiento', 'Planta externa',
      'Planta Interna', 'NET Operations', 'NOC', 'Marketing', 'PQRS', 'Equipo de Ingeniería'
    ]);
    for (var i = 0; i < teams.length; i++) {
      if (String(teams[i]).toLowerCase() === key) return teams[i];
    }
    return raw;
  }

  function setSelectValueSafe(select, value) {
    if (!select || value == null || value === '') return false;
    var v = String(value);
    var hasOpt = Array.prototype.some.call(select.options || [], function(o) {
      return o.value === v || o.text === v;
    });
    if (!hasOpt && select.tagName === 'SELECT') {
      try { select.add(new Option(v, v)); } catch (e) {}
    }
    select.value = v;
    return String(select.value || '') === v;
  }

  function syncEquipoFromAssignedTo(fromUserAction) {
    if (!fromUserAction) return;
    // En edición (issue ya creado), Asignado a lo gestiona fibrazo_traslados
    // (modal de cierre de área). No reescribir Equipo ni vaciar tipificación
    // de apertura/cierre: eso reiniciaba categoría/subcategoría/motivo.
    if (!isNewIssueSurface()) return;
    var assigned = document.getElementById('issue_assigned_to_id');
    if (!assigned) return;
    // No reescribir Asignado a desde Equipo (evita el salto a CX).
    var gid = parseInt(assigned.value || '0', 10);
    if (!gid) return;
    var teamName = GROUP_TO_TEAM[String(gid)];
    if (!teamName) {
      var opt = assigned.options[assigned.selectedIndex];
      var label = opt ? opt.textContent : '';
      teamName = normalizeTeamLabel(label);
    } else {
      teamName = normalizeTeamLabel(teamName);
    }
    if (!teamName) return;
    var f = fields();
    if (!f) return;
    var teamFields = [];
    // Solo en creación: sincronizar equipo apertura y cascada de tipificación.
    if (f.openingTeam) teamFields.push(f.openingTeam);
    if (!teamFields.length) return;
    var changed = false;
    teamFields.forEach(function(teamField) {
      if (!teamField) return;
      var cur = String(teamField.value || '').trim();
      if (cur && normalizeTeamLabel(cur) === teamName) return;
      if (setSelectValueSafe(teamField, teamName)) changed = true;
    });
    if (!changed) return;
    // Marcar para que listeners no interpreten esto como acción del usuario sobre Asignado a.
    assigned.dataset.ircSyncingEquipo = '1';
    try {
      teamFields.forEach(function(tf) { try { tf.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} });
      ['openingCategory', 'openingSubcategory', 'openingReason'].forEach(function(k) {
        var el = f[k];
        if (el) { el.value = ''; try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
      });
    } finally {
      window.setTimeout(function() { try { delete assigned.dataset.ircSyncingEquipo; } catch (e2) {} }, 0);
    }
  }

  function ensureOpeningTeamHelpButton() {
    var existing = document.getElementById('irc-opening-reason-help');
    // Solo en creación de issue. En editar/actualizar (issue ya creado) no mostrar.
    if (!isNewIssueSurface()) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    var f = fields();
    if (!f || !f.openingTeam) return;
    var sel = f.openingTeam;
    // Misma línea a la derecha del select (no dentro del label).
    if (sel.parentNode && sel.parentNode.querySelector('#irc-opening-reason-help')) return;
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'irc-opening-reason-help';
    btn.title = 'Buscar motivo en el catálogo';
    btn.setAttribute('aria-label', 'Buscar motivo');
    btn.textContent = '?';
    btn.style.cssText = 'display:inline-block;width:20px;height:20px;border-radius:999px;border:1px solid #93c5fd;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:800;cursor:pointer;line-height:1;padding:0;margin-left:6px;vertical-align:middle';
    // El select del tema suele ir en bloque: forzarlo en línea para compartir renglón.
    try {
      if (sel && getComputedStyle(sel).display === 'block') { sel.style.display = 'inline-block'; sel.style.verticalAlign = 'middle'; }
    } catch (e) {}
    sel.parentNode.insertBefore(btn, sel.nextSibling);
    // mousedown: el ? puede vivir dentro de <label>; sin esto el label enfoca
    // el select y dispara cascadas que reabren otros modales (p. ej. TV).
    btn.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (window.FibrazoTvFallas && window.FibrazoTvFallas.dismissCurrent) {
        try { window.FibrazoTvFallas.dismissCurrent(); } catch (err1) {}
      }
      if (window.FibrazoTvFallas && window.FibrazoTvFallas.suppressAutoOpen) {
        try { window.FibrazoTvFallas.suppressAutoOpen(4000); } catch (err2) {}
      }
      var ftvEarly = document.getElementById('ftv-modal');
      if (ftvEarly) ftvEarly.style.display = 'none';
    });
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      openOpeningSearchModal();
    });
  }

  var _openingSearchSelected = null;

  function buildOpeningSearchModal() {
    var old = document.getElementById('irc-opening-search-modal');
    if (old) return old;
    var modal = document.createElement('div');
    modal.id = 'irc-opening-search-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.cssText = 'display:none;position:fixed;z-index:100000;inset:0;background:rgba(15,23,42,.55);overflow:auto;padding:24px';
    modal.innerHTML =
      '<div style="background:#fff;border-radius:16px;max-width:720px;margin:6vh auto;padding:20px;box-shadow:0 24px 80px rgba(15,23,42,.35);font-family:inherit">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">' +
      '<div><h3 style="margin:0 0 4px;font-size:17px;color:#0f172a">Buscar motivo de apertura</h3>' +
      '<p style="margin:0;font-size:12px;color:#64748b">Escriba parte del motivo. Al usarlo se diligencian el equipo, la categoría, la subcategoría, el motivo y la sugerencia de asignado.</p></div>' +
      '<button type="button" id="irc-opening-search-close" style="border:0;background:#f1f5f9;color:#475569;border-radius:999px;width:30px;height:30px;cursor:pointer;font-weight:700">&times;</button></div>' +
      '<div style="display:flex;gap:8px;margin-bottom:10px">' +
      '<select id="irc-opening-search-team" aria-label="Filtrar por equipo" style="flex:0 0 240px;max-width:45%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px;background:#fff"></select>' +
      '<input type="search" id="irc-opening-search-q" placeholder="Buscar motivos" autocomplete="off" style="flex:1;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px">' +
      '</div>' +
      '<div id="irc-opening-search-results" style="max-height:280px;overflow:auto;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc"></div>' +
      '<div id="irc-opening-search-detail" style="display:none;margin-top:12px;padding:12px;border-radius:10px;border:1px solid #bfdbfe;background:#eff6ff">' +
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#1d4ed8;margin-bottom:8px">Pertenece a</div>' +
      '<div style="display:grid;grid-template-columns:120px 1fr;gap:6px 10px;font-size:13px;color:#0f172a">' +
      '<div style="color:#64748b">Equipo <span title="Área responsable de atender el caso; define asignados y permisos." style="cursor:help;border-bottom:1px dotted #94a3b8">?</span></div><div id="irc-opening-search-team" style="font-weight:700"></div>' +
      '<div style="color:#64748b">Categoría <span title="Familia del problema dentro del equipo." style="cursor:help;border-bottom:1px dotted #94a3b8">?</span></div><div id="irc-opening-search-cat"></div>' +
      '<div style="color:#64748b">Subcategoría <span title="Detalle técnico dentro de la categoría." style="cursor:help;border-bottom:1px dotted #94a3b8">?</span></div><div id="irc-opening-search-sub"></div>' +
      '<div style="color:#64748b">Motivo <span title="Causa específica; alimenta métricas y compensaciones." style="cursor:help;border-bottom:1px dotted #94a3b8">?</span></div><div id="irc-opening-search-reason" style="font-weight:600"></div>' +
      '</div>' +
      '<div id="irc-opening-search-obs" style="display:none;margin-top:10px;padding:8px 10px;border-radius:8px;background:#f0f9ff;font-size:11px;color:#0c4a6e"></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">' +
      '<button type="button" id="irc-opening-search-cancel" style="padding:8px 14px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#475569;cursor:pointer;font-size:13px">Cerrar</button>' +
      '<button type="button" id="irc-opening-search-use" style="padding:8px 16px;border:0;border-radius:10px;background:#2563eb;color:#fff;cursor:pointer;font-size:13px;font-weight:700">Usar</button>' +
      '</div></div>' +
      '<p id="irc-opening-search-empty" style="display:none;margin:10px 0 0;font-size:12px;color:#94a3b8">Sin coincidencias.</p>' +
      '<p id="irc-opening-search-hint" style="display:none;margin:10px 0 0;font-size:12px;color:#b45309">Seleccione un motivo de la lista y pulse Usar.</p></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function(e) {
      if (e.target === modal || e.target.id === 'irc-opening-search-close' || e.target.id === 'irc-opening-search-cancel') {
        modal.style.display = 'none';
      }
    });
    var q = modal.querySelector('#irc-opening-search-q');
    if (q) q.addEventListener('input', function() {
      var h = document.getElementById('irc-opening-search-hint');
      if (h) h.style.display = 'none';
      renderOpeningSearchResults(q.value);
    });
    var useBtn = modal.querySelector('#irc-opening-search-use');
    if (useBtn) useBtn.addEventListener('click', applyOpeningCatalogLine);
    var teamSel = modal.querySelector('#irc-opening-search-team');
    if (teamSel) teamSel.addEventListener('change', function() {
      var h = document.getElementById('irc-opening-search-hint');
      if (h) h.style.display = 'none';
      var input = document.getElementById('irc-opening-search-q');
      renderOpeningSearchResults(input ? input.value : '');
    });
    return modal;
  }

  function openingCatalogLines() {
    return (state.entries || []).filter(function(e) {
      return String(e.kind || '') === 'opening' && e.reason;
    });
  }

  function openingSelectedTeam() {
    var sel = document.getElementById('irc-opening-search-team');
    return sel ? String(sel.value || '').trim() : '';
  }

  // Equipos presentes en motivos de apertura (para filtrar: todos o uno puntual).
  function refreshOpeningTeamFilter() {
    var sel = document.getElementById('irc-opening-search-team');
    if (!sel) return;
    var prev = String(sel.value || '');
    var teams = [];
    openingCatalogLines().forEach(function(r) {
      var t = String(r.team || '').trim();
      if (t && teams.indexOf(t) < 0) teams.push(t);
    });
    teams.sort(function(a, b) { return a.localeCompare(b); });
    sel.innerHTML = '';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = 'Todos los equipos (' + teams.length + ')';
    sel.appendChild(all);
    teams.forEach(function(t) {
      var o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      sel.appendChild(o);
    });
    sel.value = teams.indexOf(prev) >= 0 ? prev : '';
  }

  function ircFold(s) {
    return String(s || '').toLowerCase()
      .replace(/[áàäâ]/g, 'a').replace(/[éèëê]/g, 'e')
      .replace(/[íìïî]/g, 'i').replace(/[óòöô]/g, 'o')
      .replace(/[úùüû]/g, 'u').replace(/ñ/g, 'n')
      .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function ircTokens(s) {
    return ircFold(s).split(' ').filter(function(t) { return t.length > 0; });
  }
  function ircLevenshtein(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    if (Math.abs(a.length - b.length) > 3) return 99;
    var i, j, prev, cur, tmp, aa, bb;
    prev = [];
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur = [i];
      aa = a.charAt(i - 1);
      for (j = 1; j <= b.length; j++) {
        bb = b.charAt(j - 1);
        tmp = prev[j - 1] + (aa === bb ? 0 : 1);
        if (prev[j] + 1 < tmp) tmp = prev[j] + 1;
        if (cur[j - 1] + 1 < tmp) tmp = cur[j - 1] + 1;
        cur[j] = tmp;
      }
      prev = cur;
    }
    return prev[b.length];
  }
  function ircTokenClose(q, cand) {
    if (!q || !cand) return false;
    if (q.length < 3 || cand.length < 3) return q === cand;
    if (cand.indexOf(q) >= 0) return true;
    if (cand.length >= 4 && q.indexOf(cand) >= 0) return true;
    var max = q.length >= 7 ? 2 : (q.length >= 4 ? 1 : 0);
    if (!max) return false;
    return ircLevenshtein(q, cand) <= max;
  }
  // Diccionario de sinónimos y regionalismos para la búsqueda (claves y valores
  // ya plegados: minúsculas, sin tildes — ver ircFold). El nombre oficial del
  // motivo NO cambia; el alias solo sirve para encontrarlo. Fuente y
  // mantenimiento: Manual de Nomenclaturas §8.4; cada equipo amplía su lista.
  var IRC_SYNONYMS = {
    plata: ['dinero'], dinero: ['plata'],
    reembolso: ['devolucion'], devolucion: ['reembolso'],
    trasteo: ['traslado'], traslado: ['trasteo'],
    caido: ['corte', 'caida'], caida: ['corte'],
    factura: ['facturacion'], facturacion: ['factura', 'cobro'], cobro: ['facturacion'],
    tv: ['television'], television: ['tv'],
    onu: ['ont'], ont: ['onu'],
    contrasena: ['clave'], clave: ['contrasena'], wifi: ['inalambrico']
  };
  function ircAlternatives(t) {
    var alts = [t];
    var extra = IRC_SYNONYMS[t];
    if (extra) {
      for (var i = 0; i < extra.length; i++) {
        if (alts.indexOf(extra[i]) < 0) alts.push(extra[i]);
      }
    }
    return alts;
  }
  function ircAltHitAny(qt, text, textTokens) {
    var alts = ircAlternatives(qt);
    for (var a = 0; a < alts.length; a++) {
      var alt = alts[a];
      if (text.indexOf(alt) >= 0) return true;
      for (var h = 0; h < textTokens.length; h++) {
        if (ircTokenClose(alt, textTokens[h])) return true;
      }
    }
    return false;
  }
  // Mejor nivel de coincidencia de un token del query (con sinónimos) contra
  // una fila: 3 motivo, 2 subcategoría, 1 resto, 0 sin coincidencia.
  function ircBestHit(qt, reason, sub, hTokens) {
    var alts = ircAlternatives(qt);
    var best = 0;
    for (var a = 0; a < alts.length; a++) {
      var alt = alts[a];
      var rToks = ircTokens(reason);
      var sToks = ircTokens(sub);
      if (reason.indexOf(alt) >= 0 || rToks.some(function(ht){ return ircTokenClose(alt, ht); })) {
        if (best < 3) best = 3;
      } else if (sub.indexOf(alt) >= 0 || sToks.some(function(ht){ return ircTokenClose(alt, ht); })) {
        if (best < 2) best = 2;
      } else {
        for (var j = 0; j < hTokens.length; j++) {
          if (ircTokenClose(alt, hTokens[j])) { if (best < 1) best = 1; break; }
        }
      }
      if (best === 3) break;
    }
    return best;
  }
  // Búsqueda abierta: no exige frase exacta ni orden ni tildes. Cada palabra
  // del query debe parecerse a alguna del motivo/categoría/equipo/observaciones.
  function ircFuzzyScore(query, row) {
    var qTokens = ircTokens(query).filter(function(t) { return t.length >= 3; });
    if (!qTokens.length) return 1;
    var reason = ircFold(row.reason || '');
    var sub = ircFold(row.subcategory || '');
    var cat = ircFold(row.category || '');
    var team = ircFold(row.team || '');
    var obs = ircFold(row.observaciones || '');
    var hay = [reason, sub, cat, team, obs].filter(Boolean).join(' ');
    if (!hay) return 0;
    var hTokens = hay.split(' ').filter(function(t) { return t.length >= 3; });
    var score = 0;
    var reasonHits = 0;
    for (var i = 0; i < qTokens.length; i++) {
      var qt = qTokens[i];
      var hitWhere = ircBestHit(qt, reason, sub, hTokens); // 3 motivo, 2 sub, 1 resto (incl. observaciones)
      if (!hitWhere) return 0;
      if (hitWhere === 3) reasonHits++;
      score += hitWhere;
    }
    // Evitar ruido: si ninguna palabra pegó en motivo/subcategoría/observaciones, descartar.
    if (reasonHits === 0 && score < qTokens.length * 2) {
      var softOk = qTokens.some(function(qt) {
        return ircAltHitAny(qt, sub, ircTokens(sub)) || ircAltHitAny(qt, obs, ircTokens(obs));
      });
      if (!softOk) return 0;
    }
    if (qTokens[0] && reason.indexOf(qTokens[0]) === 0) score += 3;
    if (reasonHits === qTokens.length) score += 4;
    return score;
  }

  // Sugerencias ante cero resultados: motivos con mayor traslape de palabras
  // (con sinónimos). Al pulsar una sugerencia se busca su texto exacto.
  function ircSuggest(query, rows) {
    var qTokens = ircTokens(query).filter(function(t) { return t.length >= 3; });
    if (!qTokens.length) return [];
    var scored = [];
    rows.forEach(function(r) {
      var hay = ircTokens([r.reason, r.subcategory, r.category, r.team, r.observaciones].filter(Boolean).join(' '));
      if (!hay.length) return;
      var hayStr = hay.join(' ');
      var hits = 0;
      qTokens.forEach(function(qt) {
        if (ircAltHitAny(qt, hayStr, hay)) hits++;
      });
      if (hits > 0) scored.push({ row: r, hits: hits });
    });
    scored.sort(function(a, b) {
      if (b.hits !== a.hits) return b.hits - a.hits;
      return String(a.row.reason || '').localeCompare(String(b.row.reason || ''));
    });
    return scored.slice(0, 5).map(function(s) { return s.row; });
  }

  function renderOpeningSearchResults(query) {
    var box = document.getElementById('irc-opening-search-results');
    var empty = document.getElementById('irc-opening-search-empty');
    var detail = document.getElementById('irc-opening-search-detail');
    if (!box) return;
    var q = String(query || '').trim();
    var rows = openingCatalogLines();
    var teamFilter = openingSelectedTeam();
    if (teamFilter) {
      rows = rows.filter(function(r) { return String(r.team || '').trim() === teamFilter; });
    }
    var seen = {};
    var uniq = [];
    rows.forEach(function(r) {
      var key = [r.team, r.category, r.subcategory, r.reason].join('|');
      if (seen[key]) return;
      seen[key] = true;
      uniq.push(r);
    });
    var base = uniq.slice();
    if (q) {
      var scored = [];
      uniq.forEach(function(r) {
        var sc = ircFuzzyScore(q, r);
        if (sc > 0) scored.push({ row: r, score: sc });
      });
      scored.sort(function(a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.row.reason || '').localeCompare(String(b.row.reason || ''));
      });
      uniq = scored.map(function(s) { return s.row; });
    }
    uniq = uniq.slice(0, 80);
    if (!uniq.length) {
      var sug = q ? ircSuggest(q, base) : [];
      box.innerHTML = sug.map(function(r, idx) {
        return '<button type="button" class="irc-opening-suggest-item" data-idx="' + idx + '" style="display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #e2e8f0;background:#fffbeb;padding:10px 12px;cursor:pointer">' +
          '<div style="font-size:13px;font-weight:600;color:#0f172a">¿Quiso decir: ' + String(r.reason).replace(/</g, '&lt;') + '?</div>' +
          '<div style="font-size:11px;color:#64748b;margin-top:2px">' + [r.team, r.category, r.subcategory].filter(Boolean).join(' · ').replace(/</g, '&lt;') + '</div>' +
          '</button>';
      }).join('');
      box._suggest = sug;
      Array.prototype.forEach.call(box.querySelectorAll('.irc-opening-suggest-item'), function(btn) {
        btn.addEventListener('click', function() {
          var picked = (box._suggest || [])[parseInt(btn.getAttribute('data-idx'), 10)];
          if (!picked) return;
          var input = document.getElementById('irc-opening-search-q');
          if (input) { input.value = picked.reason || ''; }
          renderOpeningSearchResults(picked.reason || '');
        });
      });
      if (empty) {
        empty.textContent = q ? 'Sin coincidencias para "' + q + '". Pruebe con menos palabras o elija una sugerencia.' : 'Sin coincidencias.';
        empty.style.display = 'block';
      }
      if (detail) detail.style.display = 'none';
      _openingSearchSelected = null;
      return;
    }
    if (empty) empty.style.display = 'none';
    var countLabel = String(uniq.length) + (uniq.length >= 80 ? '+' : '') +
      (uniq.length === 1 ? ' coincidencia' : ' coincidencias') +
      (q ? ' para "' + q + '"' : '');
    box.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:#64748b;border-bottom:1px solid #e2e8f0;background:#f1f5f9">' + countLabel.replace(/</g, '&lt;') + '</div>' +
      uniq.map(function(r, idx) {
      var obs = String(r.observaciones || '').replace(/</g, '&lt;');
      return '<button type="button" class="irc-opening-search-item" data-idx="' + idx + '" style="display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #e2e8f0;background:#fff;padding:10px 12px;cursor:pointer">' +
        '<div style="font-size:13px;font-weight:600;color:#0f172a">' + String(r.reason).replace(/</g, '&lt;') + '</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:2px">' + [r.team, r.category, r.subcategory].filter(Boolean).join(' · ').replace(/</g, '&lt;') + '</div>' +
        (obs ? '<div style="font-size:11px;color:#0369a1;margin-top:2px">' + obs.slice(0, 140) + '</div>' : '') + '</button>';
    }).join('');
    box._rows = uniq;
    box.querySelectorAll('.irc-opening-search-item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var hideHint = document.getElementById('irc-opening-search-hint');
        if (hideHint) hideHint.style.display = 'none';
        var line = uniq[parseInt(btn.getAttribute('data-idx'), 10)];
        _openingSearchSelected = line || null;
        var detailEl = document.getElementById('irc-opening-search-detail');
        if (!detailEl || !line) return;
        detailEl.style.display = 'block';
        document.getElementById('irc-opening-search-team').textContent = line.team || '—';
        document.getElementById('irc-opening-search-cat').textContent = line.category || '—';
        document.getElementById('irc-opening-search-sub').textContent = line.subcategory || '—';
        document.getElementById('irc-opening-search-reason').textContent = line.reason || '—';
        var obsEl = document.getElementById('irc-opening-search-obs');
        if (obsEl) {
          var obsTxt = String(line.observaciones || '').trim();
          if (obsTxt) { obsEl.textContent = obsTxt; obsEl.style.display = 'block'; }
          else { obsEl.textContent = ''; obsEl.style.display = 'none'; }
        }
      });
    });
  }

  function teamToAssigneeGroupId(teamName) {
    var t = normalizeTeamLabel(teamName);
    var map = {
      'NOC': '5',
      'Customer Experience (CX)': '27',
      'Instalaciones y Mantenimiento': '36',
      'Planta externa': '29',
      'Planta Interna': '30',
      'NET Operations': '67',
      'Marketing': '22'
    };
    return map[t] || null;
  }

  function applyOpeningCatalogLine() {
    var line = _openingSearchSelected;
    if (!line) {
      var needHint = document.getElementById('irc-opening-search-hint');
      if (needHint) needHint.style.display = 'block';
      return;
    }
    var f = fields();
    if (!f || !f.openingTeam) return;
    var team = normalizeTeamLabel(line.team);
    setSelectValueSafe(f.openingTeam, team);
    try { f.openingTeam.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    // Cascade fill after options refresh
    refreshKind('opening', true).then(function() {
      if (f.openingCategory) {
        setSelectValueSafe(f.openingCategory, line.category);
        try { f.openingCategory.dispatchEvent(new Event('change', { bubbles: true })); } catch (e2) {}
      }
      return refreshKind('opening', true);
    }).then(function() {
      if (f.openingSubcategory) {
        setSelectValueSafe(f.openingSubcategory, line.subcategory);
        try { f.openingSubcategory.dispatchEvent(new Event('change', { bubbles: true })); } catch (e3) {}
      }
      return refreshKind('opening', true);
    }).then(function() {
      if (f.openingReason) {
        setSelectValueSafe(f.openingReason, line.reason);
        try { f.openingReason.dispatchEvent(new Event('change', { bubbles: true })); } catch (e4) {}
      }
      // Suggest assignee matching team
      var assigned = document.getElementById('issue_assigned_to_id');
      var gid = teamToAssigneeGroupId(team);
      if (assigned && gid) {
        var has = Array.prototype.some.call(assigned.options || [], function(o) { return String(o.value) === String(gid); });
        if (has && String(assigned.value) !== String(gid)) {
          assigned.dataset.ircApplyingCatalog = '1';
          try {
            assigned.value = String(gid);
            try { assigned.dispatchEvent(new Event('change', { bubbles: true })); } catch (e5) {}
            if (window.jql) {
              try { window.jql(assigned).val(String(gid)).trigger('change'); } catch (e6) {}
            }
          } finally {
            window.setTimeout(function() { try { delete assigned.dataset.ircApplyingCatalog; } catch (e7) {} }, 0);
          }
        }
      }
      maybeOpenTrasladoHogar(line);
    });
    var modal = document.getElementById('irc-opening-search-modal');
    if (modal) modal.style.display = 'none';
    try {
      document.dispatchEvent(new CustomEvent('issue-reason-catalog-applied', {
        detail: { source: 'opening-search', reason: line.reason, team: line.team }
      }));
    } catch (eApply) {}
  }


  // Cambio automático de tracker al tipificar motivo con dueño (solo CREAR).
  // Lee owner_tracker del endpoint options; si difiere del tracker actual,
  // lo cambia y dispara el refresh nativo (updateIssueFrom) para mostrar
  // los campos del tracker destino ANTES de enviar. Sin ruido si ya coincide.
  // Blindaje anti-pérdida: el refresh reemplaza el formulario y borraría lo
  // diligenciado. Se captura el estado antes de cambiar y se restaura cuando
  // termina el refresh. Los adjuntos no se pueden restaurar (el navegador lo
  // impide): con archivos anexados no se cambia solo y se avisa en el form.
  var _ircSwitching = false;
  function ircSnapshotForm() {
    var root = document.getElementById('issue-form') || document;
    var els = root.querySelectorAll('input, select, textarea');
    var snap = [];
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      if (!el.name || el.disabled) continue;
      if (el.name === 'authenticity_token' || el.name === '_method') continue;
      if (el.type === 'file') continue;
      if (el.name === 'issue[tracker_id]') continue; // lo fija el switch
      var entry = { name: el.name, type: (el.type || el.tagName || '').toLowerCase() };
      if (el.tagName === 'SELECT') {
        if (el.multiple) {
          entry.values = [];
          for (var o = 0; o < el.options.length; o++) if (el.options[o].selected) entry.values.push(el.options[o].value);
        } else { entry.value = el.value; }
      } else if (entry.type === 'checkbox' || entry.type === 'radio') {
        entry.checked = !!el.checked; entry.value = el.value;
      } else { entry.value = el.value; }
      snap.push(entry);
    }
    return snap;
  }
  function ircHasAttachedFiles() {
    var root = document.getElementById('issue-form') || document;
    var files = root.querySelectorAll('input[type="file"]');
    for (var i = 0; i < files.length; i++) {
      try { if (files[i].files && files[i].files.length) return true; } catch (e) {}
    }
    return false;
  }
  function ircWarnAttachedFiles() {
    try {
      var t = document.getElementById('issue_tracker_id');
      if (!t || document.getElementById('irc-files-warn')) return;
      var w = document.createElement('p');
      w.id = 'irc-files-warn';
      w.className = 'warning';
      w.textContent = 'No se cambió el tracker automáticamente: hay archivos anexados que se perderían. Cambie el tracker manualmente cuando lo requiera.';
      t.parentNode.insertBefore(w, t.nextSibling);
      window.setTimeout(function() { var x = document.getElementById('irc-files-warn'); if (x && x.parentNode) x.parentNode.removeChild(x); }, 9000);
    } catch (e) {}
  }
  function ircRestoreForm(snap) {
    if (!snap || !snap.length) return 0;
    var root = document.getElementById('issue-form') || document;
    var restored = 0;
    for (var i = 0; i < snap.length; i++) {
      var s = snap[i];
      var nodes = root.querySelectorAll('[name="' + String(s.name).replace(/"/g, '\\"') + '"]');
      if (!nodes || !nodes.length) continue;
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        if (el.disabled) continue;
        try {
          if (el.tagName === 'SELECT') {
            if (el.multiple && s.values) {
              var map = {};
              for (var k = 0; k < s.values.length; k++) map[s.values[k]] = 1;
              for (var o = 0; o < el.options.length; o++) el.options[o].selected = !!map[el.options[o].value];
              restored++;
            } else if (s.value !== undefined) {
              var ok = false;
              for (var p = 0; p < el.options.length; p++) if (el.options[p].value === s.value) { ok = true; break; }
              if (ok || s.value === '') { el.value = s.value; restored++; }
            }
          } else if ((s.type === 'checkbox' || s.type === 'radio') && el.value === s.value) {
            el.checked = !!s.checked; restored++;
          } else if (s.type !== 'checkbox' && s.type !== 'radio' && s.type !== 'file' && el.type !== 'file' && s.value !== undefined) {
            if ('value' in el) { el.value = s.value; restored++; }
          }
        } catch (e) {}
      }
    }
    return restored;
  }
  function ircRestoreAfterRefresh(snap, destId) {
    var done = false;
    var obs = null;
    function finish() {
      if (done) return; done = true;
      try { if (obs) obs.disconnect(); } catch (e) {}
      ircRestoreForm(snap);
    }
    try {
      var form = document.getElementById('issue-form');
      if (window.MutationObserver && form) {
        var timer = null, elapsed = 0;
        obs = new MutationObserver(function() {
          if (timer) window.clearTimeout(timer);
          timer = window.setTimeout(function() {
            var t = document.getElementById('issue_tracker_id');
            if (t && String(t.value) === String(destId)) finish();
          }, 450);
        });
        obs.observe(form, { childList: true, subtree: true });
        var tick = window.setInterval(function() {
          elapsed += 500;
          var t2 = document.getElementById('issue_tracker_id');
          if ((t2 && String(t2.value) === String(destId)) || elapsed > 9000) { window.clearInterval(tick); finish(); }
        }, 500);
      } else {
        window.setTimeout(finish, 1200);
      }
    } catch (e) { window.setTimeout(finish, 1200); }
  }
  function maybeAutoSwitchTracker() {
    if (_ircSwitching) return;
    if (issueIdFromForm()) return; // solo Nuevo caso
    var f = fields();
    if (!f || !f.openingReason || !f.openingSubcategory) return;
    var motivoVal = String(f.openingReason.value || '').trim();
    var subVal = String(f.openingSubcategory.value || '').trim();
    if (!motivoVal || !subVal) return;
    var teamVal = f.openingTeam ? String(f.openingTeam.value || '') : '';
    var catVal = f.openingCategory ? String(f.openingCategory.value || '') : '';
    _ircSwitching = true;
    fetchOptions({ team: teamVal, kind: 'opening', category: catVal, subcategory: subVal, motivo: motivoVal }).then(function(data) {
      _ircSwitching = false;
      var owner = data && data.owner_tracker;
      if (!owner || !owner.id) return;
      var cur = currentTrackerId();
      if (parseInt(owner.id, 10) === cur) return;
      var t = document.getElementById('issue_tracker_id');
      if (!t) return;
      var has = Array.prototype.some.call(t.options || [], function(o) { return String(o.value) === String(owner.id); });
      if (!has) return;
      if (ircHasAttachedFiles()) { ircWarnAttachedFiles(); return; }
      var snap = ircSnapshotForm();
      t.value = String(owner.id);
      ircRestoreAfterRefresh(snap, owner.id);
      try { t.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    }).catch(function() { _ircSwitching = false; });
  }

  function maybeOpenTrasladoHogar(line) {
    if (!line) return;
    var sub = String(line.subcategory || '').trim().toLowerCase();
    var reason = String(line.reason || '').trim().toLowerCase();
    var hit = sub === 'traslado' || /traslado (con|sin) cobertura/.test(reason) || reason.indexOf('traslado') === 0;
    if (!hit) return;
    function open() {
      try {
        var api = window.FibrazoTrasladoHogar;
        if (api && api.openModal) { api.openModal(); return; }
        if (api && api.openEditModal) { api.openEditModal(); return; }
      } catch (e1) {}
      var modal = document.getElementById('th-modal');
      if (modal) modal.style.display = 'block';
    }
    // Esperar a que terminen change/cascadas del formulario.
    window.setTimeout(open, 350);
    window.setTimeout(open, 900);
  }

  function openOpeningSearchModal() {
    // Cerrar TV y suprimir auto-open mientras se usa la ayuda (?).
    if (window.FibrazoTvFallas && window.FibrazoTvFallas.dismissCurrent) {
      try { window.FibrazoTvFallas.dismissCurrent(); } catch (errD) {}
    } else {
      var ftv = document.getElementById('ftv-modal');
      if (ftv) ftv.style.display = 'none';
    }
    if (window.FibrazoTvFallas && window.FibrazoTvFallas.suppressAutoOpen) {
      try { window.FibrazoTvFallas.suppressAutoOpen(4000); } catch (errS) {}
    }
    var modal = buildOpeningSearchModal();
    _openingSearchSelected = null;
    var detail = document.getElementById('irc-opening-search-detail');
    if (detail) detail.style.display = 'none';
    var openHint = document.getElementById('irc-opening-search-hint');
    if (openHint) openHint.style.display = 'none';
    var q = document.getElementById('irc-opening-search-q');
    if (q) q.value = '';
    refreshOpeningTeamFilter();
    renderOpeningSearchResults('');
    modal.style.display = 'block';
    if (q) setTimeout(function() { q.focus(); }, 50);
  }

  // Ayuda (?) de CIERRE: mismo buscador que apertura pero solo motivos de
  // cierre. Visible también en edición (el cierre se tipifica al resolver).
  function ensureClosingTeamHelpButton() {
    var existing = document.getElementById('irc-closing-reason-help');
    if (!isFormWorkflowContext()) {
      if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }
    var f = fields();
    if (!f || !f.closingTeam) return;
    var sel = f.closingTeam;
    if (sel.parentNode && sel.parentNode.querySelector('#irc-closing-reason-help')) return;
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'irc-closing-reason-help';
    btn.title = 'Buscar motivo de cierre en el catálogo';
    btn.setAttribute('aria-label', 'Buscar motivo de cierre');
    btn.textContent = '?';
    btn.style.cssText = 'display:inline-block;width:20px;height:20px;border-radius:999px;border:1px solid #93c5fd;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:800;cursor:pointer;line-height:1;padding:0;margin-left:6px;vertical-align:middle';
    try {
      if (sel && getComputedStyle(sel).display === 'block') { sel.style.display = 'inline-block'; sel.style.verticalAlign = 'middle'; }
    } catch (e) {}
    sel.parentNode.insertBefore(btn, sel.nextSibling);
    btn.addEventListener('mousedown', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (window.FibrazoTvFallas && window.FibrazoTvFallas.dismissCurrent) {
        try { window.FibrazoTvFallas.dismissCurrent(); } catch (err1) {}
      }
      if (window.FibrazoTvFallas && window.FibrazoTvFallas.suppressAutoOpen) {
        try { window.FibrazoTvFallas.suppressAutoOpen(4000); } catch (err2) {}
      }
      var ftvEarly = document.getElementById('ftv-modal');
      if (ftvEarly) ftvEarly.style.display = 'none';
    });
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      openClosingSearchModal();
    });
  }

  var _closingSearchSelected = null;

  function closingSelectedTeam() {
    var sel = document.getElementById('irc-closing-search-teamfilter');
    return sel ? String(sel.value || '').trim() : '';
  }

  // Equipos presentes en motivos de cierre; default = equipo del perfil.
  function refreshClosingTeamFilter() {
    var sel = document.getElementById('irc-closing-search-teamfilter');
    if (!sel) return;
    var prev = String(sel.value || '');
    var teams = [];
    closingCatalogLines().forEach(function(r) {
      var t = String(r.team || '').trim();
      if (t && teams.indexOf(t) < 0) teams.push(t);
    });
    teams.sort(function(a, b) { return a.localeCompare(b); });
    sel.innerHTML = '';
    var all = document.createElement('option');
    all.value = '';
    all.textContent = 'Todos los equipos (' + teams.length + ')';
    sel.appendChild(all);
    teams.forEach(function(t) {
      var o = document.createElement('option');
      o.value = t;
      o.textContent = t;
      sel.appendChild(o);
    });
    if (teams.indexOf(prev) >= 0) { sel.value = prev; return; }
    try {
      var ff = (typeof fields === 'function') ? fields() : null;
      var formTeam = ff && ff.closingTeam ? String(ff.closingTeam.value || '').trim() : '';
      if (formTeam && teams.indexOf(formTeam) >= 0) { sel.value = formTeam; return; }
    } catch (e1) {}
    var ut = String(state.userTeam || '').trim();
    if (!ut || ut === 'Todos') {
      try {
        var m = document.querySelector('meta[name="fibrazo-user-team"]');
        if (m && m.content) ut = String(m.content).trim();
      } catch (e2) {}
    }
    sel.value = (ut && ut !== 'Todos' && teams.indexOf(ut) >= 0) ? ut : '';
  }

  function closingCatalogLines() {
    return (state.entries || []).filter(function(e) {
      return String(e.kind || '') === 'closing' && e.reason;
    });
  }

  function buildClosingSearchModal() {
    var old = document.getElementById('irc-closing-search-modal');
    if (old) return old;
    var modal = document.createElement('div');
    modal.id = 'irc-closing-search-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.cssText = 'display:none;position:fixed;z-index:100000;inset:0;background:rgba(15,23,42,.55);overflow:auto;padding:24px';
    modal.innerHTML =
      '<div style="background:#fff;border-radius:16px;max-width:720px;margin:6vh auto;padding:20px;box-shadow:0 24px 80px rgba(15,23,42,.35);font-family:inherit">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px">' +
      '<div><h3 style="margin:0 0 4px;font-size:17px;color:#0f172a">Buscar motivo de cierre</h3>' +
      '<p style="margin:0;font-size:12px;color:#64748b">Solo motivos de cierre. Al usarlo se diligencian el equipo, la categoría, la subcategoría y el motivo de cierre.</p></div>' +
      '<button type="button" id="irc-closing-search-close" style="border:0;background:#f1f5f9;color:#475569;border-radius:999px;width:30px;height:30px;cursor:pointer;font-weight:700">&times;</button></div>' +
      '<div style="display:flex;gap:8px;margin-bottom:10px">' +
      '<select id="irc-closing-search-teamfilter" aria-label="Filtrar por equipo" style="flex:0 0 240px;max-width:45%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px;background:#fff"></select>' +
      '<input type="search" id="irc-closing-search-q" placeholder="Buscar motivos de cierre" autocomplete="off" style="flex:1;box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font-size:14px">' +
      '</div>' +
      '<div id="irc-closing-search-results" style="max-height:280px;overflow:auto;border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc"></div>' +
      '<div id="irc-closing-search-detail" style="display:none;margin-top:12px;padding:12px;border-radius:10px;border:1px solid #bfdbfe;background:#eff6ff">' +
      '<div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#1d4ed8;margin-bottom:8px">Pertenece a</div>' +
      '<div style="display:grid;grid-template-columns:120px 1fr;gap:6px 10px;font-size:13px;color:#0f172a">' +
      '<div style="color:#64748b">Equipo</div><div id="irc-closing-search-team" style="font-weight:700"></div>' +
      '<div style="color:#64748b">Categoría</div><div id="irc-closing-search-cat"></div>' +
      '<div style="color:#64748b">Subcategoría</div><div id="irc-closing-search-sub"></div>' +
      '<div style="color:#64748b">Motivo</div><div id="irc-closing-search-reason" style="font-weight:600"></div>' +
      '</div>' +
      '<div id="irc-closing-search-obs" style="display:none;margin-top:10px;padding:8px 10px;border-radius:8px;background:#f0f9ff;font-size:11px;color:#0c4a6e"></div>' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px">' +
      '<button type="button" id="irc-closing-search-cancel" style="padding:8px 14px;border:1px solid #cbd5e1;border-radius:10px;background:#fff;color:#475569;cursor:pointer;font-size:13px">Cerrar</button>' +
      '<button type="button" id="irc-closing-search-use" style="padding:8px 16px;border:0;border-radius:10px;background:#2563eb;color:#fff;cursor:pointer;font-size:13px;font-weight:700">Usar</button>' +
      '</div></div>' +
      '<p id="irc-closing-search-empty" style="display:none;margin:10px 0 0;font-size:12px;color:#94a3b8">Sin coincidencias.</p>' +
      '<p id="irc-closing-search-hint" style="display:none;margin:10px 0 0;font-size:12px;color:#b45309">Seleccione un motivo de la lista y pulse Usar.</p></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function(e) {
      if (e.target === modal || e.target.id === 'irc-closing-search-close' || e.target.id === 'irc-closing-search-cancel') {
        modal.style.display = 'none';
      }
    });
    var q = modal.querySelector('#irc-closing-search-q');
    if (q) q.addEventListener('input', function() {
      var h = document.getElementById('irc-closing-search-hint');
      if (h) h.style.display = 'none';
      renderClosingSearchResults(q.value);
    });
    var useBtn = modal.querySelector('#irc-closing-search-use');
    if (useBtn) useBtn.addEventListener('click', applyClosingCatalogLine);
    var teamSel = modal.querySelector('#irc-closing-search-teamfilter');
    if (teamSel) teamSel.addEventListener('change', function() {
      var h = document.getElementById('irc-closing-search-hint');
      if (h) h.style.display = 'none';
      var input = document.getElementById('irc-closing-search-q');
      renderClosingSearchResults(input ? input.value : '');
    });
    return modal;
  }

  function renderClosingSearchResults(query) {
    var box = document.getElementById('irc-closing-search-results');
    var empty = document.getElementById('irc-closing-search-empty');
    var detail = document.getElementById('irc-closing-search-detail');
    if (!box) return;
    var q = String(query || '').trim();
    var rows = closingCatalogLines();
    var teamFilter = closingSelectedTeam();
    if (teamFilter) {
      rows = rows.filter(function(r) { return String(r.team || '').trim() === teamFilter; });
    }
    var seen = {};
    var uniq = [];
    rows.forEach(function(r) {
      var key = [r.team, r.category, r.subcategory, r.reason].join('|');
      if (seen[key]) return;
      seen[key] = true;
      uniq.push(r);
    });
    var base = uniq.slice();
    if (q) {
      var scored = [];
      uniq.forEach(function(r) {
        var sc = ircFuzzyScore(q, r);
        if (sc > 0) scored.push({ row: r, score: sc });
      });
      scored.sort(function(a, b) {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.row.reason || '').localeCompare(String(b.row.reason || ''));
      });
      uniq = scored.map(function(s) { return s.row; });
    }
    uniq = uniq.slice(0, 80);
    if (!uniq.length) {
      var sug = q ? ircSuggest(q, base) : [];
      box.innerHTML = sug.map(function(r, idx) {
        return '<button type="button" class="irc-closing-suggest-item" data-idx="' + idx + '" style="display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #e2e8f0;background:#fffbeb;padding:10px 12px;cursor:pointer">' +
          '<div style="font-size:13px;font-weight:600;color:#0f172a">¿Quiso decir: ' + String(r.reason).replace(/</g, '&lt;') + '?</div>' +
          '<div style="font-size:11px;color:#64748b;margin-top:2px">' + [r.team, r.category, r.subcategory].filter(Boolean).join(' · ').replace(/</g, '&lt;') + '</div>' +
          '</button>';
      }).join('');
      box._suggest = sug;
      Array.prototype.forEach.call(box.querySelectorAll('.irc-closing-suggest-item'), function(btn) {
        btn.addEventListener('click', function() {
          var picked = (box._suggest || [])[parseInt(btn.getAttribute('data-idx'), 10)];
          if (!picked) return;
          var input = document.getElementById('irc-closing-search-q');
          if (input) { input.value = picked.reason || ''; }
          renderClosingSearchResults(picked.reason || '');
        });
      });
      if (empty) {
        empty.textContent = q ? 'Sin coincidencias para "' + q + '". Pruebe con menos palabras o elija una sugerencia.' : 'Sin coincidencias.';
        empty.style.display = 'block';
      }
      if (detail) detail.style.display = 'none';
      _closingSearchSelected = null;
      return;
    }
    if (empty) empty.style.display = 'none';
    var countLabel = String(uniq.length) + (uniq.length >= 80 ? '+' : '') +
      (uniq.length === 1 ? ' coincidencia' : 'coincidencias') +
      (q ? ' para "' + q + '"' : '');
    box.innerHTML = '<div style="padding:8px 12px;font-size:11px;color:#64748b;border-bottom:1px solid #e2e8f0;background:#f1f5f9">' + countLabel.replace(/</g, '&lt;') + '</div>' +
      uniq.map(function(r, idx) {
      var obs = String(r.observaciones || '').replace(/</g, '&lt;');
      return '<button type="button" class="irc-closing-search-item" data-idx="' + idx + '" style="display:block;width:100%;text-align:left;border:0;border-bottom:1px solid #e2e8f0;background:#fff;padding:10px 12px;cursor:pointer">' +
        '<div style="font-size:13px;font-weight:600;color:#0f172a">' + String(r.reason).replace(/</g, '&lt;') + '</div>' +
        '<div style="font-size:11px;color:#64748b;margin-top:2px">' + [r.team, r.category, r.subcategory].filter(Boolean).join(' · ').replace(/</g, '&lt;') + '</div>' +
        (obs ? '<div style="font-size:11px;color:#0369a1;margin-top:2px">' + obs.slice(0, 140) + '</div>' : '') + '</button>';
    }).join('');
    box._rows = uniq;
    box.querySelectorAll('.irc-closing-search-item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var hideHint = document.getElementById('irc-closing-search-hint');
        if (hideHint) hideHint.style.display = 'none';
        var line = uniq[parseInt(btn.getAttribute('data-idx'), 10)];
        _closingSearchSelected = line || null;
        var detailEl = document.getElementById('irc-closing-search-detail');
        if (!detailEl || !line) return;
        detailEl.style.display = 'block';
        document.getElementById('irc-closing-search-team').textContent = line.team || '—';
        document.getElementById('irc-closing-search-cat').textContent = line.category || '—';
        document.getElementById('irc-closing-search-sub').textContent = line.subcategory || '—';
        document.getElementById('irc-closing-search-reason').textContent = line.reason || '—';
        var obsEl = document.getElementById('irc-closing-search-obs');
        if (obsEl) {
          var obsTxt = String(line.observaciones || '').trim();
          if (obsTxt) { obsEl.textContent = obsTxt; obsEl.style.display = 'block'; }
          else { obsEl.textContent = ''; obsEl.style.display = 'none'; }
        }
      });
    });
  }

  function applyClosingCatalogLine() {
    var line = _closingSearchSelected;
    if (!line) {
      var needHint = document.getElementById('irc-closing-search-hint');
      if (needHint) needHint.style.display = 'block';
      return;
    }
    var f = fields();
    if (!f || !f.closingTeam) return;
    var team = normalizeTeamLabel(line.team);
    setSelectValueSafe(f.closingTeam, team);
    try { f.closingTeam.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
    refreshKind('closing', true).then(function() {
      if (f.closingCategory) {
        setSelectValueSafe(f.closingCategory, line.category);
        try { f.closingCategory.dispatchEvent(new Event('change', { bubbles: true })); } catch (e2) {}
      }
      return refreshKind('closing', true);
    }).then(function() {
      if (f.closingSubcategory) {
        setSelectValueSafe(f.closingSubcategory, line.subcategory);
        try { f.closingSubcategory.dispatchEvent(new Event('change', { bubbles: true })); } catch (e3) {}
      }
      return refreshKind('closing', true);
    }).then(function() {
      if (f.closingReason) {
        setSelectValueSafe(f.closingReason, line.reason);
        try { f.closingReason.dispatchEvent(new Event('change', { bubbles: true })); } catch (e4) {}
      }
    });
    var modal = document.getElementById('irc-closing-search-modal');
    if (modal) modal.style.display = 'none';
    try {
      document.dispatchEvent(new CustomEvent('issue-reason-catalog-applied', {
        detail: { source: 'closing-search', reason: line.reason, team: line.team }
      }));
    } catch (eApply) {}
  }

  function openClosingSearchModal() {
    if (window.FibrazoTvFallas && window.FibrazoTvFallas.dismissCurrent) {
      try { window.FibrazoTvFallas.dismissCurrent(); } catch (errD) {}
    } else {
      var ftv = document.getElementById('ftv-modal');
      if (ftv) ftv.style.display = 'none';
    }
    if (window.FibrazoTvFallas && window.FibrazoTvFallas.suppressAutoOpen) {
      try { window.FibrazoTvFallas.suppressAutoOpen(4000); } catch (errS) {}
    }
    var modal = buildClosingSearchModal();
    _closingSearchSelected = null;
    var detail = document.getElementById('irc-closing-search-detail');
    if (detail) detail.style.display = 'none';
    var closeHint = document.getElementById('irc-closing-search-hint');
    if (closeHint) closeHint.style.display = 'none';
    var q = document.getElementById('irc-closing-search-q');
    if (q) q.value = '';
    refreshClosingTeamFilter();
    renderClosingSearchResults('');
    modal.style.display = 'block';
    if (q) setTimeout(function() { q.focus(); }, 50);
  }

  function bind() {
    var f = fields();
    applyRule();
    if (!isFormWorkflowContext() || !f || (!f.openingTeam && !f.closingTeam)) {
      notifyUpdated();
      return;
    }
    ensureOpeningTeamHelpButton();
    ensureClosingTeamHelpButton();
    var assignedTo = document.getElementById('issue_assigned_to_id');
    if (assignedTo && assignedTo.dataset.reasonCatalogAssignedBound !== '1') {
      assignedTo.addEventListener('change', function() { syncEquipoFromAssignedTo(true); });
      assignedTo.dataset.reasonCatalogAssignedBound = '1';
    }
    [
      f.openingTeam, f.closingTeam,
      f.openingCategory, f.closingCategory,
      f.openingSubcategory, f.closingSubcategory,
      f.openingReason, f.closingReason,
      document.getElementById('issue_status_id'),
      document.getElementById('issue_tracker_id')
    ].forEach(function(el) {
      if (el && el.dataset.reasonCatalogBound !== '1') {
        el.addEventListener('change', function(e) {
          if (state.clearingDependents) return;
          var f = fields();
          if (!f) return;
          var t = e.target;
          if (t && t.id === 'issue_tracker_id') {
            cache.config = null;
            cache.configAt = 0;
            cache.configKey = '';
            cache.configPromise = null;
            cache.options = {};
            cache.optionPromises = {};
            init();
            return;
          }
          var isTeam = t === f.openingTeam || t === f.closingTeam;
          var isCategory = t === f.openingCategory || t === f.closingCategory;
          var isSubcategory = t === f.openingSubcategory || t === f.closingSubcategory;
          state.clearingDependents = true;
          try {
          if (isTeam) {
            if (t === f.openingTeam) {
              [f.openingCategory, f.openingSubcategory, f.openingReason].forEach(function(dep) {
                if (dep) { dep.value = ''; try { dep.dispatchEvent(new Event('change', { bubbles: true })); } catch (e2) {} }
              });
            } else if (t === f.closingTeam) {
              [f.closingCategory, f.closingSubcategory, f.closingReason].forEach(function(dep) {
                if (dep) { dep.value = ''; try { dep.dispatchEvent(new Event('change', { bubbles: true })); } catch (e2) {} }
              });
            }
          } else if (isCategory) {
            var sub = t === f.openingCategory ? f.openingSubcategory : t === f.closingCategory ? f.closingSubcategory : null;
            var motivo = t === f.openingCategory ? f.openingReason : t === f.closingCategory ? f.closingReason : null;
            if (sub) { sub.value = ''; try { sub.dispatchEvent(new Event('change', {bubbles:true})); } catch(e2){} }
            if (motivo) { motivo.value = ''; try { motivo.dispatchEvent(new Event('change', {bubbles:true})); } catch(e2){} }
          } else if (isSubcategory) {
            var motivoSub = t === f.openingSubcategory ? f.openingReason : t === f.closingSubcategory ? f.closingReason : null;
            if (motivoSub) {
              motivoSub.value = '';
              try { motivoSub.dispatchEvent(new Event('change', { bubbles: true })); } catch (e2) {}
            }
          }
          } finally {
            state.clearingDependents = false;
          }
          if (isTeam || isCategory || isSubcategory) {
            var kind = (t === f.openingTeam || t === f.openingCategory || t === f.openingSubcategory) ? 'opening' : 'closing';
            applyRule();
            refreshKind(kind, true).then(notifyUpdated);
          } else {
            refreshAll(true);
          }
        });
        el.dataset.reasonCatalogBound = '1';
      }
    });
    refreshTeamOptions(true);
    reconcileClosingWithOpening().then(function() {
      refreshAll(true);
    });
    var form = document.getElementById('issue-form') || document.querySelector('form.edit_issue');
    if (form && form.dataset.reasonCatalogSubmitGuard !== '1') {
      form.addEventListener('submit', neutralizeHiddenRequiredFields, true);
      form.dataset.reasonCatalogSubmitGuard = '1';
    }
    syncWorkLevelFromTipificacion();
  }

  function syncWorkLevelFromTipificacion() {
    var meta = document.querySelector('meta[name="issue-work-level-cf-id"]');
    var mapMeta = document.querySelector('meta[name="issue-work-level-map"]');
    var ids = fieldIds();
    if (!meta || !ids || !(ids.opening_subcategory || ids.opening_reason || ids.opening_category)) return;
    var wlId = parseInt(meta.getAttribute('content') || '0', 10);
    if (!wlId) return;
    var wlEl = idFor(wlId);
    if (!wlEl) return;

    var wlWrap = wlEl.closest('p') || wlEl.parentElement;
    var wlLabel = wlWrap && wlWrap.querySelector('label');
    var wlLabelText = wlLabel ? String(wlLabel.textContent || '').toLowerCase() : '';
    if (wlLabelText.indexOf('nivel de trabajo') < 0) return;

    wlEl.removeAttribute('readonly');
    wlEl.removeAttribute('aria-readonly');
    wlEl.disabled = false;
    wlEl.classList.remove('issue-work-level-readonly');
    var wrap = wlEl.closest('p') || wlEl.parentElement;
    if (wrap) {
      var hint = wrap.querySelector('.issue-work-level-hint');
      if (hint) hint.remove();
    }

    var map = {};
    try { map = mapMeta ? JSON.parse(mapMeta.getAttribute('content') || '{}') : {}; } catch (e) { map = {}; }

    function heuristic(name) {
      var key = (name || '').toString().trim().toLowerCase();
      if (!key) return '';
      var rules = [
        ['corte de drop externo', 'Alturas'],
        ['fibra en riesgo', 'Alturas'],
        ['drop colgando', 'Alturas'],
        ['drop partido', 'Alturas'],
        ['drop estresado', 'Alturas'],
        ['mantenimiento alturas', 'Alturas'],
        ['traslado de servicio', 'Alturas'],
        ['nueva dirección', 'Alturas'],
        ['nueva direccion', 'Alturas'],
        ['robo de infraestructura', 'Alturas'],
        ['tendido', 'Alturas'],
        ['poste', 'Alturas'],
        ['aéreo', 'Alturas'],
        ['aereo', 'Alturas'],
        ['corte de drop interno', 'Piso'],
        ['sin potencia', 'Piso'],
        ['sin navegación', 'Piso'],
        ['sin navegacion', 'Piso'],
        ['cambio de onu', 'Piso'],
        ['retiro de onu', 'Piso'],
        ['reubicación de onu', 'Piso'],
        ['reubicacion de onu', 'Piso'],
        ['limpieza de conectores', 'Piso'],
        ['medición de potencia', 'Piso'],
        ['medicion de potencia', 'Piso'],
        ['fuente de poder', 'Piso'],
        ['equipo en daño', 'Piso'],
        ['equipo en dano', 'Piso'],
        ['reinstalación', 'Piso'],
        ['reinstalacion', 'Piso'],
        ['cambio de router', 'Piso'],
        ['servicio intermitente', 'Piso'],
        ['preventivo por potencia', 'Piso'],
        ['falla masiva', 'Piso'],
        ['autodiagnostico', 'Piso'],
        ['autodiagnóstico', 'Piso'],
        ['devolución', 'Piso'],
        ['devolucion', 'Piso'],
        ['mantenimiento correctivo', 'Piso'],
        ['mantenimiento preventivo', 'Piso'],
        ['planta interna', 'Piso']
      ];
      for (var i = 0; i < rules.length; i++) {
        if (key.indexOf(rules[i][0]) !== -1) return rules[i][1];
      }
      return '';
    }

    function lookup(name) {
      if (!name) return '';
      if (map[name]) return map[name];
      var lower = String(name).toLowerCase();
      for (var k in map) {
        if (Object.prototype.hasOwnProperty.call(map, k) && String(k).toLowerCase() === lower) return map[k];
      }
      return heuristic(name);
    }

    // Nivel editable: el catálogo sugiere, el usuario decide. Una vez que el
    // usuario toca el campo, sync() ya no lo sobrescribe en esta página.
    var wlManual = wlEl.dataset.workLevelManual === '1';
    function markWlManual() { wlManual = true; wlEl.dataset.workLevelManual = '1'; }

    function sync() {
      if (wlManual) return;
      var subEl = idFor(ids.opening_subcategory);
      var motEl = idFor(ids.opening_reason);
      var catEl = idFor(ids.opening_category);
      var label = lookup(subEl && subEl.value) || lookup(motEl && motEl.value) || lookup(catEl && catEl.value) || '';
      if (!label) return;
      if (wlEl.tagName === 'SELECT') {
        var found = false;
        for (var i = 0; i < wlEl.options.length; i++) {
          if (wlEl.options[i].value === label) { wlEl.selectedIndex = i; found = true; break; }
        }
        if (!found) {
          var opt = document.createElement('option');
          opt.value = label;
          opt.textContent = label;
          wlEl.appendChild(opt);
          wlEl.value = label;
        }
      } else {
        wlEl.value = label;
      }
    }

    if (wlEl.dataset.workLevelBound !== '1') {
      ['opening_subcategory', 'opening_reason', 'opening_category'].forEach(function(key) {
        var el = idFor(ids[key]);
        if (el) el.addEventListener('change', sync);
      });
      wlEl.addEventListener('change', markWlManual);
      wlEl.dataset.workLevelBound = '1';
    }
    if (!wlManual && !wlEl.value) sync();
  }

  function scheduleBind() {
    window.clearTimeout(state.bindTimer);
    state.bindTimer = window.setTimeout(function() {
      if (!state.fields || !Object.keys(state.fields).length) {
        init();
        return;
      }
      bind();
    }, 40);
  }

  function afterTabsBuilt() {
    window.setTimeout(function() {
      if (!document.body.classList.contains('controller-issues')) return;
      if (!state.fields || !Object.keys(state.fields).length) {
        init();
        return;
      }
      bind();
    }, 120);
  }

  function init() {
    if (!document.body.classList.contains('controller-issues')) return;
    var actionOk = ['action-edit', 'action-new', 'action-create', 'action-update']
      .some(function(cls) { return document.body.classList.contains(cls); });
    if (!actionOk && document.body.classList.contains('action-show')) {
      actionOk = showIssueFormActivated() && hasActiveIssueForm();
    }
    if (!actionOk) return;
    if (!hasActiveIssueForm() && !document.body.classList.contains('action-edit')) return;

    function loadConfig() {
      var configParams = [];
      var issueId = issueIdFromForm();
      var trackerId = currentTrackerId();
      if (issueId) configParams.push('issue_id=' + encodeURIComponent(issueId));
      if (trackerId) configParams.push('tracker_id=' + encodeURIComponent(trackerId));
      var configKey = configParams.join('&');
      if (cache.config && cache.configKey === configKey && (Date.now() - cache.configAt) < CONFIG_TTL_MS) {
        return Promise.resolve(cache.config);
      }
      if (!cache.configPromise || cache.configKey !== configKey) {
        cache.configKey = configKey;
        cache.configPromise = fetch('/issue_reason_catalog/config' + (configKey ? ('?' + configKey) : ''), {
          credentials: 'same-origin',
          headers: { Accept: 'application/json' }
        }).then(function(response) {
          if (!response.ok) throw new Error('reason catalog config failed');
          return response.json();
        }).then(function(data) {
          cache.config = data || {};
          cache.configAt = Date.now();
          cache.configKey = configKey;
          return cache.config;
        }).catch(function(error) {
          cache.configPromise = null;
          throw error;
        });
      }
      return cache.configPromise;
    }

    loadConfig().then(function(data) {
      state.fields = data.fields || {};
      state.rules = data.rules || [];
      state.teams = data.teams || [];
      state.entries = data.entries || [];
      state.userTeam = data.user_team || '';
      state.requireFrom = data.require_from || '2026-09-17';
      state.issueCreatedOn = data.issue_created_on || '';
      state.trackerOpeningScope = data.tracker_opening_scope === true;
      bind();
      document.addEventListener('issue-tabs-built', scheduleBind);
      document.addEventListener('issue-tabs-native-built', afterTabsBuilt);
      document.addEventListener('ajax:complete', scheduleBind);
    }).catch(function() {});
  }

  function lazyInitFromEvent(event) {
    var target = event && event.target;
    if (target && target.closest && target.closest('#update, form#issue-form, form.edit_issue, a.icon-edit, a[href$="/edit"], a[href*="/edit?"]')) {
      // No re-inicializar por focus en campos ya enlazados: reconstruir
      // opciones colapsa el dropdown nativo abierto.
      if (formAlreadyBound()) return;
      scheduleLazyInit(0);
    }
  }

  function scheduleLazyInit(tries) {
    try {
      var f = (typeof fields === 'function') ? fields() : null;
      var form = (f && f.form) || document.getElementById('issue-form');
      if (form && form._reasonCatalogLazyInitDone) return;
      var ae = document.activeElement;
      if (ae && ae.tagName === 'SELECT' && tries < 20) {
        window.setTimeout(function() { scheduleLazyInit(tries + 1); }, 300);
        return;
      }
      if (form) form._reasonCatalogLazyInitDone = true;
    } catch (e) {}
    activateIssueFormPlugins();
    window.setTimeout(init, 80);
  }

  function formAlreadyBound() {
    try {
      var f = fields();
      if (!f) return false;
      // Solo los que bind() marca (reason no se marca).
      var els = [f.openingTeam, f.closingTeam, f.openingCategory, f.closingCategory, f.openingSubcategory, f.closingSubcategory,
        document.getElementById('issue_status_id'), document.getElementById('issue_tracker_id')];
      var any = false;
      for (var i = 0; i < els.length; i++) {
        if (!els[i]) continue;
        any = true;
        if (els[i].dataset.reasonCatalogBound !== '1') return false;
      }
      return any;
    } catch (e) { return false; }
  }

  function bootFormPage() {
    if (!document.body.classList.contains('controller-issues')) return;
    var onForm = ['action-edit', 'action-new', 'action-create', 'action-update']
      .some(function(cls) { return document.body.classList.contains(cls); });
    if (!onForm) return;
    activateIssueFormPlugins();
    window.setTimeout(init, 80);
    window.setTimeout(init, 400);
    window.setTimeout(init, 1200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { init(); bootFormPage(); });
  } else {
    init();
    bootFormPage();
  }
  document.addEventListener('issue-tabs-built', scheduleBind);
  document.addEventListener('issue-tabs-native-built', afterTabsBuilt);
  document.addEventListener('ajax:complete', scheduleBind);
  document.addEventListener('click', lazyInitFromEvent, true);
  document.addEventListener('focusin', lazyInitFromEvent, true);
  document.addEventListener('ajax:complete', function() {
    if (showIssueFormActivated()) window.setTimeout(init, 80);
  });

  // Gancho de prueba E2E (Playwright): expone solo la lógica de búsqueda del
  // modal de apertura con datos de catálogo inyectados. Sin efecto en uso real.
  try {
    window.__ircSearchTest = {
      fold: ircFold,
      tokens: ircTokens,
      score: ircFuzzyScore,
      synonyms: IRC_SYNONYMS,
      alternatives: ircAlternatives,
      suggest: function(q) {
        var rows = openingCatalogLines();
        var seen = {};
        var uniqRows = [];
        rows.forEach(function(r) {
          var key = [r.team, r.category, r.subcategory, r.reason].join('|');
          if (seen[key]) return;
          seen[key] = true;
          uniqRows.push(r);
        });
        return ircSuggest(q, uniqRows);
      },
      setEntries: function(rows) { state.entries = rows || []; },
      open: function() {
        var m = buildOpeningSearchModal();
        _openingSearchSelected = null;
        var d0 = document.getElementById('irc-opening-search-detail');
        if (d0) d0.style.display = 'none';
        var h0 = document.getElementById('irc-opening-search-hint');
        if (h0) h0.style.display = 'none';
        m.style.display = 'block';
        renderOpeningSearchResults('');
        return true;
      },
      search: function(q) {
        var input = document.getElementById('irc-opening-search-q');
        if (input) input.value = q || '';
        renderOpeningSearchResults(q || '');
        var box = document.getElementById('irc-opening-search-results');
        return box ? box.querySelectorAll('.irc-opening-search-item').length : 0;
      },
      selected: function() { return _openingSearchSelected; }
    };
  } catch (eTestHook) {}
})();
