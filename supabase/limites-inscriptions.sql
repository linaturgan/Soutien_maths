-- À exécuter après la mise à jour des créneaux et des messages.
begin;

create or replace function soutien.schedule(p_teacher boolean) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object('monday', w.monday, 'slots', coalesce((
      select jsonb_agg(
        (to_jsonb(s) - 'monday') ||
        case when p_teacher then jsonb_build_object('registration_count', counts.total)
        else jsonb_build_object('full', counts.total >= 20) end
        order by s.day, s.starts, s.ends, s.id
      )
      from soutien.slots s
      cross join lateral (
        select count(*) as total from soutien.registrations r where r.slot_id = s.id
      ) counts
      where s.monday = w.monday and (p_teacher or not s.archived)
    ), '[]'::jsonb)) order by w.monday
  ), '[]'::jsonb)
  from soutien.weeks w;
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
    -- Tous les envois verrouillent les créneaux dans le même ordre.
    select * into slot from soutien.slots where id = picked for update;
    if not found or slot.archived then
      raise exception 'Un des créneaux a été retiré. Vérifie tes choix puis réessaie.';
    end if;
    if exists (select 1 from soutien.registrations where slot_id = picked and person_key = identity_key) then
      continue;
    end if;
    if (slot.monday + slot.day + slot.starts - interval '1 hour') <= (clock_timestamp() at time zone 'Europe/Paris') then
      raise exception 'Les inscriptions à l’un des créneaux sont closes. Vérifie tes choix puis réessaie.';
    end if;
    if (select count(*) from soutien.registrations where slot_id = picked) >= 20 then
      raise exception 'L’un des créneaux est complet. Vérifie tes choix puis réessaie.';
    end if;
    insert into soutien.registrations(slot_id, family, given, classroom, person_key)
    values (slot.id, student[1], student[2], student[3], identity_key)
    on conflict (slot_id, person_key) do nothing;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;

select position('counts.total >= 20' in pg_get_functiondef('soutien.schedule(boolean)'::regprocedure)) > 0
   and position('interval ''1 hour''' in pg_get_functiondef('public.soutien_register(text,text,text,uuid[])'::regprocedure)) > 0
   as limites_activees;
