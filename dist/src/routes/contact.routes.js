"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contactRoutes = void 0;
const express_1 = require("express");
const contact_controller_1 = require("../controllers/contact.controller");
const contactRoutes = (0, express_1.Router)();
exports.contactRoutes = contactRoutes;
contactRoutes.post('/', contact_controller_1.contactController.create);
