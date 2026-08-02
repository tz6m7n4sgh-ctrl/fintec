-- A dated fee with blank labels is technically valid but unusable on the
-- calendar. Keep validation at the persistence boundary so every writer gets
-- the same rule; app/loans/actions.ts translates these names for people.
alter table public.school_fees
  add constraint school_fees_child_check check (length(trim(child)) > 0),
  add constraint school_fees_school_check check (length(trim(school)) > 0),
  add constraint school_fees_term_check check (length(trim(term)) > 0);
