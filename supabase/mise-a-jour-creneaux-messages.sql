-- À exécuter une seule fois après installation.sql dans le projet Soutien maths.
begin;

alter table soutien.slots add column archived boolean not null default false;

-- Les séances encore ouvertes sont découpées selon leurs horaires et salles.
-- Une ancienne plage déjà réservée est conservée pour l'appel côté enseignant.
lock table soutien.slots, soutien.registrations in share row exclusive mode;
create temporary table soutien_split on commit drop as
select id, monday, day, starts, ends, room
from soutien.slots
where ends = time '14:00' and starts in (time '10:30', time '11:30', time '12:30')
  and (monday + day + ends) > (statement_timestamp() at time zone 'Europe/Paris');

update soutien.slots s set archived = true
from pg_temp.soutien_split old
where s.id = old.id and exists (select 1 from soutien.registrations r where r.slot_id = s.id);

delete from soutien.slots s using pg_temp.soutien_split old
where s.id = old.id and not s.archived;

insert into soutien.slots(monday, day, starts, ends, room)
select distinct old.monday, old.day, new.starts, new.ends, old.room
from pg_temp.soutien_split old
cross join (values (time '10:30', time '11:30'), (time '11:30', time '12:30'),
                   (time '12:30', time '13:30'), (time '13:00', time '14:00')) new(starts, ends)
where new.starts >= old.starts and new.ends <= old.ends
on conflict (monday, day, starts, ends, room) do nothing;

alter table soutien.slots drop column choice_group;
alter table soutien.registrations drop column choice_key, drop column monday, drop column day;

create or replace function soutien.create_week(p_monday date, p_standard boolean) returns void
language plpgsql set search_path = ''
as $$
begin
  insert into soutien.weeks values (p_monday);
  if p_standard then
    insert into soutien.slots(monday, day, starts, ends, room)
    select p_monday, schedule.day, periods.starts, periods.ends, schedule.room
    from (values (0, '210', time '11:30'), (1, '210', time '12:30'),
                 (2, '212', time '10:30'), (3, '214', time '11:30'), (4, '216', time '11:30'))
      schedule(day, room, first_start)
    cross join (values (time '10:30', time '11:30'), (time '11:30', time '12:30'),
                       (time '12:30', time '13:30'), (time '13:00', time '14:00')) periods(starts, ends)
    where periods.starts >= schedule.first_start;
  end if;
end;
$$;

create function soutien.schedule(p_teacher boolean) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('monday', w.monday, 'slots', coalesce((
      select jsonb_agg(
        (to_jsonb(s) - 'monday') ||
        case when p_teacher then jsonb_build_object('registration_count',
          (select count(*) from soutien.registrations r where r.slot_id = s.id))
        else '{}'::jsonb end
        order by s.day, s.starts, s.ends, s.id
      )
      from soutien.slots s where s.monday = w.monday and (p_teacher or not s.archived)
    ), '[]'::jsonb)) order by w.monday
  ), '[]'::jsonb)
  from soutien.weeks w;
$$;

create or replace function public.soutien_schedule() returns jsonb
language sql stable security definer set search_path = ''
as $$ select soutien.schedule(false); $$;

create function public.soutien_teacher_schedule() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform soutien.require_teacher();
  return soutien.schedule(true);
end;
$$;

create function soutien.student_identity(p_family text, p_given text, p_classroom text) returns text[]
language plpgsql immutable set search_path = ''
as $$
begin
  p_family := normalize(btrim(regexp_replace(p_family, '[[:space:]]+', ' ', 'g')));
  p_given := normalize(btrim(regexp_replace(p_given, '[[:space:]]+', ' ', 'g')));
  p_classroom := normalize(btrim(regexp_replace(p_classroom, '[[:space:]]+', ' ', 'g')));
  if p_family is null or p_given is null or p_classroom is null
    or char_length(p_family) not between 1 and 60
    or char_length(p_given) not between 1 and 60
    or char_length(p_classroom) not between 1 and 25 then
    raise exception 'Renseigne un nom, un prénom et une classe valides.';
  end if;
  return array[p_family, p_given, p_classroom];
end;
$$;

create or replace function public.soutien_register(p_family text, p_given text, p_classroom text, p_slots uuid[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  slot soutien.slots%rowtype;
  picked uuid;
  student text[] := soutien.student_identity(p_family, p_given, p_classroom);
  identity_key text := jsonb_build_array(lower(student[1]), lower(student[2]), lower(student[3]))::text;
begin
  if p_slots is null or cardinality(p_slots) not between 1 and 50 then
    raise exception 'Sélectionne entre 1 et 50 créneaux.';
  end if;
  for picked in select distinct unnest(p_slots) order by 1 loop
    select * into slot from soutien.slots where id = picked for share;
    if not found or slot.archived or (slot.monday + slot.day + slot.ends) <= (statement_timestamp() at time zone 'Europe/Paris') then
      raise exception 'Un des créneaux est terminé ou a été retiré. Actualise la page et réessaie.';
    end if;
    insert into soutien.registrations(slot_id, family, given, classroom, person_key)
    values (slot.id, student[1], student[2], student[3], identity_key)
    on conflict (slot_id, person_key) do nothing;
  end loop;
end;
$$;

create or replace function public.soutien_save_slot(p_id uuid, p_monday date, p_day integer, p_starts time, p_ends time, p_room text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare current_slot soutien.slots%rowtype;
begin
  perform soutien.require_teacher();
  if p_day is null or p_day not between 0 and 4 or p_starts is null or p_ends is null or p_starts >= p_ends
     or p_room is null or char_length(btrim(p_room)) not between 1 and 30 then
    raise exception 'Vérifie le jour, les horaires et la salle.';
  end if;
  if p_id is null then
    insert into soutien.slots(monday, day, starts, ends, room)
    values (p_monday, p_day, p_starts, p_ends, btrim(p_room)) returning id into p_id;
  else
    select * into current_slot from soutien.slots where id = p_id for update;
    if not found then
      raise exception 'Ce créneau a été supprimé.';
    end if;
    if current_slot.archived then
      raise exception 'Cet ancien créneau est conservé pour sa liste d’appel.';
    end if;
    if current_slot.day <> p_day and exists (select 1 from soutien.registrations where slot_id = p_id) then
      raise exception 'Ce créneau a déjà des inscrits. Son jour ne peut plus être modifié.';
    end if;
    update soutien.slots set day = p_day, starts = p_starts, ends = p_ends, room = btrim(p_room) where id = p_id;
  end if;
  return p_id;
exception when unique_violation then
  raise exception 'Un créneau identique existe déjà.';
end;
$$;

create function public.soutien_cancel_registration(p_id uuid, p_family text, p_given text, p_classroom text)
returns void language plpgsql security definer set search_path = ''
as $$
declare student text[];
begin
  perform soutien.require_teacher();
  student := soutien.student_identity(p_family, p_given, p_classroom);
  delete from soutien.registrations where slot_id = p_id
    and person_key = jsonb_build_array(lower(student[1]), lower(student[2]), lower(student[3]))::text;
end;
$$;

create table soutien.messages (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  family text not null,
  given text not null,
  classroom text not null,
  subject text not null check (subject in ('cancellation', 'preparation', 'other')),
  body text not null check (char_length(body) between 1 and 1000)
);
alter table soutien.messages enable row level security;

create function public.soutien_send_message(p_family text, p_given text, p_classroom text, p_subject text, p_body text)
returns void language plpgsql security definer set search_path = ''
as $$
declare student text[] := soutien.student_identity(p_family, p_given, p_classroom);
begin
  p_body := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  if p_body is null or char_length(p_body) not between 1 and 1000 then
    raise exception 'Écris un message de 1 à 1 000 caractères.';
  end if;
  if p_subject is null or p_subject not in ('cancellation', 'preparation', 'other') then
    raise exception 'Choisis le sujet de ton message.';
  end if;
  insert into soutien.messages(family, given, classroom, subject, body)
  values (student[1], student[2], student[3], p_subject, p_body);
end;
$$;

create function public.soutien_inbox() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform soutien.require_teacher();
  return coalesce((select jsonb_agg(to_jsonb(m) order by m.received_at desc, m.id) from soutien.messages m), '[]'::jsonb);
end;
$$;

create function public.soutien_delete_message(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform soutien.require_teacher();
  delete from soutien.messages where id = p_id;
end;
$$;

revoke all on function public.soutien_teacher_schedule(), public.soutien_send_message(text,text,text,text,text),
  public.soutien_inbox(), public.soutien_delete_message(uuid),
  public.soutien_cancel_registration(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.soutien_send_message(text,text,text,text,text) to anon, authenticated;
grant execute on function public.soutien_teacher_schedule(), public.soutien_inbox(),
  public.soutien_delete_message(uuid), public.soutien_cancel_registration(uuid,text,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
