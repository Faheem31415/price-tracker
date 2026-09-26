-- Product Price Tracker — initial schema

create table if not exists tracked_products (
  id bigserial primary key,
  store_product_id text not null,
  product_name text not null,
  option_label text not null,
  option_code text not null,
  product_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists scrape_attempts (
  id bigserial primary key,
  store_product_id text not null,
  product_name text not null,
  option_label text not null,
  scraped_at timestamptz not null default now(),
  price numeric,
  stock boolean,
  outcome text not null check (outcome in ('success', 'retried', 'failed'))
);

create index if not exists idx_scrape_attempts_product
  on scrape_attempts (store_product_id, scraped_at desc);

create index if not exists idx_scrape_attempts_scraped_at
  on scrape_attempts (scraped_at desc);
