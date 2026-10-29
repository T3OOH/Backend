# Segurança da conta: sessões, aparelhos e alertas

Este documento descreve como funciona o login da plataforma T3 OOH:
- como o usuário continua conectado;
- como aparelhos novos são detectados e avisados por e-mail;
- o que acontece quando alguém clica em "Não fui eu";
- como operar e responder a incidentes.

Ele cobre o backend (este repositório) e o site (repositório `Frontend`).

> Resumo: o site guarda um **token de acesso curto (15 min)** e um **refresh token da sessão do aparelho**. O refresh token troca de valor a cada uso e fica salvo no banco só como hash. Quando a conta entra em um **aparelho que nunca foi usado**, o dono recebe um e-mail com o botão **"Não fui eu"**. Esse botão desconecta todos os aparelhos e leva direto à troca de senha.

---

## 1. Visão geral

```
Navegador                          Backend (Render)                        Banco (Supabase)
─────────                          ────────────────                        ────────────────
login (senha/Google) ───────────▶  valida credencial
  + deviceId + remember            startSession() ───────────────────────▶ user_sessions (hash do refresh)
                                   aparelho novo? ─▶ e-mail "Novo acesso"  security_events (LOGIN_SUCCESS, NEW_DEVICE)
◀── token (15 min) + refreshToken

requisição com Bearer token ────▶  authMiddleware: assinatura + sessão ativa (cache 30 s)

token perto de vencer ──────────▶  POST /auth/refresh → rotateSession()
◀── token novo + refreshToken novo  (segredo antigo vira previousHash)

"Não fui eu" (e-mail) ──────────▶  POST /auth/report-access
                                   encerra TODAS as sessões ─────────────▶ revokedAt
◀── token de redefinição            ──▶ tela "Criar nova senha"
```

## 2. Tokens

| Token | Onde fica | Validade | Conteúdo |
|---|---|---|---|
| **Acesso** (JWT HS256) | `localStorage` (manter conectado) ou `sessionStorage` | **15 min** | `sub` (usuário), `role`, `sid` (sessão) |
| **Refresh** | junto do token de acesso | **30 dias sem uso** (máx. **90 dias**); sem "manter conectado": **12 h** (máx. 24 h) | `"<sid>.<segredo>"`, com o segredo aleatório de 256 bits |
| **Redefinição de senha** (JWT) | link do e-mail | 15 min, uso único | `purpose: reset-password`, `pwd` (impressão do hash da senha) |
| **"Não fui eu"** (JWT) | link do e-mail de aparelho novo | 3 dias, até a senha mudar | `purpose: report-access`, `sid`, `pwd` |

- O banco guarda **apenas o SHA-256** do segredo do refresh, em `user_sessions.refreshHash`. Quem tiver acesso de leitura ao banco não consegue usar as sessões.
- O `pwd` (16 caracteres do SHA-256 do hash bcrypt) amarra os links à senha atual. Quando a senha muda, links antigos deixam de valer.
- Tokens de acesso antigos, sem `sid` e emitidos antes desta versão, continuam aceitos até expirarem, em no máximo 1 h.

### Rotação e detecção de roubo
A cada `POST /auth/refresh`:
1. O segredo enviado é comparado com `refreshHash`. Se confere, gera-se um segredo novo. O antigo vai para `previousHash`, com `rotatedAt`.
2. Se vier o **segredo anterior em até 60 s**, a resposta é **409 `ROTATED`**: outra aba acabou de renovar, e o site relê o token novo gravado por ela.
3. Se vier um **segredo antigo fora dessa janela**, o token pode ter sido copiado. A sessão é **encerrada** (`token-reuse`), o evento `TOKEN_REUSE` é registrado e a resposta é 401. Daí em diante nem o token mais novo vale.

### Sessão encerrada derruba o acesso na hora
O `authMiddleware` confere se a sessão do `sid` está ativa. Para não consultar o banco em toda requisição, há um cache em memória de 30 s, e encerramentos feitos nesta instância atualizam o cache na hora. Na prática, ao clicar em "Sair", "Desconectar" ou "Não fui eu", ou ao trocar a senha, o token daquele aparelho para de funcionar imediatamente (ou em até 30 s, se houver mais de uma instância).

> O chat (Socket.IO) valida só a assinatura do token no momento da conexão. O token dura 15 min e o site pega um token válido a cada reconexão.

## 3. Aparelhos e alerta por e-mail

- O site gera um **id aleatório por navegador** (`localStorage['@t3:device']`, UUID) e o envia no login. Ele não identifica a pessoa: serve só para saber se a conta já entrou por aquele navegador.
- **Aparelho novo** = nenhuma sessão anterior da conta com o mesmo `deviceId`.
- **Sem alerta na primeira sessão registrada da conta** (cadastro, ou primeiro login depois desta versão). Assim, a atualização não dispara um e-mail para cada cliente.
- O e-mail **"Novo acesso à sua conta"** traz:
  - data e hora (horário de Brasília);
  - aparelho (por exemplo, "Safari no iPhone");
  - forma de entrada (e-mail e senha ou Google);
  - IP;
  - o botão **"Não fui eu: proteger minha conta"**.
- O envio é **em segundo plano**: o login não espera nem falha por causa do e-mail, e falhas vão para o log como `[mail] Falha ao enviar "novo aparelho"`.
- Limpar os dados do navegador gera um id novo, então o próximo login nesse navegador também avisa. É o comportamento esperado, e mais seguro.

### "Não fui eu"
1. O link abre `/seguranca/nao-fui-eu`. A página **só age depois do clique**, porque leitores de e-mail costumam abrir links sozinhos para verificar.
2. `POST /auth/report-access`:
   - confere o JWT (`purpose`, validade, `pwd` igual à senha atual);
   - **encerra todas as sessões da conta** (`reported-not-me`);
   - registra `REPORTED_NOT_ME`;
   - devolve um **token de redefinição**.
3. O site limpa a sessão local e abre `/atualizar-senha` com o token. A pessoa cria a senha nova, e a redefinição de novo encerra as sessões e envia o aviso de senha alterada.

## 4. Senha

| Situação | O que acontece |
|---|---|
| Troca no perfil (`PUT /profile/password`) | Exige a senha atual, aplica a mesma regra do cadastro (8+ caracteres, 1 maiúscula, 1 número) e recusa uma nova igual à atual. **Os outros aparelhos saem** e chega o e-mail **"Sua senha foi alterada"**. |
| Redefinição por e-mail (`/auth/reset-password`) | Link de 15 min, uso único. **Todos os aparelhos saem.** Chega o mesmo e-mail de aviso, com o botão "Recuperar minha conta". |
| Conta criada pelo Google | Tem senha aleatória desconhecida. Para ter senha, a pessoa usa "Esqueci minha senha". |

### Bloqueio por tentativas
- **Por IP:** 10 logins a cada 15 min (`loginLimiter`), 5 pedidos de link de recuperação e 10 redefinições ou "Não fui eu" a cada 15 min. A renovação de sessão tem limite de 60 a cada 15 min.
- **Por conta:** **5 senhas erradas em 15 min bloqueiam aquela conta por 15 min**, mesmo trocando de IP. A mensagem orienta "Esqueci minha senha", e os eventos `LOGIN_FAILED` e `LOGIN_LOCKED` ficam registrados. O contador fica em memória, por instância, e zera quando o servidor reinicia.
- O login também exige reCAPTCHA. O login com Google passa pela verificação do próprio Google.

## 5. Tela "Meu perfil → Segurança"

Disponível para todos os perfis (cliente, comercial, gestor). Também abre por `/perfil?aba=seguranca`, link usado no e-mail.
- **Aparelhos conectados:**
  - navegador e sistema, "Este aparelho", último uso, data de entrada, forma de entrada e IP;
  - "Desconectar" por aparelho e **"Desconectar os outros"**, com confirmação.
- **Alterar senha:** senha atual, nova senha com as regras ao vivo e confirmação.
- **Atividade recente:** os últimos 20 eventos de segurança. Os que pedem atenção aparecem em laranja: aparelho novo, senha errada, bloqueio, uso suspeito e "Não fui eu".

## 6. No site (repositório Frontend)

- `src/lib/session.ts` concentra a sessão:
  - **guarda:** `localStorage` com "manter conectado", senão `sessionStorage`;
  - **renova:** antes de vencer, quando falta menos de 1 min;
  - **uma renovação por vez:** na aba e **entre abas** (Web Locks `t3-session-refresh`);
  - **sincroniza as abas** pelo evento `storage`: entrar, renovar ou sair em uma aba vale para as outras;
  - **sai no servidor** (`/auth/logout`).
- `src/lib/axios.ts`:
  - cada requisição sai com um token válido;
  - um 401 tenta **uma** renovação e repete a requisição;
  - se não der, a sessão é limpa e a pessoa vai para `/login`.
- Login: **"Manter conectado"** vem marcado. Sem ele, aparece o aviso "Você sai ao fechar esta aba. Use em computadores compartilhados."
- `/seguranca/nao-fui-eu` está bloqueado no `robots.txt` e marcado como `noindex`. O token sai da barra de endereço ao abrir.

## 7. API

| Método e rota | Acesso | Descrição |
|---|---|---|
| `POST /auth/login` | público + reCAPTCHA | Recebe `{ email, password, captchaToken, deviceId, remember }` e devolve `{ user, token, refreshToken, expiresIn, persistent }`. Responde 429 quando a conta está bloqueada. |
| `POST /auth/google` | público | Recebe `{ credential, deviceId, remember }` e devolve o mesmo formato, mais `created`. |
| `POST /auth/refresh` | público (refresh token) | Recebe `{ refreshToken }` e devolve um novo par. 409 `ROTATED`: outra aba renovou. 401: sessão inválida, expirada, encerrada ou reusada. |
| `POST /auth/logout` | público | Recebe `{ refreshToken }` e/ou `Authorization` e encerra a sessão. |
| `POST /auth/report-access` | público (token do e-mail) | Recebe `{ token }` e devolve `{ resetToken, closedSessions }`. |
| `POST /auth/reset-password` | público (token do e-mail) | Redefine a senha, encerra todas as sessões e avisa por e-mail. |
| `GET /profile/security` | logado | Devolve `{ sessions[], events[], googleLinked }`. |
| `DELETE /profile/sessions/:id` | logado | Desconecta um aparelho da própria conta. |
| `POST /profile/sessions/revoke-others` | logado | Desconecta os outros aparelhos e devolve `{ closed }`. |
| `PUT /profile/password` | logado | Recebe `{ currentPassword, newPassword }` e devolve `{ closedSessions }`. |

## 8. Banco

Migração `prisma/migrations/20261029030000_sessoes_seguranca`. Ela é idempotente e tem RLS ligado, como as demais tabelas: a API pública do Supabase não lê nada, e o backend conecta como `postgres` e ignora o RLS.

**`user_sessions`:** uma linha por login em um aparelho.
- **Tokens:** `refreshHash`, `previousHash` e `rotatedAt`.
- **Aparelho e forma de entrada:** `deviceId`, `persistent` e `method` (`password` ou `google`).
- **Navegador:** `userAgent`, `browser`, `os`, `deviceType` e `ip` (atualizado a cada renovação).
- **Datas:** `createdAt`, `lastUsedAt`, `expiresAt` (inatividade) e `absoluteExpiresAt` (limite total).
- **Encerramento:** `revokedAt` e `revokeReason`:
  - `logout`, `user-revoked`, `user-revoked-others`;
  - `password-changed`, `password-reset`;
  - `reported-not-me`, `token-reuse`.
- **Limpeza:** sessões vencidas ou encerradas há mais de 30 dias são apagadas em segundo plano a cada login.

**`security_events`:** histórico de segurança.
- **Campos:** `userId`, `type`, `sessionId`, `ip`, `userAgent`, `detail` e `createdAt`.
- **Tipos:**
  - `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGIN_LOCKED`, `NEW_DEVICE`;
  - `LOGOUT`, `SESSION_REVOKED`, `SESSIONS_REVOKED_OTHERS`, `TOKEN_REUSE`;
  - `PASSWORD_CHANGED`, `PASSWORD_RESET`, `REPORTED_NOT_ME`.
- **Falhas:** um erro ao gravar evento vai para o log e **nunca** interrompe o login.

Ambas as tabelas apagam em cascata com o usuário.

## 9. Configuração

| Variável (Render) | Uso |
|---|---|
| `JWT_SECRET` | Assina tokens de acesso, de redefinição e de "Não fui eu" (32+ caracteres). |
| `RESEND_API_KEY` | E-mails de novo acesso, senha alterada e recuperação. Sem ela, o login funciona mas os e-mails não saem; há aviso no log ao subir. |
| `RESEND_FROM` | Opcional. O padrão é `T3 OOH <nao-responda@t3ooh.com>`, domínio verificado no Resend. |
| `FRONTEND_URL` | Base dos links dos e-mails. No Render, o padrão é `https://t3ooh.com`. |

## 10. Operação e resposta a incidentes

**Ver os aparelhos e eventos de uma conta (SQL no Supabase):**
```sql
select id, browser, os, ip, "createdAt", "lastUsedAt", "revokedAt", "revokeReason"
from user_sessions where "userId" = '<id>' order by "lastUsedAt" desc;

select type, ip, detail, "createdAt" from security_events
where "userId" = '<id>' order by "createdAt" desc limit 50;
```

**Desconectar todos os aparelhos de uma conta** (por exemplo, a pedido do cliente):
```sql
update user_sessions set "revokedAt" = now(), "revokeReason" = 'admin'
where "userId" = '<id>' and "revokedAt" is null;
```
O token de acesso daquele usuário para de funcionar em até 30 s, que é o tempo do cache.

**Suspeita de vazamento do `JWT_SECRET`:**
1. Gere um segredo novo com `openssl rand -base64 48` e troque no Render. Todos os tokens de acesso e links de e-mail param de valer.
2. Encerre todas as sessões, porque os refresh tokens não dependem do segredo:
   ```sql
   update user_sessions set "revokedAt" = now(), "revokeReason" = 'secret-rotation' where "revokedAt" is null;
   ```
3. Todos entram de novo.

**Sinais para acompanhar:** muitos `LOGIN_LOCKED` ou `LOGIN_FAILED` na mesma conta, qualquer `TOKEN_REUSE`, e `REPORTED_NOT_ME`:
```sql
select type, count(*) from security_events where "createdAt" > now() - interval '7 days' group by 1 order by 2 desc;
```

## 11. Decisões e próximos passos

- **Refresh token no `localStorage`:** o backend fica em `backend-2go8.onrender.com`, outro domínio que o site. Cookies `httpOnly` entre domínios são bloqueados por Safari e Firefox (cookies de terceiros). As compensações hoje são:
  - acesso curto (15 min);
  - rotação a cada uso, com detecção de reuso;
  - sessões que podem ser encerradas a qualquer momento;
  - alerta de aparelho novo.
- **Próximo passo recomendado:** apontar `api.t3ooh.com` para o Render (CNAME na Vercel) e mover o refresh token para um cookie `httpOnly; Secure; SameSite=Lax`. Assim, um script injetado no site não consegue lê-lo.
- **Também recomendado:**
  - **2FA** (código por app autenticador) para gestores e comercial;
  - **CSP** no site (`vercel.json` → headers);
  - bloqueio por tentativas em armazenamento compartilhado (Redis), caso o backend passe a ter mais de uma instância;
  - painel de eventos de segurança para gestores.
