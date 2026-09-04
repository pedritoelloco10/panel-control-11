-- ============================================================
-- CRM de Bases — Parte 6d: arreglar admin_import_contacts
-- Correr en Supabase → SQL Editor → Run.
--
-- Bug real encontrado en vivo: la función de la Parte 3 arma la CTE
-- `candidatos` en una instrucción SQL (el `with ... select ... into
-- v_insertados from hechos;`) y después trata de volver a usarla en una
-- SEGUNDA instrucción separada, para contar los duplicados. En Postgres
-- una CTE solo existe dentro de la instrucción donde se define — la
-- segunda instrucción tira "relation candidatos does not exist".
--
-- Nunca se había disparado hasta ahora porque, aparentemente, era la
-- primera vez que se probaba una importación de punta a punta con
-- números que no eran duplicados de nada (con puros duplicados nunca se
-- llega a insertar nada tampoco, pero el error pasa igual en el conteo
-- de duplicados — lo que pasa es que antes nadie había mirado el error
-- real, porque el cliente lo escondía; eso ya se arregló del lado del
-- código).
--
-- Arreglo: todo en una sola instrucción, con `candidatos`, `a_insertar`
-- y ahora también `a_duplicados` como CTEs del mismo `with`, y un único
-- `select ... into v_insertados, v_duplicados` al final. Mismo resultado
-- que se buscaba, sin cruzar el límite de una instrucción.
-- ============================================================

create or replace function admin_import_contacts(input_admin_pin text, target_base uuid, rows jsonb)
returns table(insertados int, duplicados int)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_insertados int := 0; v_duplicados int := 0;
begin
  if verify_admin_pin(input_admin_pin) is not true then
    return query select 0, 0;
    return;
  end if;

  with candidatos as (
    select
      r->>'nombre' as nombre,
      coalesce(r->>'numero', '') as numero
    from jsonb_array_elements(rows) r
    where coalesce(r->>'nombre', '') <> ''
  ),
  a_insertar as (
    select c.nombre, c.numero
    from candidatos c
    where c.numero = '' or not exists (
      select 1 from contacts existing where existing.numero = c.numero and existing.numero <> ''
    )
  ),
  a_duplicados as (
    select c.nombre, c.numero
    from candidatos c
    where c.numero <> '' and exists (
      select 1 from contacts existing where existing.numero = c.numero and existing.numero <> ''
    )
  ),
  hechos as (
    insert into contacts (base_id, nombre, numero, agregado_por)
    select target_base, nombre, numero, 'admin' from a_insertar
    returning id
  )
  select (select count(*) from hechos), (select count(*) from a_duplicados)
  into v_insertados, v_duplicados;

  return query select v_insertados, v_duplicados;
end;
$function$;
