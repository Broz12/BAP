-- MLBB Pro Top-Up Database Schema
-- Apply in Supabase SQL editor.

create extension if not exists pgcrypto;

-- -------------------------------------------
-- Core tables
-- -------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,
  role text not null default 'user' check (role in ('user', 'admin')),
  referral_code text not null unique,
  referred_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  diamond_amount integer not null check (diamond_amount > 0),
  base_price_usd numeric(12,2) not null check (base_price_usd > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  player_id text not null,
  server_id text not null,
  product_id uuid not null references public.products(id),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null check (currency in ('USD', 'INR', 'PHP', 'IDR', 'MYR')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'paid', 'failed')),
  order_status text not null default 'pending' check (order_status in ('pending', 'processing', 'completed', 'cancelled')),
  stripe_session_id text unique,
  invoice_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.wallets (
  user_id uuid primary key references public.users(id) on delete cascade,
  balance numeric(14,2) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('deposit', 'payment', 'referral', 'refund')),
  amount numeric(14,2) not null,
  amount_usd numeric(14,2) not null,
  currency text not null default 'USD' check (currency in ('USD', 'INR', 'PHP', 'IDR', 'MYR')),
  stripe_session_id text unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.users(id) on delete cascade,
  referred_user_id uuid not null references public.users(id) on delete cascade,
  order_id uuid unique references public.orders(id) on delete cascade,
  commission_amount numeric(12,2) not null,
  commission_amount_usd numeric(12,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  admin_note text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.exchange_rates (
  currency_code text primary key check (currency_code in ('USD', 'INR', 'PHP', 'IDR', 'MYR')),
  rate_to_usd numeric(20,10) not null check (rate_to_usd > 0),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_user_id_created_at on public.orders(user_id, created_at desc);
create index if not exists idx_orders_status on public.orders(order_status, payment_status);
create index if not exists idx_wallet_transactions_user_id_created_at on public.wallet_transactions(user_id, created_at desc);
create index if not exists idx_referrals_referrer on public.referrals(referrer_id, created_at desc);

insert into public.exchange_rates (currency_code, rate_to_usd)
values
  ('USD', 1),
  ('INR', 0.012),
  ('PHP', 0.018),
  ('IDR', 0.000064),
  ('MYR', 0.22)
on conflict (currency_code) do nothing;

-- -------------------------------------------
-- Utility helpers
-- -------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_wallets_updated_at on public.wallets;
create trigger trg_wallets_updated_at
before update on public.wallets
for each row execute function public.set_updated_at();

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  );
$$;

create or replace function public.generate_referral_code()
returns text
language plpgsql
as $$
declare
  generated text;
begin
  loop
    generated := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
    exit when not exists(select 1 from public.users where referral_code = generated);
  end loop;
  return generated;
end;
$$;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, role, referral_code)
  values (
    new.id,
    new.email,
    'user',
    public.generate_referral_code()
  )
  on conflict (id) do update
  set email = excluded.email;

  insert into public.wallets (user_id, balance)
  values (new.id, 0)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.set_user_referrer(input_referral_code text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  referrer_id uuid;
begin
  if current_user_id is null then
    raise exception 'Unauthorized';
  end if;

  if input_referral_code is null or length(trim(input_referral_code)) = 0 then
    return;
  end if;

  select id into referrer_id
  from public.users
  where referral_code = upper(trim(input_referral_code));

  if referrer_id is null or referrer_id = current_user_id then
    return;
  end if;

  update public.users
  set referred_by = referrer_id
  where id = current_user_id
    and referred_by is null;
end;
$$;

create or replace function public.credit_wallet_deposit(
  input_user_id uuid,
  input_amount numeric,
  input_currency text,
  input_stripe_session_id text
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  rate numeric;
  usd_amount numeric;
  resulting_balance numeric;
begin
  if input_amount <= 0 then
    raise exception 'Invalid deposit amount';
  end if;

  if exists(
    select 1 from public.wallet_transactions
    where stripe_session_id = input_stripe_session_id
  ) then
    select balance into resulting_balance
    from public.wallets where user_id = input_user_id;
    return coalesce(resulting_balance, 0);
  end if;

  select rate_to_usd into rate
  from public.exchange_rates
  where currency_code = input_currency;

  if rate is null then
    raise exception 'Unsupported currency: %', input_currency;
  end if;

  usd_amount := round(input_amount * rate, 2);

  insert into public.wallets (user_id, balance)
  values (input_user_id, 0)
  on conflict (user_id) do nothing;

  update public.wallets
  set balance = balance + usd_amount
  where user_id = input_user_id
  returning balance into resulting_balance;

  insert into public.wallet_transactions (
    user_id,
    type,
    amount,
    amount_usd,
    currency,
    stripe_session_id,
    metadata
  ) values (
    input_user_id,
    'deposit',
    round(input_amount, 2),
    usd_amount,
    input_currency,
    input_stripe_session_id,
    jsonb_build_object('source', 'stripe')
  );

  return resulting_balance;
end;
$$;

create or replace function public.apply_referral_commission(
  input_paid_user_id uuid,
  input_order_id uuid,
  input_order_amount_usd numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  referrer uuid;
  commission numeric;
begin
  if exists(select 1 from public.referrals where order_id = input_order_id) then
    return;
  end if;

  select referred_by into referrer
  from public.users
  where id = input_paid_user_id;

  if referrer is null then
    return;
  end if;

  commission := round(input_order_amount_usd * 0.05, 2);
  if commission <= 0 then
    return;
  end if;

  insert into public.referrals (
    referrer_id,
    referred_user_id,
    order_id,
    commission_amount,
    commission_amount_usd
  ) values (
    referrer,
    input_paid_user_id,
    input_order_id,
    commission,
    commission
  );

  insert into public.wallets (user_id, balance)
  values (referrer, 0)
  on conflict (user_id) do nothing;

  update public.wallets
  set balance = balance + commission
  where user_id = referrer;

  insert into public.wallet_transactions (
    user_id,
    type,
    amount,
    amount_usd,
    currency,
    metadata
  ) values (
    referrer,
    'referral',
    commission,
    commission,
    'USD',
    jsonb_build_object('source_user_id', input_paid_user_id, 'order_id', input_order_id)
  );
end;
$$;

create or replace function public.process_paid_order(
  input_order_id uuid,
  input_stripe_session_id text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order public.orders;
  rate numeric;
  usd_amount numeric;
begin
  select * into target_order
  from public.orders
  where id = input_order_id
  for update;

  if target_order.id is null then
    raise exception 'Order not found';
  end if;

  if target_order.payment_status = 'paid' then
    return target_order;
  end if;

  update public.orders
  set payment_status = 'paid',
      order_status = case when order_status = 'cancelled' then 'pending' else order_status end,
      stripe_session_id = coalesce(input_stripe_session_id, stripe_session_id)
  where id = input_order_id
  returning * into target_order;

  select rate_to_usd into rate
  from public.exchange_rates
  where currency_code = target_order.currency;

  if rate is null then
    raise exception 'Exchange rate missing for %', target_order.currency;
  end if;

  usd_amount := round(target_order.amount * rate, 2);

  perform public.apply_referral_commission(target_order.user_id, target_order.id, usd_amount);

  return target_order;
end;
$$;

create or replace function public.create_wallet_paid_order(
  input_product_id uuid,
  input_player_id text,
  input_server_id text,
  input_currency text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_product public.products;
  wallet_row public.wallets;
  rate numeric;
  amount_local numeric;
  created_order public.orders;
begin
  if current_user_id is null then
    raise exception 'Unauthorized';
  end if;

  if input_player_id !~ '^[0-9]{4,20}$' then
    raise exception 'Invalid player ID';
  end if;

  if input_server_id !~ '^[0-9]{2,10}$' then
    raise exception 'Invalid server ID';
  end if;

  select * into target_product
  from public.products
  where id = input_product_id and active = true
  for update;

  if target_product.id is null then
    raise exception 'Product not available';
  end if;

  select * into wallet_row
  from public.wallets
  where user_id = current_user_id
  for update;

  if wallet_row.user_id is null then
    insert into public.wallets (user_id, balance)
    values (current_user_id, 0);

    select * into wallet_row
    from public.wallets
    where user_id = current_user_id
    for update;
  end if;

  if wallet_row.balance < target_product.base_price_usd then
    raise exception 'Insufficient wallet balance';
  end if;

  select rate_to_usd into rate
  from public.exchange_rates
  where currency_code = input_currency;

  if rate is null then
    raise exception 'Unsupported currency';
  end if;

  amount_local := round(target_product.base_price_usd / rate, 2);

  update public.wallets
  set balance = balance - target_product.base_price_usd
  where user_id = current_user_id;

  insert into public.wallet_transactions (
    user_id,
    type,
    amount,
    amount_usd,
    currency,
    metadata
  ) values (
    current_user_id,
    'payment',
    -amount_local,
    -target_product.base_price_usd,
    input_currency,
    jsonb_build_object('payment_method', 'wallet', 'product_id', input_product_id)
  );

  insert into public.orders (
    user_id,
    player_id,
    server_id,
    product_id,
    amount,
    currency,
    payment_status,
    order_status
  ) values (
    current_user_id,
    input_player_id,
    input_server_id,
    input_product_id,
    amount_local,
    input_currency,
    'paid',
    'pending'
  )
  returning * into created_order;

  perform public.apply_referral_commission(current_user_id, created_order.id, target_product.base_price_usd);

  return created_order;
end;
$$;

-- -------------------------------------------
-- Row Level Security
-- -------------------------------------------
alter table public.users enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.wallets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.referrals enable row level security;
alter table public.order_notes enable row level security;
alter table public.exchange_rates enable row level security;

-- users
create policy if not exists users_select_own on public.users
for select using (auth.uid() = id or public.is_admin());

create policy if not exists users_update_own on public.users
for update using (auth.uid() = id or public.is_admin())
with check (auth.uid() = id or public.is_admin());

-- products
create policy if not exists products_public_read on public.products
for select using (active = true or public.is_admin());

create policy if not exists products_admin_manage on public.products
for all using (public.is_admin()) with check (public.is_admin());

-- orders
create policy if not exists orders_select_own on public.orders
for select using (auth.uid() = user_id or public.is_admin());

create policy if not exists orders_insert_own on public.orders
for insert with check (auth.uid() = user_id or public.is_admin());

create policy if not exists orders_admin_update on public.orders
for update using (public.is_admin()) with check (public.is_admin());

-- wallets
create policy if not exists wallets_select_own on public.wallets
for select using (auth.uid() = user_id or public.is_admin());

create policy if not exists wallets_admin_manage on public.wallets
for all using (public.is_admin()) with check (public.is_admin());

-- wallet_transactions
create policy if not exists wallet_tx_select_own on public.wallet_transactions
for select using (auth.uid() = user_id or public.is_admin());

create policy if not exists wallet_tx_admin_manage on public.wallet_transactions
for all using (public.is_admin()) with check (public.is_admin());

-- referrals
create policy if not exists referrals_select_own on public.referrals
for select using (auth.uid() = referrer_id or auth.uid() = referred_user_id or public.is_admin());

create policy if not exists referrals_admin_manage on public.referrals
for all using (public.is_admin()) with check (public.is_admin());

-- order notes
create policy if not exists order_notes_select_for_owner on public.order_notes
for select using (
  public.is_admin() or
  exists(
    select 1 from public.orders o
    where o.id = order_id and o.user_id = auth.uid()
  )
);

create policy if not exists order_notes_admin_manage on public.order_notes
for all using (public.is_admin()) with check (public.is_admin());

-- exchange rates
create policy if not exists exchange_rates_read_all on public.exchange_rates
for select using (true);

create policy if not exists exchange_rates_admin_manage on public.exchange_rates
for all using (public.is_admin()) with check (public.is_admin());

-- -------------------------------------------
-- Storage bucket for invoices
-- -------------------------------------------
insert into storage.buckets (id, name, public)
values ('invoices', 'invoices', false)
on conflict (id) do nothing;

create policy if not exists invoice_read_own_or_admin on storage.objects
for select
using (
  bucket_id = 'invoices'
  and (
    public.is_admin()
    or (storage.foldername(name))[1] = auth.uid()::text
  )
);

-- Service role uploads invoices and bypasses RLS.

-- -------------------------------------------
-- Minimal seed data
-- -------------------------------------------
insert into public.products (name, diamond_amount, base_price_usd, active)
values
  ('Weekly Pass', 220, 2.99, true),
  ('Diamond Pack S', 275, 4.99, true),
  ('Diamond Pack M', 565, 9.49, true),
  ('Diamond Pack L', 1159, 18.99, true),
  ('Diamond Pack XL', 2398, 38.49, true)
on conflict do nothing;
