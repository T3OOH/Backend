import { Router } from 'express';
import { calculateQuote, quoteSchema } from '../services/pricing.service';

const pricingRoutes = Router();

// Público: simula o valor do carrinho (prazo + cupom) com os preços oficiais do banco
pricingRoutes.post('/quote', async (req, res) => {
    const input = quoteSchema.parse(req.body);
    const quote = await calculateQuote(input);
    return res.json(quote);
});

export { pricingRoutes };
