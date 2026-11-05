-- ============================================================
-- Deja ver, con el código limitado de Ganamos (no con el PIN de admin),
-- la lista de turnos cerrados — solo lo mínimo necesario para decidir a
-- qué turno le corresponde cada operación (fecha, horario, responsable).
-- NO expone billeteras, fichas, operaciones ni nada financiero del turno.
-- Correr en Supabase → SQL Editor → Run.
-- ============================================================

create or replace function ganamos_import_list_shifts_cerrados(input_token text)
returns table(id uuid, fecha date, hora_inicio time, hora_fin time, turno_label text, responsable text, created_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not (verify_admin_pin(input_token) or verify_ganamos_import_token(input_token)) then
    return;
  end if;

  return query
  select s.id, s.fecha, s.hora_inicio, s.hora_fin, s.turno_label, s.responsable, s.created_at
  from shifts s
  where s.status = 'cerrado' and s.archivado = false
  order by s.cerrado_at desc nulls last
  limit 30;
end;
$function$;
