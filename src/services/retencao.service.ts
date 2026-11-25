import { prismaSemAuditoria as db } from '../database/prisma';
import { pruneOldSessions } from './session.service';

const DIA = 86_400_000;
const antes = (dias: number) => new Date(Date.now() - dias * DIA);

/**
 * Retenção de dados pessoais (LGPD art. 6º, III e art. 16): roda uma vez por dia.
 * Prazos publicados na Política de Privacidade; mudou aqui, mude lá.
 */
export async function aplicarRetencao() {
    await pruneOldSessions();
    await Promise.all([
        // Atividade de segurança da conta (IP, navegador): 1 ano
        db.securityEvent.deleteMany({ where: { createdAt: { lt: antes(365) } } }),
        // Estatísticas: IP e local nunca ficam (linhas antigas ainda tinham); eventos com mais de 25 meses saem
        db.analyticsEvent.updateMany({ where: { OR: [{ ip: { not: null } }, { city: { not: null } }, { country: { not: null } }] }, data: { ip: null, city: null, country: null } }),
        db.analyticsEvent.deleteMany({ where: { createdAt: { lt: antes(760) } } }),
        // Contatos: o IP e o navegador servem só contra abuso; após 6 meses ficam só os dados do pedido
        db.contact.updateMany({ where: { createdAt: { lt: antes(180) }, OR: [{ ip: { not: null } }, { userAgent: { not: null } }] }, data: { ip: null, userAgent: null } }),
    ]).catch((error) => console.error('[Retenção] Falha ao limpar dados antigos:', error));
}
