const config = window.SOUTIEN_CONFIG ?? {};
export const configured = Boolean(config.supabaseUrl && config.publishableKey);
export const demo = !configured && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const root = config.supabaseUrl?.replace(/\/$/, '');
const storageKey = 'soutien-maths-demo-v1';
let accessToken = '';

export function parisNow() {
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).format(new Date());
  return parts.replace(' ', 'T');
}

export function addDays(date, days) {
  const result = new Date(date + 'T00:00:00Z');
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function weekMonday(date) {
  const day = new Date(date + 'T00:00:00Z').getUTCDay();
  return addDays(date, -((day + 6) % 7));
}

export function finished(monday, slot) {
  return addDays(monday, slot.day) + 'T' + (slot.ends.length === 5 ? slot.ends + ':00' : slot.ends) <= parisNow();
}

function standardWeek(monday) {
  const group = crypto.randomUUID();
  const rows = [
    [0, '11:30', '14:00', '210'],
    [1, '12:30', '13:30', '210', group],
    [1, '13:00', '14:00', '210', group],
    [2, '10:30', '14:00', '212'],
    [3, '11:30', '14:00', '214'],
    [4, '11:30', '14:00', '216'],
  ];
  return {
    monday,
    slots: rows.map(([day, starts, ends, room, choice_group]) => ({
      id: crypto.randomUUID(), day, starts, ends, room, choice_group,
    })),
  };
}

function getDemo() {
  const stored = localStorage.getItem(storageKey);
  if (stored) return JSON.parse(stored);
  const initial = { weeks: [standardWeek(weekMonday(parisNow().slice(0, 10)))], registrations: {} };
  localStorage.setItem(storageKey, JSON.stringify(initial));
  return initial;
}

function saveDemo(data) {
  localStorage.setItem(storageKey, JSON.stringify(data));
}

async function request(path, body) {
  const headers = { apikey: config.publishableKey, 'Content-Type': 'application/json' };
  if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
  const result = await fetch(root + path, {
    method: 'POST', headers, body: JSON.stringify(body), cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  const raw = await result.text();
  const data = raw ? JSON.parse(raw) : null;
  if (!result.ok) {
    if (path.startsWith('/auth/')) throw new Error('Adresse e-mail ou mot de passe incorrect, ou connexion indisponible.');
    if (result.status === 401) throw new Error('La session a expiré. Déconnecte-toi puis reconnecte-toi.');
    if (data?.code === 'P0001') throw new Error(data.message);
    throw new Error('Le serveur n’a pas pu effectuer cette action.');
  }
  return data;
}

function rpc(name, body = {}) {
  return request('/rest/v1/rpc/soutien_' + name, body);
}

export async function signIn(email, password) {
  const data = await request('/auth/v1/token?grant_type=password', { email, password });
  accessToken = data.access_token;
  try {
    if (!(await rpc('teacher'))) throw new Error('Ce compte ne dispose pas de l’accès enseignant.');
  } catch (error) {
    accessToken = '';
    throw error;
  }
}

export function signOut() {
  accessToken = '';
}

export function loadWeeks() {
  return demo ? getDemo().weeks : rpc('schedule');
}

export function normalizeField(value) {
  return value.trim().replace(/\s+/gu, ' ').normalize();
}

function identity(person) {
  return JSON.stringify([person.family, person.given, person.classroom].map(value => value.toLowerCase()));
}

export function register(person, ids) {
  if (!demo) {
    return rpc('register', {
      p_family: person.family, p_given: person.given, p_classroom: person.classroom, p_slots: ids,
    });
  }

  const data = getDemo();
  const personKey = identity(person);
  for (const id of ids) {
    const week = data.weeks.find(item => item.slots.some(slot => slot.id === id));
    const slot = week?.slots.find(item => item.id === id);
    if (!slot || finished(week.monday, slot)) throw new Error('Ce créneau est terminé ou a été retiré.');
    const alternates = week.slots.filter(item => item.id !== id && slot.choice_group && item.choice_group === slot.choice_group);
    if (alternates.some(item => data.registrations[item.id]?.some(row => identity(row) === personKey))) {
      throw new Error('Une autre option du même créneau est déjà inscrite pour cet élève.');
    }
    const list = data.registrations[id] ??= [];
    if (!list.some(row => identity(row) === personKey)) list.push(person);
  }
  saveDemo(data);
}

export function loadRoster(id) {
  return demo ? getDemo().registrations[id] ?? [] : rpc('roster', { p_id: id });
}

export function addWeek(monday, standard) {
  if (!demo) return rpc('add_week', { p_monday: monday, p_standard: standard });
  const data = getDemo();
  if (data.weeks.some(week => week.monday === monday)) throw new Error('Cette semaine existe déjà.');
  data.weeks.push(standard ? standardWeek(monday) : { monday, slots: [] });
  saveDemo(data);
}

export function deleteWeek(monday) {
  if (!demo) return rpc('delete_week', { p_monday: monday });
  const data = getDemo();
  const week = data.weeks.find(item => item.monday === monday);
  for (const slot of week?.slots ?? []) delete data.registrations[slot.id];
  data.weeks = data.weeks.filter(item => item.monday !== monday);
  saveDemo(data);
}

export function saveSlot(monday, slot) {
  if (!demo) return rpc('save_slot', {
    p_id: slot.id, p_monday: monday, p_day: slot.day, p_starts: slot.starts, p_ends: slot.ends, p_room: slot.room,
  });
  const data = getDemo();
  const week = data.weeks.find(item => item.monday === monday);
  const old = week.slots.find(item => item.id === slot.id);
  if (old && slot.day !== old.day && data.registrations[old.id]?.length) {
    throw new Error('Ce créneau a déjà des inscrits. Son jour ne peut plus être modifié.');
  }
  if (week.slots.some(item => item.id !== slot.id && item.day === slot.day && item.room === slot.room
    && item.starts === slot.starts && item.ends === slot.ends)) {
    throw new Error('Un créneau identique existe déjà.');
  }
  if (old) Object.assign(old, slot);
  else week.slots.push({ ...slot, id: crypto.randomUUID() });
  saveDemo(data);
  return old?.id ?? week.slots.at(-1).id;
}

export function deleteSlot(monday, id) {
  if (!demo) return rpc('delete_slot', { p_id: id });
  const data = getDemo();
  const week = data.weeks.find(item => item.monday === monday);
  if (week) week.slots = week.slots.filter(item => item.id !== id);
  delete data.registrations[id];
  saveDemo(data);
}
