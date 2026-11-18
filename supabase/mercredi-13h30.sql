-- Corrige le modèle hebdomadaire et les mercredis déjà créés.
begin;

create or replace function soutien.create_week(p_monday date, p_standard boolean) returns void
language plpgsql set search_path = ''
as $$
begin
  insert into soutien.weeks values (p_monday);
  if p_standard then
    insert into soutien.slots(monday, day, starts, ends, room)
    select p_monday, schedule.day, periods.starts, periods.ends, schedule.room
    from (values
      (0, '210', time '11:30', time '14:00'),
      (1, '210', time '12:30', time '14:00'),
      (2, '212', time '10:30', time '13:30'),
      (3, '214', time '11:30', time '14:00'),
      (4, '216', time '11:30', time '14:00')
    ) schedule(day, room, first_start, last_end)
    cross join (values
      (time '10:30', time '11:30'),
      (time '11:30', time '12:30'),
      (time '12:30', time '13:30'),
      (time '13:00', time '14:00')
    ) periods(starts, ends)
    where periods.starts >= schedule.first_start and periods.ends <= schedule.last_end;
  end if;
end;
$$;

-- Fermer d’abord les créneaux pour empêcher les inscriptions pendant la correction.
update soutien.slots
set archived = true
where day = 2 and starts = time '13:00' and ends = time '14:00'
  and not archived;

-- Les créneaux avec inscrits gardent leur liste d’appel côté enseignant.
delete from soutien.slots s
where s.day = 2 and s.starts = time '13:00' and s.ends = time '14:00'
  and not exists (select 1 from soutien.registrations r where r.slot_id = s.id);

commit;

select not exists (
  select 1 from soutien.slots
  where day = 2 and starts = time '13:00' and ends = time '14:00' and not archived
) as mercredis_corriges;
