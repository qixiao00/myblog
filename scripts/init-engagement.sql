create table if not exists post_views (
  slug text primary key,
  views bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists comments (
  id bigserial primary key,
  slug text not null,
  email text not null default '',
  nickname text not null,
  content text not null,
  created_at timestamptz not null default now(),
  status text not null default 'approved'
);

create index if not exists idx_comments_slug_created_at
on comments (slug, created_at desc);
