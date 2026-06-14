# Licenciamento online (Etapa 1 — backend)

Backend de licença usando **Supabase** (banco + Edge Functions) e **Mercado Pago** (pagamento).
O servidor assina "passes" de licença com a **chave privada Ed25519**; o app valida com a
**chave pública já embutida** (`src-tauri/src/license.rs`) e guarda o passe para uso offline.

> Status: scaffold. Ainda **não foi testado/publicado** — siga os passos abaixo para subir.

## Componentes

- `migrations/0001_licenses.sql` — tabelas `licenses` e `activations`.
- `functions/activate` — app envia `{ activationCode, machineId }` → devolve `{ pass }`.
- `functions/validate` — revalidação periódica (assinatura ativa? revogada?).
- `functions/mp-webhook` — Mercado Pago avisa pagamento aprovado → cria/atualiza licença.
- `functions/_shared/util.ts` — assinatura Ed25519, código de ativação, cliente do banco.

## Passo a passo

### 1. Criar o projeto Supabase
1. Crie uma conta em https://supabase.com e um projeto (plano free serve).
2. Instale a CLI: https://supabase.com/docs/guides/cli
3. Na pasta do repo: `supabase login` e depois `supabase link --project-ref <SEU_REF>`.

### 2. Banco
```
supabase db push          # aplica migrations/0001_licenses.sql
```

### 3. Segredos
1. Copie `.env.example` para `supabase/.env` e preencha:
   - `LICENSE_SIGNING_SEED` — **a mesma seed** de `tools/keygen/secret.key` (já preenchida no exemplo).
   - `MP_ACCESS_TOKEN` — Access Token de produção do Mercado Pago.
2. Envie:
```
supabase secrets set --env-file supabase/.env
```

### 4. Publicar as funções
```
supabase functions deploy activate
supabase functions deploy validate
supabase functions deploy mp-webhook
```
As URLs ficam assim: `https://<REF>.supabase.co/functions/v1/activate` (idem validate, mp-webhook).

### 5. Mercado Pago
1. Conta em https://www.mercadopago.com.br/developers — crie uma aplicação e pegue o **Access Token** (passo 3).
2. Crie o produto/preço:
   - **Avulso (lifetime):** use Checkout Pro / link de pagamento (aceita **Pix, boleto, cartão**).
   - **Assinatura:** crie um plano de assinatura (preapproval) — recorrência automática é **cartão**.
3. Em **Webhooks/Notificações**, aponte para a URL `…/functions/v1/mp-webhook` e selecione os
   eventos de *payments* e *subscriptions*.
4. (Recomendado) configure a assinatura do webhook e preencha `MP_WEBHOOK_SECRET`.

### 6. Testar
- Faça um pagamento de teste → o webhook cria uma linha em `licenses` com um `activation_code`
  (veja em **Table editor** do Supabase, ou nos logs da função).
- Teste a ativação:
```
curl -X POST https://<REF>.supabase.co/functions/v1/activate \
  -H "Content-Type: application/json" \
  -d '{"activationCode":"ETQ-XXXX-XXXX-XXXX","machineId":"A319-722A-33EE-CAD3"}'
```
Deve retornar `{ "pass": "<base64url>.<assinatura>" }`.

## Entrega do código ao cliente (escolha depois)
- **Página de sucesso** do Mercado Pago mostrando o `activation_code` (sem e-mail), ou
- **E-mail automático** (ex.: Resend) no webhook. Marcado como TODO em `mp-webhook`.

## Próximas etapas
- **Etapa 2 (app):** tela de ativação online que chama `activate`, guarda o passe, revalida
  periodicamente via `validate` e funciona offline por alguns dias. O Rust passará a aceitar o
  novo formato de passe (com expiração), além do trial de 2 dias atual.
- **Etapa 4 (admin):** ver/revogar ativações pelo painel do Supabase.

## Segurança
- A **seed privada** vive só nos segredos do Supabase e em `tools/keygen/secret.key` (no `.gitignore`).
  Nunca a coloque no app nem em repositório público.
- As tabelas têm RLS ligado sem políticas: só as funções (service-role) acessam.
