import { Resend } from 'resend';
import { env } from '../config/env';

/*
 * E-mails transacionais (Resend). O remetente padrão é do domínio verificado t3ooh.com.
 * O SDK do Resend devolve { error } em vez de lançar: aqui o erro vira exceção.
 */
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
export const EMAIL_FROM = process.env.RESEND_FROM || 'T3 OOH <nao-responda@t3ooh.com>';
export const mailEnabled = Boolean(resend);

const SITE = () => env.FRONTEND_URL.replace(/\/$/, '');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const firstName = (name: string) => {
    const first = (name || '').trim().split(/\s+/)[0] || 'olá';
    return first.charAt(0).toUpperCase() + first.slice(1);
};

interface BrandEmail {
    eyebrow: string;
    title: string;
    /** Parágrafos (HTML já escapado quando vier de dado do usuário). */
    paragraphs: string[];
    /** Linhas "rótulo: valor" em destaque (ex.: aparelho, IP, horário). */
    details?: [string, string][];
    button?: { label: string; url: string };
    footnote?: string;
}

/** Layout padrão do site: tabelas e estilos inline para funcionar em clientes de e-mail. */
function brandEmail({ eyebrow, title, paragraphs, details, button, footnote }: BrandEmail) {
    const detailRows = details?.length
        ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #2A2A2E;">
${details.map(([k, v]) => `<tr><td style="padding:10px 14px;border-bottom:1px solid #2A2A2E;font-size:12px;color:#8E8E93;width:120px;">${esc(k)}</td><td style="padding:10px 14px;border-bottom:1px solid #2A2A2E;font-size:14px;color:#ECECEE;">${esc(v)}</td></tr>`).join('')}
</table>`
        : '';
    const cta = button
        ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#FF5E00;">
          <a href="${button.url}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;color:#0B0B0C;text-decoration:none;">${esc(button.label)}</a>
        </td></tr></table>
        <p style="margin:24px 0 0;font-size:13px;color:#8E8E93;">Se o botão não abrir, copie este endereço no navegador:<br><a href="${button.url}" style="color:#FF5E00;word-break:break-all;">${button.url}</a></p>`
        : '';
    const html = `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:0;background:#0B0B0C;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0B0C;padding:32px 16px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111113;border:1px solid #2A2A2E;">
      <tr><td style="padding:28px 32px;border-bottom:1px solid #2A2A2E;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;color:#ECECEE;">
        t<span style="color:#FF5E00;">3</span> <span style="font-size:11px;letter-spacing:3px;color:#8E8E93;font-weight:normal;">OOH</span>
      </td></tr>
      <tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;color:#B4B4B9;font-size:15px;line-height:1.6;">
        <p style="margin:0 0 8px;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#8E8E93;">${esc(eyebrow)}</p>
        <h1 style="margin:0 0 20px;font-size:26px;line-height:1.2;font-weight:normal;color:#ECECEE;text-transform:uppercase;">${esc(title)}</h1>
        ${paragraphs.map((p) => `<p style="margin:0 0 20px;">${p}</p>`).join('')}
        ${detailRows}
        ${cta}
        ${footnote ? `<p style="margin:24px 0 0;font-size:13px;color:#8E8E93;">${footnote}</p>` : ''}
      </td></tr>
      <tr><td style="padding:20px 32px;border-top:1px solid #2A2A2E;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6E6E73;">T3 OOH · Mídia exterior em Goiânia e região</td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
    const strip = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    const text = [
        `${title} - T3 OOH`,
        '',
        ...paragraphs.map(strip),
        ...(details?.length ? ['', ...details.map(([k, v]) => `${k}: ${v}`)] : []),
        ...(button ? ['', `${button.label}: ${button.url}`] : []),
        ...(footnote ? ['', strip(footnote)] : []),
    ].join('\n');
    return { html, text };
}

/** Envia e lança em caso de falha (quem chama decide se a falha bloqueia ou só vai para o log). */
export async function sendMail(to: string, subject: string, content: { html: string; text: string }) {
    if (!resend) throw new Error('RESEND_API_KEY ausente');
    const { error } = await resend.emails.send({ from: EMAIL_FROM, to, subject, ...content });
    if (error) throw Object.assign(new Error(error.message), { resend: error });
}

/** Envio em segundo plano: o fluxo (login, troca de senha) não espera nem falha por causa do e-mail. */
export function sendMailInBackground(to: string, subject: string, content: { html: string; text: string }, tag: string) {
    sendMail(to, subject, content).catch((error) => {
        console.error(`[mail] Falha ao enviar "${tag}":`, (error as { resend?: unknown }).resend ?? error);
    });
}

// ============================ MODELOS ============================

export function resetEmail(name: string, link: string) {
    return brandEmail({
        eyebrow: 'Recuperação de senha',
        title: 'Crie uma nova senha',
        paragraphs: [`${esc(firstName(name))}, recebemos um pedido para redefinir a senha da sua conta na T3 OOH. O link vale por <strong style="color:#ECECEE;">15 minutos</strong> e funciona uma única vez.`],
        button: { label: 'Criar nova senha', url: link },
        footnote: 'Não pediu? Ignore este e-mail: sua senha continua a mesma.',
    });
}

export interface AccessInfo {
    when: Date;
    device: string;
    ip: string | null;
    method: 'password' | 'google';
}

const formatWhen = (d: Date) =>
    new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d);

/** Alerta de acesso em aparelho novo, com o botão "Não fui eu". */
export function newDeviceEmail(name: string, info: AccessInfo, reportLink: string) {
    return brandEmail({
        eyebrow: 'Segurança da conta',
        title: 'Novo acesso à sua conta',
        paragraphs: [
            `${esc(firstName(name))}, sua conta na T3 OOH foi acessada em um aparelho que ainda não tínhamos visto.`,
            'Se foi você, não precisa fazer nada.',
            '<strong style="color:#ECECEE;">Não foi você?</strong> Use o botão abaixo: encerramos o acesso em todos os aparelhos e você cria uma senha nova na hora.',
        ],
        details: [
            ['Quando', `${formatWhen(info.when)} (horário de Brasília)`],
            ['Aparelho', info.device],
            ['Entrada', info.method === 'google' ? 'Conta Google' : 'E-mail e senha'],
            ['Endereço IP', info.ip || 'não identificado'],
        ],
        button: { label: 'Não fui eu: proteger minha conta', url: reportLink },
        footnote: `O link vale por 3 dias. Você também pode ver e encerrar os aparelhos conectados em <a href="${SITE()}/perfil?aba=seguranca" style="color:#FF5E00;">Meu perfil → Segurança</a>.`,
    });
}

/** Aviso de senha alterada (troca no perfil ou pelo link de recuperação). */
export function passwordChangedEmail(name: string, info: { when: Date; device: string; ip: string | null }, recoverLink: string) {
    return brandEmail({
        eyebrow: 'Segurança da conta',
        title: 'Sua senha foi alterada',
        paragraphs: [
            `${esc(firstName(name))}, a senha da sua conta na T3 OOH acabou de ser alterada. Por segurança, os outros aparelhos conectados foram desconectados.`,
            '<strong style="color:#ECECEE;">Não foi você?</strong> Crie uma nova senha agora pelo botão abaixo e fale com o comercial da T3.',
        ],
        details: [
            ['Quando', `${formatWhen(info.when)} (horário de Brasília)`],
            ['Aparelho', info.device],
            ['Endereço IP', info.ip || 'não identificado'],
        ],
        button: { label: 'Recuperar minha conta', url: recoverLink },
    });
}

/** Confirmação do pedido de orçamento da T3 Solution, com o resumo do projeto enviado. */
export function solutionRequestEmail(name: string, protocol: string, details: [string, string][]) {
    return brandEmail({
        eyebrow: 'T3 Solution · Orçamento',
        title: 'Recebemos seu pedido',
        paragraphs: [
            `${esc(firstName(name))}, seu pedido de orçamento para um painel de LED chegou à equipe da T3 Solution.`,
            'Vamos analisar o espaço e o uso da tela e falar com você pelo WhatsApp informado para fechar medidas, especificação e proposta.',
        ],
        details: [['Protocolo', `#${protocol}`], ...details],
        button: { label: 'Acompanhar no meu perfil', url: `${SITE()}/perfil?aba=orcamentos` },
        footnote: 'Fotos do local e medidas aproximadas ajudam a chegar mais rápido na proposta: responda o consultor quando ele entrar em contato.',
    });
}

export const siteUrl = SITE;
