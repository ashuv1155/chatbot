import express from "express";
import { registerApiRoutes } from "../server/api.ts";

const app = express();
registerApiRoutes(app);

export default app;
