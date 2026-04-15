alter table comments add column if not exists parent_id bigint references comments(id) on delete cascade;
alter table comments add column if not exists likes integer;
alter table comments add column if not exists ip_region text;
alter table comments add column if not exists client_info text;

update comments set likes = 0 where likes is null;
update comments set ip_region = '' where ip_region is null;
update comments set client_info = '' where client_info is null;

alter table comments alter column likes set default 0;
alter table comments alter column ip_region set default '';
alter table comments alter column client_info set default '';

alter table comments alter column likes set not null;
alter table comments alter column ip_region set not null;
alter table comments alter column client_info set not null;
