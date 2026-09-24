-- Apply before deploying the deduplicated /api/view endpoint.
-- Existing post_views totals are preserved as a historical baseline.
create table if not exists post_view_visitors (
  slug text not null,
  visitor_hash char(64) not null,
  viewed_on date not null,
  primary key (slug, visitor_hash)
);
