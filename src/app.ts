import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import { router } from './routes';
import { errorHandler } from './middlewares/errorHandler';
import { notFoundHandler } from './middlewares/notFoundHandler';

export const app = express();

app.use(cors());
app.use(express.json());

app.use('/api', router);

app.use(notFoundHandler);
app.use(errorHandler);
