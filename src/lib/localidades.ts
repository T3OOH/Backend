/**
 * Municípios e UFs oficiais do IBGE: busca para os formulários e padronização de cidade/UF.
 *
 * A lista é uma cópia local de https://servicodados.ibge.gov.br/api/v1/localidades/municipios
 * (atualizar com `node scripts/atualizar-municipios.mjs`). Assim a API não depende do IBGE no ar.
 */
import { z } from 'zod';
import municipiosIbge from '../data/municipios-ibge.json';

export interface Municipio {
    id: number;
    nome: string;
    uf: string;
}

export const UFS: Record<string, string> = {
    AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
    ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
    PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
    RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};

/** Sem acento, minúsculo, espaços e apóstrofos uniformes ("d'Oeste", "D´Oeste" e "d' oeste" batem). */
export function normalizar(texto: string) {
    return texto
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[´`’‘]/g, "'")
        .replace(/'\s+/g, "'")
        .replace(/[\s-]+/g, ' ')
        .trim();
}

const MUNICIPIOS: Municipio[] = (municipiosIbge as [number, string, string][]).map(([id, nome, uf]) => ({ id, nome, uf }));
const POR_NOME = new Map<string, Municipio[]>();
for (const m of MUNICIPIOS) {
    const chave = normalizar(m.nome);
    POR_NOME.set(chave, [...(POR_NOME.get(chave) ?? []), m]);
}
const UF_POR_NOME = new Map(Object.entries(UFS).map(([sigla, nome]) => [normalizar(nome), sigla]));

/** "GO", "go", "Goiás" ou "goias" viram "GO"; o que não for UF vira null. */
export function siglaUf(valor: string) {
    const limpo = valor.trim();
    if (UFS[limpo.toUpperCase()]) return limpo.toUpperCase();
    return UF_POR_NOME.get(normalizar(limpo)) ?? null;
}

/** Sugestões para o campo cidade: primeiro os que começam com o texto, depois os que o contêm. */
export function buscarMunicipios(busca: string, uf?: string | null, limite = 10): Municipio[] {
    const termo = normalizar(busca);
    if (termo.length < 2) return [];
    const sigla = uf ? siglaUf(uf) : null;
    const comeca: Municipio[] = [];
    const contem: Municipio[] = [];
    for (const m of MUNICIPIOS) {
        if (sigla && m.uf !== sigla) continue;
        const nome = normalizar(m.nome);
        if (nome.startsWith(termo)) comeca.push(m);
        else if (nome.includes(termo)) contem.push(m);
    }
    // Nome exato primeiro ("goiania" -> Goiânia antes de Goianápolis)
    const exatos = comeca.filter((m) => normalizar(m.nome) === termo);
    const resto = comeca.filter((m) => normalizar(m.nome) !== termo);
    return [...exatos, ...resto, ...contem].slice(0, Math.max(1, Math.min(limite, 50)));
}

type Resolucao =
    | { ok: true; city?: string; state?: string }
    | { ok: false; campo: 'city' | 'state'; mensagem: string };

/**
 * Padroniza cidade e UF: corrige o nome para a grafia do IBGE e preenche a UF.
 * Aceita "Cidade - UF" ou "Cidade/UF" no campo cidade. Campos vazios ficam como vieram.
 */
export function resolverLocal(cidade?: string | null, estado?: string | null): Resolucao {
    let city = cidade?.trim() ?? '';
    let state = estado?.trim() ?? '';

    // "Uberlândia - MG", "Uberlândia/MG"
    const sufixo = city.match(/^(.*?)\s*[-/,]\s*([A-Za-z]{2})$/);
    if (sufixo && UFS[sufixo[2].toUpperCase()]) {
        city = sufixo[1];
        state ||= sufixo[2];
    }

    let sigla: string | null = null;
    if (state) {
        sigla = siglaUf(state);
        if (!sigla) return { ok: false, campo: 'state', mensagem: `UF inválida: "${state}". Use a sigla, como GO ou MG.` };
    }

    // Sem cidade: só a UF é padronizada (a cidade fica como veio)
    if (!city) return { ok: true, ...(sigla ? { state: sigla } : {}) };

    const candidatos = POR_NOME.get(normalizar(city)) ?? [];
    if (!candidatos.length) {
        return { ok: false, campo: 'city', mensagem: `Cidade não encontrada na lista do IBGE: "${city}". Confira a grafia.` };
    }
    if (sigla) {
        const certo = candidatos.find((m) => m.uf === sigla);
        if (!certo) {
            const ufs = candidatos.map((m) => m.uf).join(', ');
            return { ok: false, campo: 'state', mensagem: `${candidatos[0].nome} não fica em ${sigla}; fica em ${ufs}.` };
        }
        return { ok: true, city: certo.nome, state: certo.uf };
    }
    if (candidatos.length > 1) {
        const ufs = candidatos.map((m) => m.uf).join(', ');
        return { ok: false, campo: 'state', mensagem: `Existe ${candidatos[0].nome} em ${ufs}: informe a UF.` };
    }
    return { ok: true, city: candidatos[0].nome, state: candidatos[0].uf };
}

/**
 * Para usar em `.transform()` de um schema Zod com `city` e `state`: padroniza os dois ou
 * registra o erro no campo certo (a resposta sai como 400 "Dados inválidos." com a mensagem).
 */
export function padronizarLocal<T extends { city?: string | null; state?: string | null }>(dados: T, ctx: z.RefinementCtx): T {
    if (dados.city == null && dados.state == null) return dados;
    const r = resolverLocal(dados.city, dados.state);
    if (!r.ok) {
        ctx.addIssue({ code: 'custom', path: [r.campo], message: r.mensagem });
        return z.NEVER;
    }
    return {
        ...dados,
        ...(r.city !== undefined ? { city: r.city } : {}),
        ...(r.state !== undefined ? { state: r.state } : {}),
    };
}
