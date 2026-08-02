-- US-20: a term cannot be identified or edited safely without these labels.
-- Remove the empty-string defaults as they would manufacture rows that the
-- constraints below correctly reject.
alter table public.school_fees
  alter column child drop default,
  alter column school drop default,
  alter column term drop default;

alter table public.school_fees
  drop constraint if exists school_fees_child_check;
alter table public.school_fees
  add constraint school_fees_child_check check (length(trim(child)) > 0);

alter table public.school_fees
  drop constraint if exists school_fees_school_check;
alter table public.school_fees
  add constraint school_fees_school_check check (length(trim(school)) > 0);

alter table public.school_fees
  drop constraint if exists school_fees_term_check;
alter table public.school_fees
  add constraint school_fees_term_check check (length(trim(term)) > 0);
