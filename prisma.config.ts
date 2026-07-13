import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  datasource: {
    // Apontamos para a URL Direta aqui para o CLI conseguir fazer o db push
    url: env('DIRECT_URL'),
  },
});