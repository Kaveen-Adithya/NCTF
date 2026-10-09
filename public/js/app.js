'use strict';

const app = document.getElementById('app');
const toastEl = document.getElementById('toast');
const state = { me: null };
let toastTimer = null;

// ---------- helpers ----------

async function api(path, { method = 'GET', body, form } = {}) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (form) {
    opts.body = form;
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`/api${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Builds DOM nodes via textContent, never innerHTML, so server data cannot inject markup
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'value') node.value = v;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// ---------- Tahoe-OS icon set (trusted, hardcoded SVG — never built from server data) ----------

const ICONS = {
  terminal: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1.2" y="2.2" width="13.6" height="11.6" rx="2"/><path d="M4 6.2 L6.6 8.2 L4 10.2"/><path d="M8.2 10.4 H11.4"/></svg>',
  shieldAlert: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 1.4 L14 3.6 V7.6 C14 11.2 11.4 13.6 8 14.6 C4.6 13.6 2 11.2 2 7.6 V3.6 Z"/><path d="M8 5.6 V8.8"/><circle cx="8" cy="11" r="0.6" fill="currentColor" stroke="none"/></svg>',
  cpu: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="8" height="8" rx="1.3"/><rect x="6.5" y="6.5" width="3" height="3" rx="0.6"/><path d="M8 1.4 V3.4 M8 12.6 V14.6 M1.4 8 H3.4 M12.6 8 H14.6"/></svg>',
  keyRound: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.2" cy="5.2" r="3"/><path d="M7.3 7.3 L13.6 13.6 M11.2 13.6 V11.8 M13 13.6 V12.4"/></svg>',
  checkCircle: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="6.6"/><path d="M5.2 8.2 L7.2 10.2 L11 6"/></svg>',
  activity: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="1.4,8.4 4.4,8.4 6,3.4 9.4,12.6 11,8.4 14.6,8.4"/></svg>',
  server: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1.6" y="2" width="12.8" height="4.6" rx="1"/><rect x="1.6" y="9.4" width="12.8" height="4.6" rx="1"/><path d="M4 4.3 H4.01 M4 11.7 H4.01"/></svg>',
  users: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.1" cy="5.4" r="2.2"/><path d="M1.6 13.6 C1.9 10.6 3.7 9.2 6.1 9.2 C8.5 9.2 10.3 10.6 10.6 13.6"/><circle cx="11.6" cy="6" r="1.7"/><path d="M11.3 9.4 C13 9.7 14.1 10.9 14.4 13.4"/></svg>',
  flag: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14.6 V1.8"/><path d="M3 2.4 C5 1 7.2 3 9.4 1.8 C10.6 1.2 12 1.6 13 2.4 V8 C12 7.2 10.6 6.8 9.4 7.4 C7.2 8.6 5 6.6 3 8 Z"/></svg>',
  layout: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="1.6" y="1.6" width="5.6" height="5.6" rx="1"/><rect x="8.8" y="1.6" width="5.6" height="5.6" rx="1"/><rect x="1.6" y="8.8" width="5.6" height="5.6" rx="1"/><rect x="8.8" y="8.8" width="5.6" height="5.6" rx="1"/></svg>',
  trophy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 2 H11 V5.4 C11 7.8 9.4 9.2 8 9.2 C6.6 9.2 5 7.8 5 5.4 Z"/><path d="M5 3 H2.6 C2.6 5 3.6 6.2 5 6.4 M11 3 H13.4 C13.4 5 12.4 6.2 11 6.4"/><path d="M8 9.2 V11.4 M6 14 H10 M6.4 11.4 H9.6 L10 14 H6 Z"/></svg>',
};

// SVG markup above is hardcoded and never includes user/server data, so innerHTML is safe here.
function icon(name, extraClass) {
  const span = document.createElement('span');
  span.className = `icon${extraClass ? ' ' + extraClass : ''}`;
  span.innerHTML = ICONS[name] || '';
  return span;
}

const CATEGORY_META = {
  web: { label: 'WEB EXPLOIT', color: 'var(--accent-web)', icon: 'terminal' },
  pwn: { label: 'BINARY PWN', color: 'var(--accent-pwn)', icon: 'shieldAlert' },
  reverse: { label: 'REVERSING', color: 'var(--accent-reverse)', icon: 'cpu' },
  crypto: { label: 'CRYPTO', color: 'var(--accent-crypto)', icon: 'keyRound' },
};
function categoryMeta(cat) {
  return CATEGORY_META[cat] || { label: String(cat || 'misc').toUpperCase(), color: 'var(--accent-misc)', icon: 'flag' };
}

const fmtDate = (d) => new Date(d).toLocaleString();
const statusBadge = (s) => el('span', { class: `badge ${s}` }, s);
const setView = (...nodes) => app.replaceChildren(...nodes);
const initial = (name) => (name || '?').trim().charAt(0).toUpperCase();

function avatar(photo, name) {
  return el('div', { class: 'avatar' },
    photo ? el('img', { src: `/uploads/${encodeURIComponent(photo)}`, alt: '' }) : initial(name));
}

function toast(msg, kind = 'success') {
  toastEl.textContent = msg;
  toastEl.className = `toast ${kind}`;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500);
}

async function refreshMe() {
  try {
    state.me = await api('/auth/me');
  } catch {
    state.me = null;
  }
  renderAuthArea();
}

// Runs a mutation, reports the result, then refreshes session state and the current view
async function act(fn, okMsg) {
  try {
    const result = await fn();
    if (okMsg) toast(okMsg);
    await refreshMe();
    await route();
    return result;
  } catch (err) {
    toast(err.message, 'error');
  }
}

function renderAuthArea() {
  const area = document.getElementById('auth-area');
  const adminLink = document.querySelector('[data-nav="admin"]');
  if (state.me) {
    area.replaceChildren(
      el('span', { class: 'user' }, state.me.user.username),
      el('button', { class: 'btn ghost small', onclick: logout }, 'Log out')
    );
    adminLink.hidden = state.me.user.role !== 'admin';
  } else {
    area.replaceChildren(
      el('a', { class: 'btn ghost small', href: '#/login' }, 'Log in'),
      el('a', { class: 'btn primary small', href: '#/register' }, 'Sign up')
    );
    adminLink.hidden = true;
  }
}

async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  state.me = null;
  renderAuthArea();
  location.hash = '#/events';
  toast('Logged out.');
}

function requireLogin() {
  if (state.me) return true;
  setView(
    el('div', { class: 'card form' },
      el('h2', {}, 'Log in required'),
      el('p', { class: 'muted' }, 'You need an account to do this.'),
      el('a', { class: 'btn primary', href: '#/login' }, 'Log in'))
  );
  return false;
}

// ---------- events ----------

function eventCard(e) {
  return el('a', { class: 'card event-card', href: `#/events/${e.id}` },
    el('div', { class: 'row' }, el('h3', {}, e.name), statusBadge(e.status)),
    e.description ? el('p', { class: 'muted' }, e.description.slice(0, 160)) : null,
    el('div', { class: 'meta' }, `${fmtDate(e.start_time)} to ${fmtDate(e.end_time)}`),
    el('div', { class: 'meta' }, `${e.team_count} teams · ${e.challenge_count} challenges`));
}

async function viewEvents() {
  const events = await api('/events');
  setView(
    el('h1', {}, 'Events'),
    events.length
      ? el('div', { class: 'grid' }, events.map(eventCard))
      : el('p', { class: 'muted' }, 'No events yet.')
  );
}

async function viewEvent(id) {
  const event = await api(`/events/${id}`);
  const parts = [
    el('div', { class: 'row' }, el('h1', {}, event.name), statusBadge(event.status)),
    event.description ? el('p', { class: 'desc' }, event.description) : null,
    el('div', { class: 'meta' }, `${fmtDate(event.start_time)} to ${fmtDate(event.end_time)}`),
  ];

  const scoreboardBox = el('div', { class: 'card' }, el('h2', {}, 'Scoreboard'), el('p', { class: 'muted' }, 'Loading…'));

  if (!state.me) {
    parts.push(el('p', {}, el('a', { href: '#/login' }, 'Log in'), ' to compete.'));
  } else if (!state.me.team) {
    parts.push(el('p', { class: 'muted' }, 'Join or create a team to compete.'));
  } else {
    try {
      const data = await api(`/events/${id}/challenges`);
      parts.push(challengeSection(event, data));
    } catch (err) {
      if (err.status !== 403) throw err;
      parts.push(registerPanel(event));
    }
  }

  parts.push(scoreboardBox);
  setView(...parts);
  renderScoreboard(id, scoreboardBox).catch(() => {});
}

function registerPanel(event) {
  const isCaptain = state.me.team.is_captain;
  if (event.status === 'ended') {
    return el('div', { class: 'card' }, el('p', { class: 'muted' }, 'Your team did not register for this event.'));
  }
  if (!isCaptain) {
    return el('div', { class: 'card' }, el('p', { class: 'muted' }, 'Your team is not registered. Ask your captain to register it.'));
  }
  return el('div', { class: 'card row' },
    el('div', {}, el('h3', {}, 'Register your team'), el('p', { class: 'muted' }, 'Registration is team-wide. Every member plays under the team.')),
    el('button', {
      class: 'btn primary',
      onclick: () => act(() => api(`/events/${event.id}/register`, { method: 'POST' }), 'Team registered.'),
    }, 'Register team'));
}

function challengeSection(event, data) {
  const detailBox = el('div', { id: 'challenge-detail' });
  const cards = data.challenges.map((c) => challengeCard(c, event, detailBox));
  return el('div', {},
    el('div', { class: 'section-title' },
      el('h2', {}, 'Challenges'),
      el('span', { class: 'stat' }, el('strong', {}, data.balance), 'points to spend')),
    data.challenges.length
      ? el('div', { class: 'grid' }, cards)
      : el('p', { class: 'muted' }, 'No challenges have been posted yet.'),
    detailBox);
}

function challengeCard(c, event, detailBox) {
  const meta = categoryMeta(c.category);
  const cls = ['card', 'challenge'];
  if (c.solved) cls.push('solved');

  return el('div', {
    class: cls.join(' '),
    style: `--cat-color:${meta.color}`,
    onclick: () => openChallenge(c.id, detailBox),
  },
    el('div', { class: 'row' },
      el('span', { class: 'cat-pill' }, icon(meta.icon), meta.label),
      c.solved ? el('span', { class: 'solved-icon' }, icon('checkCircle')) : null),
    el('h3', {}, c.title),
    el('div', { class: 'points-line' }, String(c.point_value), el('small', {}, 'PTS')),
    el('div', { class: 'foot' },
      el('span', {}, c.solved ? 'Solved' : 'Instance ready'),
      el('span', { class: 'launch' }, c.solved ? 'View →' : 'Launch →')));
}

async function openChallenge(id, box) {
  box.replaceChildren(el('div', { class: 'card' }, el('p', { class: 'muted' }, 'Loading…')));
  try {
    const c = await api(`/challenges/${id}`);
    box.replaceChildren(el('div', { class: 'card' },
      el('div', { class: 'row' }, el('h2', {}, c.title), el('span', { class: 'pts' }, `${c.point_value} pts`)),
      el('div', { class: 'meta' }, c.category),
      el('div', { class: 'desc' }, c.description || 'No description.'),
      hintsList(c, box),
      submitForm(c)));
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (err) {
    toast(err.message, 'error');
  }
}

// Re-renders the event page (fresh balance and solve state), then reopens the same challenge
async function reopenChallenge(id) {
  await route();
  const box = document.getElementById('challenge-detail');
  if (box) await openChallenge(id, box);
}

function hintsList(c, box) {
  if (!c.hints.length) return null;
  return el('div', { class: 'hints' },
    el('h3', { class: 'section-title' }, 'Hints'),
    c.hints.map((h, i) => el('div', { class: 'hint' },
      h.purchased
        ? el('span', { class: 'hint-body' }, `Hint ${i + 1}: ${h.body}`)
        : el('span', { class: 'muted' }, `Hint ${i + 1}`),
      h.purchased
        ? null
        : el('button', {
            class: 'btn small',
            onclick: () => act(() => api(`/challenges/${c.id}/hints/${h.id}/buy`, { method: 'POST' }), 'Hint purchased.')
              .then(() => reopenChallenge(c.id)),
          }, h.cost ? `Buy · ${h.cost} pts` : 'Free'))));
}

function submitForm(c) {
  if (c.solved) return el('div', { class: 'flash success' }, 'Your team solved this challenge.');

  const input = el('input', {
    type: 'text', name: 'flag', placeholder: 'ECLIPSE{...}', maxlength: '256',
    autocomplete: 'off', spellcheck: 'false', required: true,
  });
  const btn = el('button', { class: 'btn primary', type: 'submit' }, 'Submit');

  const form = el('form', {
    class: 'submit-row',
    onsubmit: async (e) => {
      e.preventDefault();
      btn.disabled = true;
      try {
        const r = await api(`/challenges/${c.id}/submit`, { method: 'POST', body: { flag: input.value } });
        toast(r.message);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
        await refreshMe();
        await reopenChallenge(c.id);
      }
    },
  }, input, btn);
  return form;
}

// ---------- scoreboard ----------

async function renderScoreboard(eventId, box) {
  const rows = await api(`/events/${eventId}/scoreboard`);
  if (!rows.length) {
    box.replaceChildren(el('h2', {}, 'Scoreboard'), el('p', { class: 'muted' }, 'No teams registered yet.'));
    return;
  }
  const myTeamId = state.me?.team?.id;
  box.replaceChildren(
    el('h2', {}, 'Scoreboard'),
    el('table', {},
      el('thead', {}, el('tr', {},
        el('th', {}, '#'), el('th', {}, 'Team'), el('th', {}, 'Score'), el('th', {}, 'Solves'))),
      el('tbody', {}, rows.map((r, i) => el('tr', { class: r.team_id === myTeamId ? 'me' : '' },
        el('td', {}, i + 1),
        el('td', {}, el('a', { href: `#/teams/${r.team_id}` }, r.name)),
        el('td', {}, r.score),
        el('td', {}, r.solves))))));
}

async function viewScoreboard(eventId) {
  const events = await api('/events');
  if (!events.length) return setView(el('h1', {}, 'Scoreboard'), el('p', { class: 'muted' }, 'No events yet.'));

  const pick = eventId
    ? Number(eventId)
    : (events.find((e) => e.status === 'live') || events.find((e) => e.status === 'upcoming') || events[0]).id;

  const select = el('select', {
    class: 'picker',
    onchange: (e) => { location.hash = `#/scoreboard/${e.target.value}`; },
  }, events.map((e) => el('option', { value: e.id, selected: e.id === pick }, `${e.name} (${e.status})`)));

  const box = el('div', { class: 'card' }, el('p', { class: 'muted' }, 'Loading…'));
  setView(el('h1', {}, 'Scoreboard'), select, box);
  await renderScoreboard(pick, box);

  // Auto-refresh while this view is on screen; stop once it's replaced
  const timer = setInterval(() => {
    if (!box.isConnected) return clearInterval(timer);
    renderScoreboard(pick, box).catch(() => {});
  }, 30000);
}

// ---------- teams ----------

// Shared captain-management panel, used on both the Team page and the Profile page.
// Always renders (even with zero pending requests) so it never silently disappears.
async function captainToolsCard(teamId) {
  const [requests, t] = await Promise.all([
    api(`/teams/${teamId}/requests`),
    api(`/teams/${teamId}`),
  ]);

  const requestList = requests.length
    ? requests.map((r) => el('div', { class: 'row' },
        el('span', {}, r.username),
        el('span', {},
          el('button', { class: 'btn primary small', onclick: () => respond(r.id, 'accept') }, 'Accept'), ' ',
          el('button', { class: 'btn small danger', onclick: () => respond(r.id, 'decline') }, 'Reject'))))
    : el('p', { class: 'muted' }, 'No pending join requests.');

  const memberRows = t.members.map((m) => el('div', { class: 'row' },
    el('span', {}, m.username, ' ', el('span', { class: `badge ${m.role === 'Captain' ? 'captain' : 'member'}` }, m.role)),
    m.role === 'Captain' ? null : el('span', {},
      el('button', {
        class: 'btn small',
        onclick: () => {
          if (!confirm(`Make ${m.username} the captain? You will become a regular member.`)) return;
          act(() => api(`/teams/${teamId}/transfer`, { method: 'POST', body: { userId: m.id } }), 'Captaincy transferred.');
        },
      }, 'Make captain'), ' ',
      el('button', {
        class: 'btn small danger',
        onclick: () => {
          if (!confirm(`Remove ${m.username} from the team?`)) return;
          act(() => api(`/teams/${teamId}/members/${m.id}/remove`, { method: 'POST' }), 'Member removed.');
        },
      }, 'Remove'))));

  const photoForm = el('form', {
    class: 'form-row',
    onsubmit: (e) => {
      e.preventDefault();
      act(() => api(`/teams/${teamId}/photo`, { method: 'PUT', form: new FormData(e.target) }), 'Team photo updated.');
    },
  },
    el('input', { type: 'file', name: 'photo', accept: 'image/png,image/jpeg,image/gif,image/webp', required: true }),
    el('button', { class: 'btn', type: 'submit' }, 'Upload photo'));

  return el('div', { class: 'card' },
    el('h2', {}, 'Team management'),
    el('h3', {}, 'Join requests'), requestList,
    el('h3', { style: undefined }, 'Members'), memberRows,
    el('h3', { style: undefined }, 'Team photo'),
    el('p', { class: 'muted' }, 'PNG, JPEG, GIF, or WebP, max 2 MB.'), photoForm);
}

async function viewTeams() {
  const teams = await api('/teams');
  setView(
    el('h1', {}, 'Teams'),
    teams.length
      ? el('div', { class: 'grid' }, teams.map((t) => el('a', { class: 'card event-card', href: `#/teams/${t.id}` },
          el('div', { class: 'team-head' }, avatar(t.profile_photo, t.name), el('div', {},
            el('h3', {}, t.name),
            el('div', { class: 'meta' }, `Captain: ${t.captain}`))),
          el('div', { class: 'stat-row' },
            el('span', { class: 'stat' }, el('strong', {}, t.member_count), 'members'),
            el('span', { class: 'stat' }, el('strong', {}, t.flag_count), 'flags'),
            el('span', { class: 'stat' }, el('strong', {}, t.total_points), 'points')))))
      : el('p', { class: 'muted' }, 'No teams yet. Create one from your profile.')
  );
}

async function viewTeam(id) {
  const t = await api(`/teams/${id}`);
  const me = state.me;
  const isMember = me?.team?.id === t.id;
  const isCaptain = isMember && me.team.is_captain;
  const parts = [];

  parts.push(el('div', { class: 'team-head' }, avatar(t.profile_photo, t.name), el('div', {},
    el('h1', { style: undefined }, t.name),
    el('div', { class: 'meta' }, `Captain: ${t.captain}`))));

  parts.push(el('div', { class: 'stat-row' },
    el('span', { class: 'stat' }, el('strong', {}, t.members.length), 'members'),
    el('span', { class: 'stat' }, el('strong', {}, t.flag_count), 'flags'),
    el('span', { class: 'stat' }, el('strong', {}, t.total_points), 'points')));

  parts.push(el('div', { class: 'card' },
    el('h2', {}, 'Members'),
    el('table', {},
      el('tbody', {}, t.members.map((m) => el('tr', {},
        el('td', {}, m.username),
        el('td', {}, el('span', { class: `badge ${m.role === 'Captain' ? 'captain' : 'member'}` }, m.role))))))));

  if (t.events.length) {
    parts.push(el('div', { class: 'card' },
      el('h2', {}, 'Events'),
      el('ul', {}, t.events.map((e) => el('li', {},
        el('a', { href: `#/events/${e.id}` }, e.name), ' ', statusBadge(e.status))))));
  }

  if (!me) {
    parts.push(el('p', {}, el('a', { href: '#/login' }, 'Log in'), ' to request to join.'));
  } else if (!me.team) {
    parts.push(el('div', { class: 'card row' },
      el('span', {}, 'Want to play with this team?'),
      el('button', {
        class: 'btn primary',
        onclick: () => act(() => api(`/teams/${t.id}/requests`, { method: 'POST' }), 'Join request sent.'),
      }, 'Request to join')));
  }

  if (isCaptain) {
    parts.push(await captainToolsCard(t.id));
  }

  if (isMember && !isCaptain) {
    parts.push(el('div', { class: 'card row' },
      el('span', { class: 'muted' }, 'You are a member of this team.'),
      el('button', {
        class: 'btn danger',
        onclick: () => act(() => api('/teams/leave', { method: 'POST' }), 'You left the team.'),
      }, 'Leave team')));
  }

  setView(...parts);
}

// ---------- profile ----------

async function viewProfile() {
  if (!requireLogin()) return;
  const { user, team, invites, solves } = state.me;
  const parts = [
    el('h1', {}, 'Profile'),
    el('div', { class: 'card' },
      el('h2', {}, user.username),
      el('div', { class: 'meta' }, user.email),
      el('div', { class: 'meta' }, `Role: ${user.role}`)),
  ];

  if (invites.length) {
    parts.push(el('div', { class: 'card' },
      el('h2', {}, 'Team invitations'),
      invites.map((i) => el('div', { class: 'row', style: undefined },
        el('span', {}, `Invited to ${i.team_name}`),
        el('span', {},
          el('button', { class: 'btn primary small', onclick: () => respond(i.id, 'accept') }, 'Accept'), ' ',
          el('button', { class: 'btn small danger', onclick: () => respond(i.id, 'decline') }, 'Decline'))))));
  }

  if (!team) {
    parts.push(el('div', { class: 'card' },
      el('h2', {}, 'Create a team'),
      el('p', { class: 'muted' }, 'You become the captain. Invite others or approve their join requests.'),
      el('form', {
        class: 'form-row',
        onsubmit: (e) => {
          e.preventDefault();
          const name = new FormData(e.target).get('name');
          act(() => api('/teams', { method: 'POST', body: { name } }), 'Team created.');
        },
      },
        el('input', { name: 'name', placeholder: 'Team name', required: true, maxlength: '40', autocomplete: 'off' }),
        el('button', { class: 'btn primary', type: 'submit' }, 'Create'))));
  } else {
    const teamCard = el('div', { class: 'card' },
      el('div', { class: 'team-head' }, avatar(team.profile_photo, team.name), el('div', {},
        el('h2', {}, el('a', { href: `#/teams/${team.id}` }, team.name)),
        el('span', { class: `badge ${team.is_captain ? 'captain' : 'member'}` }, team.is_captain ? 'Captain' : 'Member'))),
      team.is_captain
        ? null
        : el('button', {
            class: 'btn danger small',
            onclick: () => act(() => api('/teams/leave', { method: 'POST' }), 'You left the team.'),
          }, 'Leave team'));
    parts.push(teamCard);

    if (team.is_captain) {
      parts.push(await captainToolsCard(team.id));
    }

    parts.push(el('div', { class: 'card' },
      el('h2', {}, 'Team solves'),
      solves.length
        ? el('table', {},
            el('thead', {}, el('tr', {}, el('th', {}, 'Challenge'), el('th', {}, 'Event'), el('th', {}, 'Points'), el('th', {}, 'When'))),
            el('tbody', {}, solves.map((s) => el('tr', {},
              el('td', {}, s.title),
              el('td', {}, s.event_name),
              el('td', {}, s.points_awarded),
              el('td', { class: 'muted' }, fmtDate(s.solved_at))))))
        : el('p', { class: 'muted' }, 'No flags captured yet.')));
  }

  setView(...parts);
}

function respond(requestId, action) {
  act(() => api(`/teams/requests/${requestId}`, { method: 'PATCH', body: { action } }),
    action === 'accept' ? 'Request accepted.' : 'Request declined.');
}

// ---------- auth pages ----------

function viewLogin() {
  const form = el('form', {
    class: 'card form',
    onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        await api('/auth/login', { method: 'POST', body: { email: f.get('email'), password: f.get('password') } });
        await refreshMe();
        toast('Logged in.');
        location.hash = '#/profile';
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  },
    el('h2', {}, 'Log in'),
    el('label', {}, 'Gmail', el('input', { name: 'email', type: 'email', required: true, autocomplete: 'email' })),
    el('label', {}, 'Password', el('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' })),
    el('button', { class: 'btn primary', type: 'submit' }, 'Log in'),
    el('p', { class: 'muted' }, 'No account? ', el('a', { href: '#/register' }, 'Sign up')));
  setView(form);
}

function viewRegister() {
  const form = el('form', {
    class: 'card form',
    onsubmit: async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      try {
        await api('/auth/register', {
          method: 'POST',
          body: { email: f.get('email'), username: f.get('username'), password: f.get('password') },
        });
        await refreshMe();
        toast('Account created.');
        location.hash = '#/profile';
      } catch (err) {
        toast(err.message, 'error');
      }
    },
  },
    el('h2', {}, 'Create account'),
    el('label', {}, 'Gmail (@gmail.com)', el('input', { name: 'email', type: 'email', required: true, autocomplete: 'email' })),
    el('label', {}, 'Username', el('input', { name: 'username', required: true, minlength: '3', maxlength: '32', autocomplete: 'username' })),
    el('label', {}, 'Password (8+ characters)', el('input', { name: 'password', type: 'password', required: true, minlength: '8', autocomplete: 'new-password' })),
    el('button', { class: 'btn primary', type: 'submit' }, 'Sign up'),
    el('p', { class: 'muted' }, 'Already registered? ', el('a', { href: '#/login' }, 'Log in')));
  setView(form);
}

// ---------- admin ----------

// Converts a DB "YYYY-MM-DD HH:MM:SS" (UTC) into the value a datetime-local input needs
function toLocalInputValue(utcString) {
  const d = new Date(utcString.replace(' ', 'T') + 'Z');
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function eventForm(existing, onSaved) {
  const isEdit = Boolean(existing);
  const form = el('form', {
    class: 'card form-wide',
    onsubmit: (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const payload = {
        name: f.get('name'),
        description: f.get('description'),
        start_time: new Date(f.get('start_time')).toISOString(),
        end_time: new Date(f.get('end_time')).toISOString(),
      };
      const call = isEdit
        ? api(`/admin/events/${existing.id}`, { method: 'PATCH', body: payload })
        : api('/admin/events', { method: 'POST', body: payload });
      act(() => call, isEdit ? 'Event updated.' : 'Event created.').then(onSaved);
    },
  },
    el('h2', {}, isEdit ? `Edit event #${existing.id}` : 'Create event'),
    el('label', {}, 'Name', el('input', { name: 'name', required: true, maxlength: '120', value: existing?.name })),
    el('label', {}, 'Description', el('textarea', { name: 'description', maxlength: '5000' }, existing?.description || '')),
    el('label', {}, 'Starts (local time)', el('input', {
      name: 'start_time', type: 'datetime-local', required: true,
      value: existing ? toLocalInputValue(existing.start_time) : undefined,
    })),
    el('label', {}, 'Ends (local time)', el('input', {
      name: 'end_time', type: 'datetime-local', required: true,
      value: existing ? toLocalInputValue(existing.end_time) : undefined,
    })),
    el('div', { class: 'form-row' },
      el('button', { class: 'btn primary', type: 'submit' }, isEdit ? 'Save changes' : 'Create event'),
      isEdit ? el('button', {
        class: 'btn danger', type: 'button',
        onclick: () => {
          if (!confirm(`Delete "${existing.name}"? This removes its challenges and scores.`)) return;
          act(() => api(`/admin/events/${existing.id}`, { method: 'DELETE' }), 'Event deleted.').then(onSaved);
        },
      }, 'Delete event') : null));
  return form;
}

function eventListCard(events, title, { onInspect, onEdit } = {}) {
  const rows = events.length
    ? el('table', {},
        el('tbody', {}, events.map((ev) => el('tr', {},
          el('td', {}, ev.name), el('td', {}, statusBadge(ev.status)),
          el('td', { class: 'muted' }, `${ev.challenge_count} challenges · ${ev.team_count} teams`),
          el('td', {},
            el('button', { class: 'btn small ghost', onclick: () => onInspect(ev) }, 'Inspect'),
            onEdit ? el('button', { class: 'btn small', onclick: () => onEdit(ev) }, 'Edit') : null)))))
    : el('p', { class: 'muted' }, 'No events yet.');
  return el('div', { class: 'card' }, el('h2', {}, title), rows);
}

function challengeForm(events, onSaved) {
  if (!events.length) return el('p', { class: 'muted' }, 'Create an event before adding challenges.');
  const select = el('select', { name: 'event_id', required: true },
    events.map((ev) => el('option', { value: ev.id }, `#${ev.id} ${ev.name} (${ev.status})`)));

  const form = el('form', {
    class: 'card form-wide',
    onsubmit: (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const hints = String(f.get('hints') || '').split('\n')
        .map((line) => line.trim()).filter(Boolean)
        .map((line) => {
          // Format per line: "cost|hint text", or just "hint text" for a free hint
          const i = line.indexOf('|');
          if (i < 0) return { cost: 0, body: line };
          return { cost: Number(line.slice(0, i).trim()), body: line.slice(i + 1).trim() };
        });
      act(() => api(`/admin/events/${f.get('event_id')}/challenges`, {
        method: 'POST',
        body: {
          title: f.get('title'),
          category: f.get('category'),
          description: f.get('description'),
          flag: f.get('flag'),
          point_value: Number(f.get('point_value')),
          hints,
        },
      }), 'Challenge created.').then(onSaved);
      form.reset();
    },
  },
    el('h2', {}, 'Add challenge'),
    el('label', {}, 'Event', select),
    el('label', {}, 'Title', el('input', { name: 'title', required: true, maxlength: '120' })),
    el('label', {}, 'Category', el('input', { name: 'category', value: 'web', maxlength: '40' })),
    el('label', {}, 'Description', el('textarea', { name: 'description', maxlength: '10000' })),
    el('label', {}, 'Flag', el('input', { name: 'flag', required: true, maxlength: '256', autocomplete: 'off', spellcheck: 'false' })),
    el('label', {}, 'Points', el('input', { name: 'point_value', type: 'number', min: '1', required: true })),
    el('label', {}, 'Hints, one per line as "cost|text" (max 10, 0 cost = free)',
      el('textarea', { name: 'hints', placeholder: '50|Check the robots.txt\n100|The cookie is not signed' })),
    el('button', { class: 'btn primary', type: 'submit' }, 'Create challenge'));
  return form;
}

async function challengeListCard(events, onInspect) {
  if (!events.length) return null;
  const select = el('select', { class: 'picker' },
    events.map((ev) => el('option', { value: ev.id }, `#${ev.id} ${ev.name}`)));
  const body = el('tbody', {});
  const table = el('table', {}, el('thead', {}, el('tr', {},
    el('th', {}, 'Title'), el('th', {}, 'Category'), el('th', {}, 'Points'),
    el('th', {}, 'Hints'), el('th', {}, 'Solves'), el('th', {}))), body);

  async function load() {
    const rows = await api(`/admin/events/${select.value}/challenges`);
    body.replaceChildren(...(rows.length ? rows.map((c) => el('tr', {},
      el('td', {}, c.title), el('td', {}, c.category), el('td', {}, c.point_value),
      el('td', {}, c.hint_count), el('td', {}, c.solves),
      el('td', {},
        el('button', { class: 'btn small ghost', onclick: () => onInspect(c) }, 'Inspect'),
        el('button', {
          class: 'btn small danger',
          onclick: () => {
            if (!confirm(`Delete challenge "${c.title}"?`)) return;
            act(() => api(`/admin/challenges/${c.id}`, { method: 'DELETE' }), 'Challenge deleted.').then(load);
          },
        }, 'Delete')))) : [el('tr', {}, el('td', { colspan: '6' }, 'No challenges for this event.'))]));
  }
  select.addEventListener('change', load);
  await load();

  return el('div', { class: 'card' }, el('h2', {}, 'Manage challenges'), select, table);
}

function teamListCard(teams, onDeleted, onInspect) {
  const body = el('tbody', {}, teams.length ? teams.map((t) => el('tr', {},
    el('td', {}, el('a', { href: `#/teams/${t.id}` }, t.name)),
    el('td', {}, t.captain), el('td', {}, t.member_count),
    el('td', {}, t.flag_count), el('td', {}, t.total_points),
    el('td', {},
      el('button', { class: 'btn small ghost', onclick: () => onInspect(t) }, 'Inspect'),
      el('button', {
        class: 'btn small danger',
        onclick: () => {
          if (!confirm(`Delete team "${t.name}"? Members will be removed from the team.`)) return;
          act(() => api(`/admin/teams/${t.id}`, { method: 'DELETE' }), 'Team deleted.').then(onDeleted);
        },
      }, 'Delete')))) : [el('tr', {}, el('td', { colspan: '6' }, 'No teams yet.'))]);

  return el('div', { class: 'card' },
    el('h2', {}, 'Manage teams'),
    el('table', {},
      el('thead', {}, el('tr', {},
        el('th', {}, 'Team'), el('th', {}, 'Captain'), el('th', {}, 'Members'),
        el('th', {}, 'Flags'), el('th', {}, 'Points'), el('th', {}))),
      body));
}

const ADMIN_NAV = [
  { id: 'dashboard', label: 'Dashboard', icon: 'layout' },
  { id: 'events', label: 'Events', icon: 'activity' },
  { id: 'challenges', label: 'Challenges', icon: 'terminal' },
  { id: 'teams', label: 'Teams', icon: 'users' },
];

async function viewAdmin() {
  if (!requireLogin()) return;
  if (state.me.user.role !== 'admin') return setView(el('div', { class: 'flash error' }, 'Admins only.'));

  let events = await api('/admin/events');
  let teams = await api('/admin/teams');
  let section = 'dashboard';

  const inspectorBody = el('div', {}, el('p', { class: 'empty' }, 'Select an item to inspect its details.'));
  const inspector = el('aside', { class: 'tahoe-inspector tahoe-shadow-card' },
    el('h3', {}, 'Inspector'), inspectorBody);

  function setInspector(fields) {
    inspectorBody.replaceChildren(...fields.map(([k, v]) => el('div', { class: 'field' },
      el('div', { class: 'k' }, k), el('div', { class: 'v' }, String(v)))));
  }
  const inspectEvent = (ev) => setInspector([
    ['Name', ev.name], ['Status', ev.status], ['Starts', fmtDate(ev.start_time)],
    ['Ends', fmtDate(ev.end_time)], ['Challenges', ev.challenge_count], ['Teams', ev.team_count],
  ]);
  const inspectChallenge = (c) => setInspector([
    ['Title', c.title], ['Category', c.category], ['Points', c.point_value],
    ['Hints', c.hint_count], ['Solves', c.solves],
  ]);
  const inspectTeam = (t) => setInspector([
    ['Name', t.name], ['Captain', t.captain], ['Members', t.member_count],
    ['Flags', t.flag_count], ['Points', t.total_points],
  ]);

  const main = el('div', { class: 'tahoe-main' });

  async function reload() {
    [events, teams] = await Promise.all([api('/admin/events'), api('/admin/teams')]);
    await renderMain();
  }

  function dashboardMetrics() {
    const totalChallenges = events.reduce((n, e) => n + e.challenge_count, 0);
    const totalFlags = teams.reduce((n, t) => n + t.flag_count, 0);
    const metrics = [
      { label: 'Events', value: events.length, iconName: 'layout' },
      { label: 'Challenges', value: totalChallenges, iconName: 'flag' },
      { label: 'Teams', value: teams.length, iconName: 'users' },
      { label: 'Flags captured', value: totalFlags, iconName: 'trophy' },
    ];
    return el('div', { class: 'metric-grid' }, metrics.map((m) => el('div', { class: 'metric-card tahoe-shadow-card' },
      el('div', { class: 'top-row' }, el('span', {}, m.label), icon(m.iconName)),
      el('div', { class: 'value' }, String(m.value)))));
  }

  async function renderMain() {
    const parts = [];
    if (section === 'dashboard') {
      parts.push(
        el('h1', {}, 'Dashboard'),
        dashboardMetrics(),
        eventListCard(events, 'Recent events', { onInspect: inspectEvent }));
    } else if (section === 'events') {
      const formSlot = el('div', {});
      formSlot.replaceChildren(eventForm(null, reload));
      parts.push(
        el('h1', {}, 'Events'),
        eventListCard(events, 'All events', {
          onInspect: inspectEvent,
          onEdit: (ev) => { inspectEvent(ev); formSlot.replaceChildren(eventForm(ev, reload)); },
        }),
        formSlot);
    } else if (section === 'challenges') {
      parts.push(
        el('h1', {}, 'Challenges'),
        challengeForm(events, reload),
        await challengeListCard(events, inspectChallenge));
    } else if (section === 'teams') {
      parts.push(
        el('h1', {}, 'Teams'),
        teamListCard(teams, reload, inspectTeam));
    }
    main.replaceChildren(...parts);
  }

  const navButtons = ADMIN_NAV.map((item) => el('button', {
    class: `side-link${item.id === section ? ' active' : ''}`,
    type: 'button',
    onclick: async () => {
      section = item.id;
      navButtons.forEach((b, i) => b.classList.toggle('active', ADMIN_NAV[i].id === section));
      await renderMain();
    },
  }, icon(item.icon), item.label));

  const sidebar = el('nav', { class: 'tahoe-sidebar tahoe-shadow-card' },
    el('div', { class: 'side-label' }, 'Competition control'),
    navButtons);

  await renderMain();

  setView(el('div', { class: 'tahoe-shell' }, sidebar, main, inspector));
}

// ---------- router ----------

const routes = [
  [/^#?\/?$|^#\/events$/, () => viewEvents()],
  [/^#\/events\/(\d+)$/, (m) => viewEvent(m[1])],
  [/^#\/teams$/, () => viewTeams()],
  [/^#\/teams\/(\d+)$/, (m) => viewTeam(m[1])],
  [/^#\/scoreboard(?:\/(\d+))?$/, (m) => viewScoreboard(m[1])],
  [/^#\/profile$/, () => viewProfile()],
  [/^#\/login$/, () => viewLogin()],
  [/^#\/register$/, () => viewRegister()],
  [/^#\/admin$/, () => viewAdmin()],
];

async function route() {
  const hash = location.hash || '#/events';
  document.querySelectorAll('[data-nav]').forEach((a) => {
    a.classList.toggle('active', hash.startsWith(`#/${a.dataset.nav}`));
  });

  const match = routes.find(([re]) => re.test(hash));
  if (!match) return setView(el('p', { class: 'muted' }, 'Page not found.'));

  try {
    await match[1](hash.match(match[0]));
  } catch (err) {
    setView(el('div', { class: 'flash error' }, err.message));
  }
}

window.addEventListener('hashchange', route);

(async () => {
  await refreshMe();
  await route();
})();
