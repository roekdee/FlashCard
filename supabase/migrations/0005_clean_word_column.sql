-- ============================================================
-- The spreadsheet kept the part of speech inside the `word` cell as well as in
-- its own column, so cards rendered as "Our det." and "fifteen number".
--
-- Strip trailing grammar tokens and homograph digits ("lie1", "second1"), while
-- leaving genuine multi-word entries ("ice cream", "according to") and the
-- disambiguating brackets ("bank (money)") intact.
-- ============================================================
create or replace function public.clean_headword(p_word text)
returns text
language plpgsql
immutable
as $fn$
declare
  v text := regexp_replace(trim(p_word), '\s+', ' ', 'g');
  v_prev text;
  v_junk constant text :=
    '\s+(det\.pro|det\.number|ad|adv|adj|n|v|prep|pron|det|conj|exclam|number|modal|auxiliary|pro|nou|noun|art|aux)\.?$';
begin
  -- peel trailing grammar tokens, which sometimes stack ("her pro det.")
  loop
    v_prev := v;
    v := regexp_replace(v, v_junk, '', 'i');
    exit when v = v_prev or v = '';
  end loop;

  if v = '' then
    return trim(p_word);   -- the whole cell was a grammar token: leave it alone
  end if;

  -- homograph markers: "lie1" -> "lie", "last1 (final)" -> "last (final)"
  v := regexp_replace(v, '^([a-zA-Z]{2,})[12]\M', '\1');

  return trim(v);
end;
$fn$;

update public.words
set word = public.clean_headword(word)
where word <> public.clean_headword(word);
