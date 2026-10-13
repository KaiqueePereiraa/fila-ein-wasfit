-- Fila de espera do stand WasFit (EIN 2026)
create table if not exists public.fila (
  id            uuid primary key default gen_random_uuid(),
  nome          text not null,
  telefone      text not null,          -- só dígitos, com 55
  cargo         text,
  email         text,
  escola        text,
  instagram     text,
  status        text not null default 'aguardando'
                check (status in ('aguardando','chamado','atendendo','atendido','desistiu')),
  pulos         int  not null default 0,
  avisado_proximo boolean not null default false, -- já recebeu o "prepare-se"
  entrou_em     timestamptz not null default now(),  -- primeira entrada (tempo total de espera)
  fila_desde    timestamptz not null default now(),  -- ordem na fila (muda quando é pulado)
  chamado_em    timestamptz,
  chegou_em     timestamptz,
  finalizado_em timestamptz,
  atendente     text,
  dia           date not null default ((now() at time zone 'America/Sao_Paulo')::date)
);

create index if not exists fila_status_ordem on public.fila (status, fila_desde);
create index if not exists fila_telefone on public.fila (telefone);

-- Sem policies: ninguém acessa direto pelo navegador.
-- Todo acesso passa pela edge function "fila" (service role).
alter table public.fila enable row level security;

-- Acesso só para a role interna da edge function (o projeto não expõe tabelas automaticamente).
grant select, insert, update, delete on table public.fila to service_role;

-- Contador de tentativas (limite de cadastros e de PIN errado)
create table if not exists public.tentativas (
  id        bigint generated always as identity primary key,
  chave     text not null,
  criado_em timestamptz not null default now()
);
create index if not exists tentativas_chave_data on public.tentativas (chave, criado_em);
alter table public.tentativas enable row level security;
grant select, insert, delete on table public.tentativas to service_role;
