import { DiscountType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../database/prisma';

/**
 * Cálculo oficial de preços do carrinho.
 * O servidor é a única fonte de verdade: valores enviados pelo navegador são ignorados.
 */

export const quoteSchema = z.object({
    panelIds: z.array(z.string().uuid()).min(1, 'O carrinho não pode estar vazio.'),
    months: z.coerce.number().int().min(1).max(36),
    couponCode: z.string().trim().max(50).optional().nullable(),
});

export type QuoteInput = z.infer<typeof quoteSchema>;

export class PricingError extends Error {}

/** Desconto progressivo por prazo de contrato. */
export function termDiscountFor(months: number) {
    if (months >= 12) return 0.30;
    if (months >= 6) return 0.20;
    if (months >= 3) return 0.15;
    return 0;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export async function calculateQuote(input: QuoteInput) {
    const panelIds = [...new Set(input.panelIds)];
    const panels = await prisma.panel.findMany({
        where: { id: { in: panelIds } },
        select: { id: true, name: true, city: true, state: true, price: true },
    });

    if (panels.length !== panelIds.length) {
        throw new PricingError('Um ou mais painéis do carrinho não existem mais.');
    }

    const months = input.months;
    const baseMonthly = panels.reduce((sum, p) => sum + (p.price ?? 0), 0);
    const originalValue = baseMonthly * months;

    const termDiscountPercent = termDiscountFor(months);
    const termDiscount = originalValue * termDiscountPercent;
    const subtotal = originalValue - termDiscount;

    let couponDiscount = 0;
    let coupon: { id: string; code: string; discountType: DiscountType; value: number; singleUse: boolean } | null = null;

    if (input.couponCode) {
        const found = await prisma.crmCoupon.findUnique({
            where: { code: input.couponCode.toUpperCase() },
        });

        if (!found) throw new PricingError('Cupom inválido ou expirado.');
        if (found.validUntil && found.validUntil.getTime() < Date.now()) {
            throw new PricingError('Cupom inválido ou expirado.');
        }
        if (found.singleUse && found.isUsed) throw new PricingError('Este cupom já foi utilizado.');
        if (found.minValue && subtotal < found.minValue) {
            throw new PricingError(`Este cupom exige um pedido mínimo de R$ ${found.minValue.toFixed(2)}.`);
        }

        couponDiscount = found.discountType === DiscountType.PERCENTAGE
            ? subtotal * (Math.min(Math.max(found.value, 0), 100) / 100)
            : Math.min(Math.max(found.value, 0), subtotal);

        coupon = {
            id: found.id,
            code: found.code,
            discountType: found.discountType,
            value: found.value,
            singleUse: found.singleUse,
        };
    }

    const finalValue = subtotal - couponDiscount;
    // Proporção aplicada igualmente a cada painel para gerar o valor mensal de cada item
    const ratio = originalValue > 0 ? finalValue / originalValue : 1;

    return {
        months,
        originalValue: round2(originalValue),
        termDiscountPercent,
        termDiscount: round2(termDiscount),
        couponDiscount: round2(couponDiscount),
        finalValue: round2(finalValue),
        monthlyValue: round2(finalValue / months),
        coupon,
        items: panels.map((p) => ({
            panelId: p.id,
            name: p.name,
            city: p.city,
            state: p.state,
            basePrice: p.price ?? 0,
            // Valor mensal do painel após todos os descontos
            priceSnapshot: round2((p.price ?? 0) * ratio),
        })),
    };
}

export type Quote = Awaited<ReturnType<typeof calculateQuote>>;
