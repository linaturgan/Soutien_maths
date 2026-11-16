import * as api from './backend.js';

const $ = id => document.getElementById(id);
const teacherPage = new URLSearchParams(location.search).has('prof');
const dayNames = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const fullDate = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
});
const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });
const chosen = new Set();
let weeks = [];
let monday;
let activeSlot;
let roster;
let rosterRequest = 0;
let editorAction;
let ready = false;
let submitting = false;

const asDate = date => new Date(date + 'T00:00:00Z');
const currentWeek = () => weeks.find(week => week.monday === monday);
const timeLabel = time => time.slice(0, 5).replace(':', ' h ');
const hours = slot => timeLabel(slot.starts) + ' – ' + timeLabel(slot.ends);
const currentMonday = () => api.weekMonday(api.parisNow().slice(0, 10));
const errorMessage = error => (
  error instanceof TypeError || error.name === 'TimeoutError'
    ? 'La connexion a échoué. Vérifie ton accès à Internet puis réessaie.'
    : error.message
);

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value != null) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function status(value = '', kind = '') {
  $('status').textContent = value;
  $('status').className = 'notice ' + kind;
  $('status').hidden = !value;
  if (value) $('status').scrollIntoView({ block: 'nearest' });
}

function weekLabel(date) {
  const friday = api.addDays(date, 4);
  const start = date.slice(0, 7) === friday.slice(0, 7) ? Number(date.slice(-2)) : dayMonth.format(asDate(date));
  return 'Du ' + start + ' au ' + dayMonth.format(asDate(friday)) + ' ' + friday.slice(0, 4);
}

function syncSelection() {
  document.querySelectorAll('button[data-slot]').forEach(button => {
    button.setAttribute('aria-pressed', String(teacherPage ? button.dataset.slot === activeSlot?.id : chosen.has(button.dataset.slot)));
  });
  $('selection-count').textContent = chosen.size + (chosen.size > 1 ? ' créneaux sélectionnés' : ' créneau sélectionné');
  $('submit-area').classList.toggle('has-selection', chosen.size > 0);
  $('register').disabled = submitting || !chosen.size;
}

function toggleSlot(slot, slots) {
  if (submitting) return;
  if (chosen.delete(slot.id)) {
    syncSelection();
    return;
  }
  if (slot.choice_group) {
    slots.filter(other => other.choice_group === slot.choice_group).forEach(other => chosen.delete(other.id));
  }
  if (chosen.size === 50) {
    status('Tu peux choisir jusqu’à 50 créneaux par inscription.', 'error');
    return;
  }
  chosen.add(slot.id);
  syncSelection();
}

function renderSchedule() {
  const week = currentWeek();
  const slots = week?.slots ?? [];
  $('week').replaceChildren(...weeks.map(item => new Option(weekLabel(item.monday), item.monday)));
  if (!week) $('week').add(new Option('Aucune semaine', ''));
  $('week').disabled = !week;
  $('week').value = monday ?? '';
  $('add-slot').disabled = !week;
  $('delete-week').disabled = !week;
  $('week-caption').textContent = week
    ? (teacherPage ? 'Sélectionne un créneau pour ouvrir sa liste d’appel.' : 'Tu peux choisir plusieurs séances. Les créneaux terminés restent visibles.')
    : (teacherPage ? 'Ajoute une semaine pour publier de nouveaux créneaux.' : 'Aucune semaine de soutien n’est affichée pour le moment.');
  $('days').replaceChildren();
  if (!week) return;
  for (const [day, name] of dayNames.entries()) {
    const column = element('section', null, 'day');
    const heading = element('h3', name);
    const date = api.addDays(monday, day);
    const time = element('time', dayMonth.format(asDate(date)));
    time.dateTime = date;
    heading.append(time);
    const cards = element('div', null, 'day-slots');
    const items = slots.filter(slot => slot.day === day)
      .sort((a, b) => a.starts.localeCompare(b.starts) || a.ends.localeCompare(b.ends) || collator.compare(a.room, b.room));
    if (!items.length) cards.append(element('p', 'Aucun créneau', 'empty'));
    if (!teacherPage && items.some(slot => slot.choice_group && items.filter(other => other.choice_group === slot.choice_group).length > 1)) {
      cards.append(element('p', 'Choisis une seule des deux options.', 'choice'));
    }
    for (const slot of items) {
      const button = element('button', null, 'slot');
      button.type = 'button';
      button.dataset.slot = slot.id;
      button.disabled = !teacherPage && api.finished(monday, slot);
      button.append(element('span', hours(slot), 'slot-time'));
      button.append(element('span', 'Salle ' + slot.room + (button.disabled ? ' · Terminé' : ''), 'slot-room'));
      button.addEventListener('click', () => teacherPage ? openRoster(slot) : toggleSlot(slot, items));
      cards.append(button);
    }
    column.append(heading, cards);
    $('days').append(column);
  }
  syncSelection();
}

async function refreshWeeks(preferred) {
  weeks = (await api.loadWeeks()).sort((a, b) => a.monday.localeCompare(b.monday));
  const todayWeek = currentMonday();
  monday = weeks.some(week => week.monday === preferred)
    ? preferred
    : (weeks.find(week => week.monday >= todayWeek) ?? weeks.at(-1))?.monday;
  const available = new Set(weeks.flatMap(week => week.slots.filter(slot => !api.finished(week.monday, slot)).map(slot => slot.id)));
  for (const id of chosen) {
    if (!available.has(id)) chosen.delete(id);
  }
  renderSchedule();
  syncSelection();
}

function closeRoster() {
  ++rosterRequest;
  roster = undefined;
  activeSlot = undefined;
  $('roster').hidden = true;
  $('roster-content').replaceChildren();
  syncSelection();
}

async function openRoster(slot, scroll = true) {
  const request = ++rosterRequest;
  const date = api.addDays(monday, slot.day);
  activeSlot = slot;
  roster = undefined;
  $('roster').hidden = false;
  $('export').disabled = true;
  $('roster-caption').textContent = fullDate.format(asDate(date)) + ' · ' + hours(slot) + ' · Salle ' + slot.room;
  $('roster-content').replaceChildren(element('p', 'Chargement des inscrits…'));
  syncSelection();
  if (scroll) $('roster').scrollIntoView({ block: 'start' });
  try {
    const list = await api.loadRoster(slot.id);
    if (request !== rosterRequest) return;
    roster = list.sort((a, b) => collator.compare(a.family, b.family)
      || collator.compare(a.given, b.given) || collator.compare(a.classroom, b.classroom));
    $('export').disabled = false;
    if (!roster.length) {
      $('roster-content').replaceChildren(element('p', 'Aucune inscription pour ce créneau.'));
      return;
    }
    const table = element('table');
    const headers = table.createTHead().insertRow();
    for (const label of ['Nom', 'Prénom', 'Classe']) {
      const header = element('th', label);
      header.scope = 'col';
      headers.append(header);
    }
    const body = table.createTBody();
    for (const student of roster) {
      const row = body.insertRow();
      for (const value of [student.family, student.given, student.classroom]) row.insertCell().textContent = value;
    }
    $('roster-content').replaceChildren(table);
  } catch (error) {
    if (request === rosterRequest) $('roster-content').replaceChildren(element('p', errorMessage(error), 'notice error'));
  }
}

function edit(title, fields, action) {
  $('editor-title').textContent = title;
  $('editor-error').textContent = '';
  $('editor-fields').replaceChildren(...fields);
  editorAction = action;
  $('editor').showModal();
}

function field(labelText, name, type, value, options = {}) {
  const label = element('label', labelText, type === 'checkbox' ? 'check' : '');
  const input = element('input');
  input.name = name;
  input.type = type;
  if (type === 'checkbox') input.checked = value;
  else {
    input.required = true;
    input.value = value;
  }
  Object.assign(input, options);
  if (type === 'checkbox') label.prepend(input);
  else label.append(input);
  return label;
}

function showSlotEditor(slot) {
  const targetMonday = monday;
  const label = element('label', 'Jour');
  const day = element('select');
  day.name = 'day';
  for (const [index, name] of dayNames.entries()) day.add(new Option(name, index));
  day.value = slot?.day ?? 0;
  day.disabled = Boolean(slot?.choice_group);
  label.append(day);
  edit(slot ? 'Modifier le créneau' : 'Ajouter un créneau', [
    label,
    field('Début', 'starts', 'time', slot?.starts.slice(0, 5) ?? '12:00'),
    field('Fin', 'ends', 'time', slot?.ends.slice(0, 5) ?? '13:00'),
    field('Salle', 'room', 'text', slot?.room ?? '', { maxLength: 30 }),
  ], async form => {
    const starts = form.get('starts');
    const ends = form.get('ends');
    const room = api.normalizeField(form.get('room'));
    if (!room || starts >= ends) throw new Error('Vérifie la salle et indique une fin après le début.');
    const id = await api.saveSlot(targetMonday, {
      id: slot?.id ?? null, day: Number(day.value), starts, ends, room,
    });
    await refreshWeeks(targetMonday);
    const saved = currentWeek()?.slots.find(item => item.id === id);
    if (saved) void openRoster(saved, false);
  });
}

$('editor-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const save = form.querySelector('button[type=submit]');
  if (save.disabled) return;
  save.disabled = true;
  $('cancel-editor').disabled = true;
  $('editor-error').textContent = '';
  try {
    await editorAction(new FormData(form));
    $('editor').close();
    status('Modifications enregistrées.', 'success');
  } catch (error) {
    $('editor-error').textContent = errorMessage(error);
  } finally {
    save.disabled = false;
    $('cancel-editor').disabled = false;
  }
});
$('editor').addEventListener('cancel', event => {
  if ($('cancel-editor').disabled) event.preventDefault();
});
$('cancel-editor').addEventListener('click', () => $('editor').close());

$('week').addEventListener('change', event => {
  closeRoster();
  monday = event.currentTarget.value;
  renderSchedule();
});

$('add-week').addEventListener('click', () => {
  let next = currentMonday();
  while (weeks.some(week => week.monday === next)) next = api.addDays(next, 7);
  edit('Ajouter une semaine', [
    field('Lundi de la semaine', 'monday', 'date', next),
    field('Utiliser les créneaux habituels', 'standard', 'checkbox', true),
  ], async form => {
    const date = form.get('monday');
    if (!date || api.weekMonday(date) !== date) throw new Error('Choisis la date d’un lundi.');
    await api.addWeek(date, form.has('standard'));
    closeRoster();
    await refreshWeeks(date);
  });
});
$('add-slot').addEventListener('click', () => showSlotEditor());
$('edit-slot').addEventListener('click', () => {
  if (activeSlot) showSlotEditor(activeSlot);
});

async function remove(button, message, operation, preferred) {
  if (!confirm(message)) return;
  button.disabled = true;
  try {
    await operation();
    closeRoster();
    await refreshWeeks(preferred);
    status('Suppression effectuée.', 'success');
  } catch (error) {
    status(errorMessage(error), 'error');
  } finally {
    button.disabled = button.id === 'delete-week' && !currentWeek();
  }
}

$('delete-week').addEventListener('click', event => {
  const date = monday;
  void remove(event.currentTarget, 'Supprimer cette semaine, ses créneaux et toutes leurs inscriptions ?', () => api.deleteWeek(date));
});
$('delete-slot').addEventListener('click', event => {
  const date = monday;
  const id = activeSlot?.id;
  if (id) void remove(event.currentTarget, 'Supprimer ce créneau et ses inscriptions ?', () => api.deleteSlot(date, id), date);
});
$('export').addEventListener('click', async event => {
  const button = event.currentTarget;
  const exportedRoster = roster;
  const date = api.addDays(monday, activeSlot.day);
  const description = $('roster-caption').textContent;
  button.disabled = true;
  try {
    const { downloadRoster } = await import('./roster.js');
    await downloadRoster(exportedRoster, description, date);
  } catch (error) {
    status(errorMessage(error), 'error');
  } finally {
    if (roster === exportedRoster) button.disabled = false;
  }
});

$('registration').addEventListener('submit', async event => {
  event.preventDefault();
  if (!chosen.size || submitting) return;
  const form = event.currentTarget;
  const fields = new FormData(form);
  const person = Object.fromEntries(['family', 'given', 'classroom'].map(key => [key, api.normalizeField(fields.get(key))]));
  if (Object.values(person).some(value => !value)) {
    status('Renseigne ton nom, ton prénom et ta classe.', 'error');
    return;
  }
  submitting = true;
  syncSelection();
  const inputs = form.querySelectorAll('input');
  inputs.forEach(input => input.readOnly = true);
  try {
    const count = chosen.size;
    await api.register(person, [...chosen]);
    chosen.clear();
    form.reset();
    status(count === 1 ? 'Ton inscription au créneau est enregistrée.' : 'Tes inscriptions à ' + count + ' créneaux sont enregistrées.', 'success');
  } catch (error) {
    status(errorMessage(error), 'error');
  } finally {
    submitting = false;
    inputs.forEach(input => input.readOnly = false);
    syncSelection();
  }
});

$('login').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button');
  submit.disabled = true;
  try {
    await api.signIn(form.elements.email.value, form.elements.password.value);
    await revealSchedule();
    form.reset();
  } catch (error) {
    status(errorMessage(error), 'error');
  } finally {
    submit.disabled = false;
  }
});

$('logout').addEventListener('click', () => {
  api.signOut();
  location.reload();
});

async function revealSchedule() {
  await refreshWeeks();
  ready = true;
  $('login').hidden = true;
  $('schedule').hidden = false;
  $('registration').hidden = teacherPage;
  $('manage').hidden = !teacherPage;
  $('logout').hidden = api.demo;
  $('submit-area').hidden = teacherPage;
  status();
}

async function boot() {
  if (teacherPage) {
    $('hero-label').textContent = 'Lycée · Espace enseignant';
    $('hero-title').replaceChildren('Gérer le soutien', element('span', '.'));
    $('hero-description').textContent = 'Ouvre des semaines, ajuste les créneaux et retrouve tes listes d’appel.';
    $('mode-link').href = './';
    $('mode-link').textContent = 'Page élève ↗';
  }
  if (!api.configured && !api.demo) {
    $('notice').textContent = 'Les inscriptions ouvriront dès que le site sera configuré.';
    $('notice').hidden = false;
    return;
  }
  if (api.demo) {
    $('notice').textContent = 'Démo locale. Utilise des noms fictifs. Les inscriptions restent dans ce navigateur.';
    $('notice').hidden = false;
  }
  if (teacherPage && !api.demo) {
    $('login').hidden = false;
    return;
  }
  try {
    await revealSchedule();
  } catch (error) {
    status(errorMessage(error), 'error');
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && ready && !teacherPage && !submitting) {
    refreshWeeks(monday).catch(error => status(errorMessage(error), 'error'));
  }
});
void boot();
