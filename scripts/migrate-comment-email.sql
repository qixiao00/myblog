alter table comments add column if not exists email text;

update comments
set email = ''
where email is null;

alter table comments
alter column email set default '';

alter table comments
alter column email set not null;
