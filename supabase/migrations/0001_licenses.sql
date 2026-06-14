-- Licenses issued after a Mercado Pago payment/subscription, and per-machine activations.
-- Accessed only by Edge Functions using the service-role key, so RLS stays locked down.

create table if not exists licenses (
  id            uuid primary key default gen_random_uuid(),
  email         text not null,
  plan          text not null default 'lifetime',     -- 'lifetime' | 'subscription'
  status        text not null default 'active',        -- 'active' | 'canceled' | 'revoked' | 'expired'
  provider      text not null default 'mercadopago',
  provider_ref  text,                                  -- payment id / preapproval id
  activation_code text not null unique,                -- what the customer types into the app
  max_activations int not null default 1,              -- machines allowed per license
  expires_at    timestamptz,                           -- null = never (lifetime)
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_licenses_provider_ref on licenses(provider_ref);
create index if not exists idx_licenses_email on licenses(email);

create table if not exists activations (
  id          uuid primary key default gen_random_uuid(),
  license_id  uuid not null references licenses(id) on delete cascade,
  machine_id  text not null,
  created_at  timestamptz not null default now(),
  unique (license_id, machine_id)
);

alter table licenses   enable row level security;
alter table activations enable row level security;
-- No policies on purpose: only the service-role key (used by Edge Functions) may read/write.
