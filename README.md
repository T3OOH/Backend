# T3 OOH — Backend

API REST e servidor WebSocket da **Plataforma T3 OOH**: painéis de mídia OOH, pedidos/orçamentos, CRM comercial, conteúdo institucional e autenticação.

## Stack

- **Node.js** + **Express 5** (TypeScript)
- **Prisma 7** com adapter `pg` → **PostgreSQL** (Supabase)
- **Supabase Storage** para imagens e documentos
- **Socket.IO** para o chat do CRM
- **JWT** (HS256, 1h) · **bcryptjs** · **Zod** · **Helmet** · **express-rate-limit**
- **Resend** (e-mail de recuperação de senha) · **Google reCAPTCHA v2** (login/cadastro)

## Requisitos

- Node.js 20+
- Banco PostgreSQL (recomendado: projeto Supabase) e um bucket no Supabase Storage

## Configuração

```bash
npm install
cp .env.example .env   # preencha as variáveis
npx prisma generate
npx prisma migrate deploy
npm run dev            # http://localhost:3333
```

### Variáveis de ambiente

| Variável | Obrigatória | Descrição |
| --- | --- | --- |
| `NODE_ENV` | não | `development` \| `test` \| `production` |
| `PORT` | não | Porta HTTP (padrão `3333`) |
| `FRONTEND_URL` | não | URL do frontend (CORS, links de e-mail) |
| `DATABASE_URL` | sim | String de conexão PostgreSQL (pooler) |
| `DIRECT_URL` | migrations | Conexão direta, usada pelo Prisma Migrate |
| `JWT_SECRET` | sim | Mínimo de 32 caracteres aleatórios |
| `SUPABASE_URL` | sim | URL do projeto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | sim | Service role key (**somente no backend**) |
| `SUPABASE_BUCKET` | não | Bucket de uploads (padrão `panels`) |
| `RESEND_API_KEY` | e-mail | Envio do e-mail de recuperação de senha |
| `RECAPTCHA_SECRET_KEY` | sim | Validação do reCAPTCHA no login e cadastro |

### Criar o primeiro administrador

```bash
ADMIN_NAME="Seu Nome" ADMIN_EMAIL="voce@empresa.com" ADMIN_PASSWORD="senha-com-12+caracteres" npm run admin:create
```

## Scripts

| Script | Descrição |
| --- | --- |
| `npm run dev` | Servidor em modo watch (`tsx`) |
| `npm run build` | Compila para `dist/` |
| `npm start` | Executa a build (`dist/src/server.js`) |
| `npm run prisma:generate` | Gera o Prisma Client |
| `npm run prisma:validate` | Valida o `schema.prisma` |
| `npm run admin:create` | Cria um usuário `ADMIN` |

## Estrutura

```
src/
├── app.ts              # Express: helmet, CORS, rate limit, rotas, handler de erros
├── server.ts           # HTTP + WebSocket + shutdown gracioso
├── websocket.ts        # Socket.IO (chat do CRM)
├── config/env.ts       # Validação das variáveis de ambiente (Zod)
├── controllers/        # Regras por recurso
├── routes/             # Definição das rotas
├── services/ repositories/  # Camadas de painel e usuário
├── middlewares/        # authMiddleware, requireRoles, upload (multer)
├── validators/         # Schemas Zod
├── database/           # Prisma e cliente Supabase
└── scripts/            # create-admin, seed
prisma/
├── schema.prisma
└── migrations/
```

## Endpoints

Autenticação via header `Authorization: Bearer <token>`.

| Recurso | Método e rota | Acesso |
| --- | --- | --- |
| Saúde | `GET /health` | público |
| Auth | `POST /auth/register` · `POST /auth/login` | público (reCAPTCHA) |
| | `POST /auth/forgot-password` · `POST /auth/reset-password` | público |
| Painéis | `GET /panels` · `GET /panels/markers` · `GET /panels/:id` | público |
| | `POST /panels` · `PUT /panels/:id` · `DELETE /panels/:id` | ADMIN, MANAGER |
| Upload | `POST /upload?folderId=<pasta>` (multipart `file`) | autenticado |
| Contato | `POST /contacts` | público |
| Banners | `GET /banners` | público |
| | `GET /banners/all` · `POST /banners` · `DELETE /banners/:id` | autenticado |
| Portfólio Solution | `GET /solution/portfolio` · `POST` · `DELETE /:id` | público / gestão |
| Institucional | `GET /institutional` · `PUT /institutional` | público / autenticado |
| Perfil | `GET /profile` · `PUT /profile` · `GET /profile/orders` | autenticado |
| Usuários | `GET /users` · `PATCH /users/:id/role` | gestão |
| Pedidos | `GET /orders` · `POST /orders` · `PATCH /orders/:id` | gestão |
| CRM | `POST /crm/deals/checkout` | público (checkout do mapa) |
| | `GET /crm/metrics` · `/crm/clients` (CRUD) · `/crm/deals` (CRUD, `stage`, `status`, `claim`, `global`, `messages`) | equipe |
| Chat | `GET /chat/contacts` · `GET /chat/:clientId/messages` | equipe |
| Agenda | `GET /agenda` · `POST /agenda` · `PATCH /agenda/:id/toggle` | equipe |
| Cupons | `GET /coupons` · `POST /coupons` · `DELETE /coupons/:id` | equipe |

### WebSocket (Socket.IO)

| Evento | Direção | Payload |
| --- | --- | --- |
| `join_chat` / `leave_chat` | cliente → servidor | `chatId` (id do negócio) |
| `send_message` | cliente → servidor | `{ chatId, text?, isInternal?, mediaUrl?, mediaType? }` |
| `receive_message` | servidor → sala | mensagem salva |
| `update_sidebar` | servidor → todos | última mensagem |

## Modelo de dados (resumo)

`User` · `Company` · `Panel` · `Category` · `Order`/`OrderItem` · `CrmClient` · `CrmDeal`/`CrmDealItem` · `CrmMessage` · `CrmActivity` · `CrmNote` · `CrmCoupon` · `AgendaTask` · `Banner` · `SolutionPortfolio` · `Institutional` · `Contact` · `SystemSetting` · `AnalyticsEvent`.

Perfis (`Role`): `ADMIN`, `MANAGER`, `COMERCIAL`, `USER`, `COMPANY`.

## Deploy

1. `npm ci && npx prisma generate && npm run build`
2. `npx prisma migrate deploy`
3. `npm start` com as variáveis de ambiente de produção (`NODE_ENV=production`, `FRONTEND_URL` com o domínio real).
