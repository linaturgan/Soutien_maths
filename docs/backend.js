const config = window.SOUTIEN_CONFIG ?? {};
export const configured = Boolean(config.supabaseUrl && config.publishableKey);
export const demo = !configured && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const root = config.supabaseUrl?.replace(/\/$/, '');
const storageKey = 'soutien-maths-demo-v2';
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

export function registrationStatus(monday, slot, now = Date.parse(parisNow() + 'Z')) {
  const date = addDays(monday, slot.day);
  const ends = Date.parse(date + 'T' + slot.ends + 'Z');
  const starts = Date.parse(date + 'T' + slot.starts + 'Z');
  if (ends <= now) return 'Terminé';
  if (slot.full) return 'Complet';
  if (starts - 3600000 <= now) return 'Inscriptions closes';
  return '';
}

function standardWeek(monday) {
  const rooms = ['210', '210', '212', '214', '216'];
  const periods = [['10:30', '11:30'], ['11:30', '12:30'], ['12:30', '13:30'], ['13:00', '14:00']];
  const firstPeriod = [1, 2, 0, 1, 1];
  return {
    monday,
    slots: rooms.flatMap((room, day) => periods.slice(firstPeriod[day]).map(([starts, ends]) => ({
      id: crypto.randomUUID(), day, starts, ends, room,
    }))),
  };
}

function getDemo() {
  const stored = localStorage.getItem(storageKey);
  if (stored) return JSON.parse(stored);
  const initial = { weeks: [standardWeek(weekMonday(parisNow().slice(0, 10)))], registrations: {}, messages: [] };
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

export function loadWeeks(teacher) {
  if (!demo) return rpc(teacher ? 'teacher_schedule' : 'schedule');
  const { weeks, registrations } = getDemo();
  for (const week of weeks) {
    for (const slot of week.slots) {
      const count = registrations[slot.id]?.length ?? 0;
      if (teacher) slot.registration_count = count;
      else slot.full = count >= 20;
    }
  }
  return weeks;
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
    if (!slot) throw new Error('Ce créneau a été retiré.');
    const list = data.registrations[id] ??= [];
    if (list.some(row => identity(row) === personKey)) continue;
    if (registrationStatus(week.monday, { ...slot, full: list.length >= 20 })) {
      throw new Error('Ce créneau ne prend plus d’inscriptions.');
    }
    list.push(person);
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

export function sendMessage(person, subject, body) {
  if (!demo) return rpc('send_message', {
    p_family: person.family, p_given: person.given, p_classroom: person.classroom,
    p_subject: subject, p_body: body,
  });
  const data = getDemo();
  data.messages.unshift({ ...person, subject, body, id: crypto.randomUUID(), received_at: new Date().toISOString() });
  saveDemo(data);
}

export function loadMessages() {
  return demo ? getDemo().messages : rpc('inbox');
}

export function deleteMessage(id) {
  if (!demo) return rpc('delete_message', { p_id: id });
  const data = getDemo();
  data.messages = data.messages.filter(message => message.id !== id);
  saveDemo(data);
}

export function cancelRegistration(id, person) {
  if (!demo) return rpc('cancel_registration', {
    p_id: id, p_family: person.family, p_given: person.given, p_classroom: person.classroom,
  });
  const data = getDemo();
  const personKey = identity(person);
  data.registrations[id] = (data.registrations[id] ?? []).filter(row => identity(row) !== personKey);
  saveDemo(data);
}
