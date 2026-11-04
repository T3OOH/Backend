import { env } from '../config/env';
import { memoryCache } from '../lib/memoryCache';

/*
 * App desktop da equipe (T3 Gestor). Os instaladores ficam nas releases de um repositório
 * privado do GitHub; só a API (com o GITHUB_TOKEN) enxerga. A equipe recebe um link de download
 * assinado pelo próprio GitHub, que vale poucos minutos: nada fica público.
 */

export class DesktopReleaseError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

export interface DesktopFile {
    id: number;
    name: string;
    size: number;
    /** Sistema do arquivo, pelo nome/extensão. */
    platform: 'windows' | 'macos' | 'linux';
    kind: 'instalador' | 'portatil';
    /** SHA-256 (hex) calculado pelo GitHub no upload; o app confere antes de instalar. Null se o GitHub não informou. */
    sha256: string | null;
}

/** "sha256:<hex>" do GitHub vira só o hex; qualquer outro formato vira null. */
export function sha256Of(digest?: string | null): string | null {
    const match = /^sha256:([0-9a-f]{64})$/i.exec(digest ?? '');
    return match ? match[1].toLowerCase() : null;
}

export interface DesktopRelease {
    version: string;
    name: string;
    publishedAt: string;
    notes: string;
    files: DesktopFile[];
}

const GITHUB = 'https://api.github.com';
const CACHE_MS = 5 * 60 * 1000;
const FILE_EXT = /\.(msi|exe|zip|dmg|pkg|deb|rpm|AppImage)$/i;

function headers(accept = 'application/vnd.github+json') {
    if (!env.GITHUB_TOKEN) {
        throw new DesktopReleaseError(503, 'O download do app ainda não foi configurado no servidor.');
    }
    return { Accept: accept, Authorization: `Bearer ${env.GITHUB_TOKEN}`, 'User-Agent': 't3-api-desktop', 'X-GitHub-Api-Version': '2022-11-28' };
}

function platformOf(name: string): DesktopFile['platform'] {
    if (/\.(dmg|pkg)$/i.test(name) || /mac|darwin/i.test(name)) return 'macos';
    if (/\.(deb|rpm|AppImage)$/i.test(name) || /linux/i.test(name)) return 'linux';
    return 'windows';
}

/** Última versão publicada (cache de 5 min para não gastar o limite da API do GitHub). */
export function latestDesktopRelease(): Promise<DesktopRelease> {
    return memoryCache.wrap('desktop:latest', CACHE_MS, async () => {
        const res = await fetch(`${GITHUB}/repos/${env.DESKTOP_REPOSITORY}/releases/latest`, { headers: headers() });
        if (res.status === 404) throw new DesktopReleaseError(404, 'Ainda não há versão do app publicada.');
        if (!res.ok) {
            console.error(`[Desktop] GitHub respondeu ${res.status} ao buscar a release`);
            throw new DesktopReleaseError(502, 'Não foi possível consultar a versão do app agora. Tente de novo em instantes.');
        }
        const body = await res.json() as {
            tag_name: string; name?: string; published_at: string; body?: string;
            assets: { id: number; name: string; size: number; state: string; digest?: string | null }[];
        };
        return {
            version: body.tag_name.replace(/^v/i, ''),
            name: body.name || `T3 Gestor ${body.tag_name}`,
            publishedAt: body.published_at,
            notes: (body.body || '').slice(0, 5000),
            files: body.assets
                .filter((a) => a.state === 'uploaded' && FILE_EXT.test(a.name))
                .map((a) => ({
                    id: a.id,
                    name: a.name,
                    size: a.size,
                    platform: platformOf(a.name),
                    kind: /\.(msi|exe|dmg|pkg|deb|rpm)$/i.test(a.name) ? 'instalador' as const : 'portatil' as const,
                    sha256: sha256Of(a.digest),
                })),
        };
    });
}

/**
 * Link de download de um arquivo da versão atual. O GitHub responde com um redirecionamento
 * para uma URL assinada e temporária; devolvemos essa URL (o token nunca sai da API).
 */
export async function desktopDownloadLink(fileId: number): Promise<string> {
    const release = await latestDesktopRelease();
    // Só arquivos da versão publicada: o id não serve para baixar outra coisa do repositório
    if (!release.files.some((f) => f.id === fileId)) {
        throw new DesktopReleaseError(404, 'Arquivo não encontrado na versão atual do app.');
    }
    return assetLink(fileId);
}

/** URL assinada e temporária do GitHub para um arquivo de release (o token nunca sai da API). */
async function assetLink(fileId: number): Promise<string> {
    const res = await fetch(`${GITHUB}/repos/${env.DESKTOP_REPOSITORY}/releases/assets/${fileId}`, {
        headers: headers('application/octet-stream'),
        redirect: 'manual',
    });
    const location = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && location) return location;
    console.error(`[Desktop] GitHub respondeu ${res.status} ao gerar o link do arquivo ${fileId}`);
    throw new DesktopReleaseError(502, 'Não foi possível gerar o link de download agora. Tente de novo em instantes.');
}

/** Zip do T3 Launcher: o nome tem "launcher" e termina em .zip. */
export function isLauncherAsset(name: string): boolean {
    return /launcher/i.test(name) && /\.zip$/i.test(name);
}

/** Versão no nome do zip ("T3-Launcher-1.2.0.zip") ou no título da release ("T3 Launcher 1.2.0"); "0" se não houver. */
export function launcherVersion(assetName: string, releaseName?: string | null): string {
    const m = /(\d+(?:\.\d+){1,3})/.exec(assetName) ?? /(\d+(?:\.\d+){1,3})/.exec(releaseName ?? '');
    return m ? m[1] : '0';
}

export interface LauncherRelease {
    id: number;
    name: string;
    size: number;
    version: string;
    sha256: string | null;
}

/**
 * Zip do T3 Launcher, guardado numa release própria (tag LAUNCHER_RELEASE_TAG) para não se
 * misturar com as versões do T3 Gestor que o app e o launcher instalam.
 */
export async function launcherRelease(): Promise<LauncherRelease> {
    const res = await fetch(`${GITHUB}/repos/${env.DESKTOP_REPOSITORY}/releases/tags/${env.LAUNCHER_RELEASE_TAG}`, { headers: headers() });
    if (res.status === 404) throw new DesktopReleaseError(404, 'O launcher ainda não foi publicado para download.');
    if (!res.ok) {
        console.error(`[Desktop] GitHub respondeu ${res.status} ao buscar a release do launcher`);
        throw new DesktopReleaseError(502, 'Não foi possível consultar o launcher agora. Tente de novo em instantes.');
    }
    const body = (await res.json()) as {
        name?: string | null;
        assets?: { id: number; name: string; size: number; state: string; digest?: string | null }[];
    };
    const zip = (body.assets ?? []).find((a) => a.state === 'uploaded' && isLauncherAsset(a.name));
    if (!zip) throw new DesktopReleaseError(404, 'O launcher ainda não foi publicado para download.');
    return { id: zip.id, name: zip.name, size: zip.size, version: launcherVersion(zip.name, body.name), sha256: sha256Of(zip.digest) };
}

/** Link temporário do zip do launcher (área do site com senha e atualização do próprio launcher). */
export async function launcherDownloadLink(): Promise<{ url: string; name: string; size: number }> {
    const zip = await launcherRelease();
    return { url: await assetLink(zip.id), name: zip.name, size: zip.size };
}
