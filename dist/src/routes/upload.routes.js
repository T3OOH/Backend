"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadRoutes = void 0;
const express_1 = require("express");
const client_1 = require("@prisma/client");
const upload_controller_1 = require("../controllers/upload.controller");
const auth_middleware_1 = require("../middlewares/auth.middleware");
const upload_middleware_1 = require("../middlewares/upload.middleware");
const uploadRoutes = (0, express_1.Router)();
exports.uploadRoutes = uploadRoutes;
const uploadController = new upload_controller_1.UploadController();
uploadRoutes.post('/', auth_middleware_1.authMiddleware, (0, auth_middleware_1.requireRoles)(client_1.Role.ADMIN, client_1.Role.MANAGER), upload_middleware_1.uploadMiddleware.single('file'), (req, res, next) => {
    void uploadController.uploadImage(req, res).catch(next);
});
