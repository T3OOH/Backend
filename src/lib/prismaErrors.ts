import { Prisma } from '@prisma/client';

/** O registro pedido não existe (update/delete de um id inexistente). */
export function isRecordNotFound(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}
