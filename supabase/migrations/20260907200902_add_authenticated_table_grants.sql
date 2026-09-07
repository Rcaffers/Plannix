-- Allow authenticated users to access Plannix tables.
-- Row Level Security policies still control which rows/actions
-- each authenticated user is actually allowed to access.

grant select, insert, update, delete
on all tables in schema public
to authenticated;
