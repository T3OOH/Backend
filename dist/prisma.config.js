"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const config_1 = require("prisma/config");
exports.default = (0, config_1.defineConfig)({
    datasource: {
        // Apontamos para a URL Direta aqui para o CLI conseguir fazer o db push
        url: (0, config_1.env)('DIRECT_URL'),
    },
});
