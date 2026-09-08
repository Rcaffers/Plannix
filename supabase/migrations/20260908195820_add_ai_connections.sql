create table public.plannix_ai_connections (
  id uuid primary key default gen_random_uuid(),

  organisation_user_id uuid not null
    references public.plannix_organisation_users(id)
    on delete cascade,

  provider text not null default 'openai',

  vault_secret_id uuid not null,

  api_key_last_four text,

  preferred_model text,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint plannix_ai_connections_provider_check
    check (provider in ('openai')),

  constraint plannix_ai_connections_unique_user_provider
    unique (organisation_user_id, provider)
);

alter table public.plannix_ai_connections
enable row level security;

