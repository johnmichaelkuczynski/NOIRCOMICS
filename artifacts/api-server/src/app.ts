import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();
app.set("trust proxy", "loopback, linklocal, uniquelocal");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "16mb", verify(req, _res, bytes) {
  (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(bytes);
} }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
