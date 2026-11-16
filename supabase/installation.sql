-- Exécuter une seule fois dans un nouveau projet Supabase.
-- Remplacer l’UUID ci-dessous par celui du compte enseignant avant exécution.
begin;
create schema soutien;
revoke all on schema soutien from public, anon, authenticated;

create table soutien.teacher (
  id uuid primary key references auth.users(id) on delete cascade
);
insert into soutien.teacher values ('00000000-0000-0000-0000-000000000000');

create table soutien.weeks (
  monday date primary key check (extract(isodow from monday) = 1)
);
create table soutien.slots (
  id uuid primary key default gen_random_uuid(),
  monday date not null references soutien.weeks on delete cascade,
  day integer not null check (day between 0 and 4),
  starts time not null,
  ends time not null check (ends > starts),
  room text not null check (char_length(btrim(room)) between 1 and 30),
  choice_group uuid,
  unique (monday, day, starts, ends, room)
);
create table soutien.registrations (
  slot_id uuid not null references soutien.slots on delete cascade,
  monday date not null,
  day integer not null,
  choice_key uuid not null,
  family text not null,
  given text not null,
  classroom text not null,
  person_key text not null,
  primary key (slot_id, person_key),
  unique (monday, day, choice_key, person_key)
);
alter table soutien.teacher enable row level security;
alter table soutien.weeks enable row level security;
alter table soutien.slots enable row level security;
alter table soutien.registrations enable row level security;

create function soutien.require_teacher() returns void
language plpgsql stable set search_path = ''
as $$
begin
  if not exists (select 1 from soutien.teacher where id = auth.uid()) then
    raise exception 'Accès réservé au compte enseignant.' using errcode = '42501';
  end if;
end;
$$;

create function soutien.create_week(p_monday date, p_standard boolean) returns void
language plpgsql set search_path = ''
as $$
declare options uuid := gen_random_uuid();
begin
  insert into soutien.weeks values (p_monday);
  if p_standard then
    insert into soutien.slots(monday, day, starts, ends, room, choice_group) values
      (p_monday, 0, '11:30', '14:00', '210', null),
      (p_monday, 1, '12:30', '13:30', '210', options),
      (p_monday, 1, '13:00', '14:00', '210', options),
      (p_monday, 2, '10:30', '14:00', '212', null),
      (p_monday, 3, '11:30', '14:00', '214', null),
      (p_monday, 4, '11:30', '14:00', '216', null);
  end if;
end;
$$;

create function public.soutien_schedule() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('monday', w.monday, 'slots', coalesce((
      select jsonb_agg(to_jsonb(s) - 'monday' order by s.day, s.starts, s.ends, s.id)
      from soutien.slots s where s.monday = w.monday
    ), '[]'::jsonb)) order by w.monday
  ), '[]'::jsonb)
  from soutien.weeks w;
$$;

create function public.soutien_register(p_family text, p_given text, p_classroom text, p_slots uuid[]) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  slot soutien.slots%rowtype;
  picked uuid;
  identity_key text;
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
  if p_slots is null or cardinality(p_slots) not between 1 and 50 then
    raise exception 'Sélectionne entre 1 et 50 créneaux.';
  end if;
  -- Une même identité peut réessayer la même séance sans créer de doublon.
  identity_key := jsonb_build_array(lower(p_family), lower(p_given), lower(p_classroom))::text;
  for picked in select distinct unnest(p_slots) order by 1 loop
    select * into slot from soutien.slots where id = picked for share;
    if not found or (slot.monday + slot.day + slot.ends) <= (statement_timestamp() at time zone 'Europe/Paris') then
      raise exception 'Un des créneaux est terminé ou a été retiré. Actualise la page et réessaie.';
    end if;
    begin
      insert into soutien.registrations(slot_id, monday, day, choice_key, family, given, classroom, person_key)
      values (slot.id, slot.monday, slot.day, coalesce(slot.choice_group, slot.id), p_family, p_given, p_classroom, identity_key)
      on conflict (slot_id, person_key) do nothing;
    exception when unique_violation then
      raise exception 'Une autre option du même créneau est déjà inscrite pour cet élève. Contacte ton enseignant pour la changer.';
    end;
  end loop;
end;
$$;

create function public.soutien_teacher() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from soutien.teacher where id = auth.uid());
$$;

create function public.soutien_roster(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform soutien.require_teacher();
  return coalesce((
    select jsonb_agg(jsonb_build_object('family', family, 'given', given, 'classroom', classroom) order by lower(family), lower(given), lower(classroom))
    from soutien.registrations where slot_id = p_id
  ), '[]'::jsonb);
end;
$$;

create function public.soutien_add_week(p_monday date, p_standard boolean) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform soutien.require_teacher();
  perform soutien.create_week(p_monday, p_standard);
exception when unique_violation then
  raise exception 'Cette semaine existe déjà.';
end;
$$;

create function public.soutien_delete_week(p_monday date) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform soutien.require_teacher();
  delete from soutien.weeks where monday = p_monday;
end;
$$;

create function public.soutien_save_slot(p_id uuid, p_monday date, p_day integer, p_starts time, p_ends time, p_room text) returns uuid
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
    if current_slot.choice_group is not null and current_slot.day <> p_day then
      raise exception 'Les deux options du mardi doivent rester le même jour.';
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

create function public.soutien_delete_slot(p_id uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform soutien.require_teacher();
  delete from soutien.slots where id = p_id;
end;
$$;

revoke all on function public.soutien_schedule(), public.soutien_register(text,text,text,uuid[]),
  public.soutien_teacher(), public.soutien_roster(uuid), public.soutien_add_week(date,boolean),
  public.soutien_delete_week(date), public.soutien_save_slot(uuid,date,integer,time,time,text),
  public.soutien_delete_slot(uuid) from public, anon, authenticated;
grant execute on function public.soutien_schedule(), public.soutien_register(text,text,text,uuid[]) to anon, authenticated;
grant execute on function public.soutien_teacher(), public.soutien_roster(uuid), public.soutien_add_week(date,boolean),
  public.soutien_delete_week(date), public.soutien_save_slot(uuid,date,integer,time,time,text),
  public.soutien_delete_slot(uuid) to authenticated;

select soutien.create_week(date_trunc('week', now() at time zone 'Europe/Paris')::date, true);
commit;
